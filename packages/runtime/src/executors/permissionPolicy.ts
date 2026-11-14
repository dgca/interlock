import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import {
  describeRule,
  type ExecutorAnswer,
  type ExecutorProfile,
  type ManagedExecution,
  type PermissionAction,
  type PermissionPolicy,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import { commandAllowed, pathInside } from '../permissionCommands.js';
import type { HarnessRequest } from './contracts.js';

type Harness = ExecutorProfile['harness'];
const claudeReads: Record<string, string> = {
  Read: 'file_path',
  NotebookRead: 'notebook_path',
  LS: 'path',
  Glob: 'path',
  Grep: 'path',
};
const claudeEdits: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
};
const text = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;

/** A Claude Code tool call as a policy action, or undefined when it cannot be judged. */
export function claudeAction(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): PermissionAction | undefined {
  if (name === 'Bash') {
    const command = text(input.command);
    return command ? { kind: 'command', command, cwd } : undefined;
  }
  const field = claudeReads[name] ?? claudeEdits[name];
  if (!field) return { kind: 'tool', name };
  const path =
    input[field] === undefined && claudeReads[name] ? cwd : input[field];
  // A glob can reach outside the directory it searches.
  const pattern =
    name === 'Glob'
      ? text(input.pattern)
      : name === 'Grep'
        ? text(input.glob)
        : undefined;
  if (
    typeof path !== 'string' ||
    (pattern &&
      (isAbsolute(pattern) ||
        pattern.startsWith('~') ||
        pattern.split('/').includes('..')))
  )
    return undefined;
  return { kind: claudeReads[name] ? 'read' : 'edit', paths: [path] };
}

/** A Codex approval request as a policy action. */
export function codexAction(
  request: unknown,
  changes: unknown,
  cwd: string,
): PermissionAction | undefined {
  const params = (request ?? {}) as {
    command?: unknown;
    cwd?: unknown;
    kind?: unknown;
    grantRoot?: unknown;
    networkApprovalContext?: unknown;
  };
  if (params.networkApprovalContext || params.grantRoot) return undefined;
  if (params.command !== undefined)
    return typeof params.command === 'string' &&
      (params.kind === undefined || params.kind === 'command')
      ? {
          kind: 'command',
          command: params.command,
          cwd: text(params.cwd) ?? cwd,
        }
      : undefined;
  type Change = { path?: unknown; kind?: { move_path?: unknown } };
  const list: Change[] = Array.isArray(changes)
    ? (changes as Change[])
    : changes && typeof changes === 'object'
      ? Object.keys(changes).map((path) => ({ path }))
      : [];
  const paths = list.flatMap((change) => [
    change?.path,
    ...(change?.kind?.move_path ? [change.kind.move_path] : []),
  ]);
  return paths.length && paths.every((p) => typeof p === 'string' && p)
    ? { kind: 'edit', paths: paths as string[] }
    : undefined;
}

/** A Pi tool call as a policy action. */
export function piAction(
  tool: string,
  input: unknown,
  cwd: string,
): PermissionAction | undefined {
  const fields = (input ?? {}) as { command?: unknown; path?: unknown };
  const command = text(fields.command);
  const path = text(fields.path);
  if (tool === 'bash')
    return command ? { kind: 'command', command, cwd } : undefined;
  if (tool === 'edit' || tool === 'write')
    return path ? { kind: 'edit', paths: [path] } : undefined;
  return { kind: 'tool', name: tool };
}

/** Rules a harness cannot apply; its actions keep asking. */
function notApplied(policy: PermissionPolicy, harness: Harness) {
  // Codex has no named tool approvals, and reads run in its sandbox.
  return policy.allow
    .filter(
      (rule) =>
        (rule.kind === 'tool' && harness === 'codex') ||
        !['claude-code', 'codex', 'pi'].includes(harness),
    )
    .map((rule) => `${describeRule(rule)}: ${harness} asks instead`);
}

/** Whether the policy allows an action inside the real workspace root. */
export function policyAllows(
  policy: PermissionPolicy,
  action: PermissionAction,
  root: string,
  harness: Harness,
  cwd = root,
) {
  const has = (kind: string) => policy.allow.some((r) => r.kind === kind);
  const inside = (paths: string[]) =>
    paths.every((p) => pathInside(p, cwd, root));
  if (action.kind === 'read') return has('read') && inside(action.paths);
  if (action.kind === 'edit') return has('edit') && inside(action.paths);
  if (action.kind === 'tool')
    return (
      harness !== 'codex' &&
      policy.allow.some((r) => r.kind === 'tool' && r.name === action.name)
    );
  return commandAllowed(
    action.command,
    resolve(cwd, action.cwd),
    root,
    policy.allow.flatMap((r) => (r.kind === 'command' ? [r.pattern] : [])),
  );
}

/**
 * The request callback for one managed session run. Without a policy it
 * forwards every request. With an approved policy, a permission request whose
 * action the policy allows is answered here and counted on the record.
 */
export function policyRequests(
  engine: Pick<Engine, 'store' | 'scriptApprovals' | 'workspaces'>,
  work: WorkRequest,
  record: ManagedExecution,
  forward: (request: HarnessRequest) => Promise<ExecutorAnswer>,
): {
  request: (request: HarnessRequest) => Promise<ExecutorAnswer>;
  permissionPolicy?: true;
} {
  const request = (request: HarnessRequest) => {
    const plain = { ...request };
    delete plain.action;
    return forward(plain);
  };
  const run = engine.store.get<Run>('runs', work.runId);
  const execution = run?.executions.find((e) => e.id === work.executionId);
  const definition =
    run &&
    engine.store.getVersion(run.workflowId, execution?.version ?? run.version)
      ?.definition;
  const policy = definition?.permissionPolicy;
  if (!run || !definition || !policy?.allow.length) return { request };
  const harness = record.profile.harness;
  const skip = (state: 'awaiting_approval' | 'unavailable', why: string) => {
    record.permissionPolicy = {
      state,
      autoAllowed: record.permissionPolicy?.autoAllowed ?? 0,
      notApplied: [why],
    };
    return { request };
  };
  if (engine.scriptApprovals.pendingPolicy(run.workflowId, policy))
    return skip(
      'awaiting_approval',
      'The policy waits for approval; every action asks',
    );
  let root: string, cwd: string;
  try {
    root = realpathSync(engine.workspaces.path(run, definition) ?? record.cwd);
    cwd = realpathSync(record.cwd);
  } catch {
    return skip(
      'unavailable',
      'The run workspace is unavailable; every action asks',
    );
  }
  const skipped = notApplied(policy, harness);
  record.permissionPolicy = {
    state: 'applied',
    autoAllowed: record.permissionPolicy?.autoAllowed ?? 0,
    ...(skipped.length ? { notApplied: skipped } : {}),
  };
  return {
    permissionPolicy: true,
    request: (input) => {
      if (
        input.kind !== 'permission' ||
        !input.action ||
        !policyAllows(policy, input.action, root, harness, cwd)
      )
        return request(input);
      record.permissionPolicy!.autoAllowed++;
      return Promise.resolve({ allow: true });
    },
  };
}
