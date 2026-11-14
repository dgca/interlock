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
import {
  commandAllowed,
  pathInside,
  writablePath,
} from '../permissionCommands.js';
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

/**
 * The rules that allow an action inside the real workspace root, or undefined
 * when it must ask. Edits and command paths never reach Git's own files.
 */
export function policyAllows(
  policy: PermissionPolicy,
  action: PermissionAction,
  root: string,
  harness: Harness,
  cwd = root,
): string[] | undefined {
  const rule = (kind: 'read' | 'edit') =>
    policy.allow.some((r) => r.kind === kind)
      ? [describeRule({ kind })]
      : undefined;
  if (action.kind === 'read')
    return action.paths.every((p) => pathInside(p, cwd, root))
      ? rule('read')
      : undefined;
  if (action.kind === 'edit')
    return action.paths.every((p) => writablePath(p, cwd, root))
      ? rule('edit')
      : undefined;
  if (action.kind === 'tool')
    return harness !== 'codex' &&
      policy.allow.some((r) => r.kind === 'tool' && r.name === action.name)
      ? [describeRule({ kind: 'tool', name: action.name })]
      : undefined;
  return commandAllowed(
    action.command,
    resolve(cwd, action.cwd),
    root,
    policy.allow.flatMap((r) => (r.kind === 'command' ? [r.pattern] : [])),
    policy.allow.some((r) => r.kind === 'edit'),
  )?.map((pattern) => describeRule({ kind: 'command', pattern }));
}

/** Most recent auto-allowed actions kept on a record; the count stays exact. */
const auditLimit = 50;
const auditText = (action: PermissionAction) =>
  (action.kind === 'command'
    ? action.command
    : action.kind === 'tool'
      ? action.name
      : action.paths.join(', ')
  )
    .replace(/\s+/g, ' ')
    .slice(0, 300);

/**
 * The request callback for one managed session run. Without a policy it
 * forwards every request. With an approved policy and a managed worktree, a
 * permission request whose action the policy allows is answered here, counted
 * and recorded with the rule that matched.
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
  const previous = record.permissionPolicy;
  const skip = (state: 'awaiting_approval' | 'unavailable', why: string) => {
    record.permissionPolicy = {
      ...previous,
      state,
      autoAllowed: previous?.autoAllowed ?? 0,
      notApplied: [why],
    };
    return { request };
  };
  if (engine.scriptApprovals.pendingPolicy(run.workflowId, definition))
    return skip(
      'awaiting_approval',
      'The policy waits for approval; every action asks',
    );
  let root: string, cwd: string;
  try {
    // The policy's scope is the run's managed worktree, never another directory.
    const workspace = engine.workspaces.path(run, definition);
    if (!workspace) throw new Error('No managed worktree');
    root = realpathSync(workspace);
    cwd = realpathSync(record.cwd);
  } catch {
    return skip(
      'unavailable',
      'The policy applies only in a managed worktree; every action asks',
    );
  }
  const skipped = notApplied(policy, harness);
  const state: NonNullable<ManagedExecution['permissionPolicy']> = {
    ...(previous?.allowed ? { allowed: previous.allowed } : {}),
    state: 'applied',
    autoAllowed: previous?.autoAllowed ?? 0,
    ...(skipped.length ? { notApplied: skipped } : {}),
  };
  record.permissionPolicy = state;
  return {
    permissionPolicy: true,
    request: (input) => {
      const rules =
        input.kind === 'permission' && input.action
          ? policyAllows(policy, input.action, root, harness, cwd)
          : undefined;
      if (!rules) return request(input);
      state.autoAllowed++;
      state.allowed = [
        ...(state.allowed ?? []),
        {
          action: `${input.action!.kind}: ${auditText(input.action!)}`,
          rule: rules.join('; ').slice(0, 300),
          at: new Date().toISOString(),
        },
      ].slice(-auditLimit);
      return Promise.resolve({ allow: true });
    },
  };
}
