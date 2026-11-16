import type {
  ExecutorProfile,
  Run,
  WorkflowDefinition,
  WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import type { ManagedAssignment } from './configuration.js';
import type { Session } from './supervision.js';
import { evaluateSessionNameTemplate } from './templates.js';

/** Whether an assignment may continue its continuity group's native session. */
export function continuityProblem(work: ManagedAssignment, session: Session) {
  // An inherited level (harness or global) yields to the session's capture.
  if (
    (work.executorPermissionsSource === 'workflow' ||
      work.executorPermissionsSource === 'preset') &&
    work.executorPermissions !== session.profile.permissions
  )
    return 'This continuity group already uses different permissions. Use the same permissions or a separate continuity group.';
  if (
    work.executorModel !== undefined &&
    (session.requestedModel !== undefined ||
      work.executorModelSource === 'node') &&
    work.executorModel !== (session.requestedModel ?? session.profile.model) &&
    work.executorModel !== session.profile.model
  )
    return 'This continuity group already uses another model. Use the same model or a separate continuity group.';
  if (
    work.executorEffort !== undefined &&
    (work.executorEffort ?? null) !== (session.profile.effort ?? null) &&
    (!Object.hasOwn(session, 'recoveryRequestedEffort') ||
      (work.executorEffort ?? null) !==
        (session.recoveryRequestedEffort ?? null))
  )
    return 'This continuity group already uses another thinking effort. Use the same effort or a separate continuity group.';
}

/** The name a managed session gets from node, workflow or profile templates. */
export function resolveSessionName(
  engine: Pick<Engine, 'store'>,
  work: WorkRequest,
  profile: ExecutorProfile,
): string {
  const run = engine.store.get<Run>('runs', work.runId);
  let definition: WorkflowDefinition | undefined;
  if (run) {
    if (typeof (engine.store as any).getVersion === 'function') {
      const versionRecord = (engine.store as any).getVersion(
        run.workflowId,
        run.version,
      );
      definition = versionRecord?.definition;
    }
    if (!definition) {
      const wf = engine.store.get<{ draft?: WorkflowDefinition }>(
        'workflows',
        run.workflowId,
      );
      definition = wf?.draft;
    }
  }
  const node = definition?.nodes?.find((n: any) => n.id === work.nodeId);
  const template =
    (node as any)?.sessionNameTemplate ||
    definition?.sessionNameTemplate ||
    profile.sessionNameTemplate;
  if (template) {
    const evaluated = evaluateSessionNameTemplate(template, {
      externalTask: run?.externalTask,
      node: node
        ? { id: node.id, label: node.label, kind: node.kind }
        : { id: work.nodeId, label: work.label },
      run: run
        ? { id: run.id, status: run.status, workflowId: run.workflowId }
        : { id: work.runId },
      work: {
        id: work.id,
        attempt: work.attempt,
        nodeId: work.nodeId,
        label: work.label,
      },
      runId: work.runId,
      workId: work.id,
      nodeId: work.nodeId,
    });
    if (evaluated) return evaluated;
  }
  return `interlock-${work.runId}-${work.id}`;
}
