import {
  definitionScripts,
  InterlockError,
  type NodeExecution,
  type Run,
  type ScriptApprovalMode,
  type ScriptContent,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import {
  scriptApprovalId,
  scriptContentHash,
  type ScriptApproval,
  type Store,
} from '@interlock/storage';

type Settings = { id: string; mode: ScriptApprovalMode };
type Effects = {
  save: (run: Run) => void;
  event: (run: Run, message: string) => void;
};
const collection = 'scriptApprovals';

/**
 * One-time approval of imported Script content. Approval is keyed by workflow
 * and content hash: content a person or agent writes has no pending record and
 * runs, and an edit of approved content is new content.
 */
export class ScriptApprovals {
  constructor(
    private store: Store,
    private effects?: Effects,
  ) {}

  settings(): { mode: ScriptApprovalMode } {
    const saved = this.store.get<Settings>('scriptApprovalSettings', 'library');
    return { mode: saved?.mode ?? 'imports' };
  }
  saveSettings(mode: ScriptApprovalMode) {
    this.store.put<Settings>('scriptApprovalSettings', { id: 'library', mode });
    return this.settings();
  }

  /** The content hash when this Script must wait for approval. */
  required(workflowId: string, script: ScriptContent) {
    if (this.settings().mode === 'off') return undefined;
    const hash = scriptContentHash(script);
    const record = this.store.get<ScriptApproval>(
      collection,
      scriptApprovalId(workflowId, hash),
    );
    return record?.state === 'pending' ? hash : undefined;
  }

  /**
   * Hold a step whose Script needs approval. Returns undefined when it may run,
   * true when the hold starts now and false while it continues.
   */
  hold(run: Run, execution: NodeExecution, script: ScriptContent) {
    const hash = this.required(run.workflowId, script);
    const step = execution.kind === 'script';
    if (!hash) {
      if (execution.scriptApproval) {
        delete execution.scriptApproval;
        if (step) execution.status = run.status = 'running';
        this.effects?.save(run);
      }
      return undefined;
    }
    if (execution.scriptApproval?.hash === hash) return false;
    execution.scriptApproval = { hash, since: new Date().toISOString() };
    if (step) execution.status = run.status = 'waiting';
    this.effects?.save(run);
    this.effects?.event(run, `${execution.label}: waiting for Script approval`);
    return true;
  }

  /** Last check before a Script process starts. Relaunch monitoring is exempt. */
  assertApproved(run: Run, execution: NodeExecution, script: ScriptContent) {
    if (!execution.background && this.required(run.workflowId, script))
      throw new InterlockError(
        `${execution.label}: imported Script needs approval before it runs`,
      );
  }

  /** The stored draft and retained versions, before an import or edit replaces them. */
  definitions(workflowId: string): WorkflowDefinition[] {
    const workflow = this.store.get<Workflow>('workflows', workflowId);
    return workflow
      ? [
          workflow.draft,
          ...this.store.listVersions(workflowId).map((v) => v.definition),
        ]
      : [];
  }

  /** Record content new to this workflow as pending. Known and decided content is kept. */
  record(
    workflowId: string,
    previous: WorkflowDefinition[],
    next: WorkflowDefinition[],
    source: 'import' | 'agent' = 'import',
  ) {
    const known = new Set(
      previous.flatMap((d) => definitionScripts(d).map(scriptContentHash)),
    );
    const createdAt = new Date().toISOString();
    for (const script of next.flatMap(definitionScripts)) {
      const hash = scriptContentHash(script);
      const id = scriptApprovalId(workflowId, hash);
      if (known.has(hash) || this.store.get(collection, id)) continue;
      this.store.put<ScriptApproval>(collection, {
        id,
        workflowId,
        hash,
        state: 'pending',
        source,
        createdAt,
      });
    }
  }

  /** Capture imported workflows before an import, then record their new content. */
  importing(
    entries: {
      id: string;
      draft: WorkflowDefinition;
      versions: { definition: WorkflowDefinition }[];
    }[],
  ) {
    const previous = entries.map((entry) => this.definitions(entry.id));
    return () =>
      entries.forEach((entry, index) =>
        this.record(entry.id, previous[index], [
          entry.draft,
          ...entry.versions.map((version) => version.definition),
        ]),
      );
  }

  /** Carry unapproved content to a workflow copied from another one. */
  copyPending(fromId: string, toId: string) {
    for (const record of this.store.list<ScriptApproval>(collection))
      if (record.workflowId === fromId && record.state === 'pending')
        this.store.put<ScriptApproval>(collection, {
          ...record,
          id: scriptApprovalId(toId, record.hash),
          workflowId: toId,
        });
  }

  /** Gate an agent's draft change when the library extends approval to agents. */
  recordAgentEdit(workflowId: string, previous: WorkflowDefinition[]) {
    if (this.settings().mode !== 'imports_and_agents') return;
    const workflow = this.store.get<Workflow>('workflows', workflowId);
    if (workflow) this.record(workflowId, previous, [workflow.draft], 'agent');
  }

  /** The Script a waiting step runs, with its approval record. */
  step(run: Run, execution: NodeExecution) {
    // The same definition the engine gates: the run's current version.
    const version = this.store.getVersion(run.workflowId, run.version);
    const node = version?.definition.nodes.find(
      (n) => n.id === execution.nodeId,
    );
    const script = node && definitionScripts({ nodes: [node] })[0];
    if (!script) return undefined;
    const hash = scriptContentHash(script);
    return {
      ...script,
      hash,
      record: this.store.get<ScriptApproval>(
        collection,
        scriptApprovalId(run.workflowId, hash),
      ),
    };
  }

  approve(target: { runId: string; executionId: string }) {
    const run = this.store.get<Run>('runs', target.runId);
    const execution = run?.executions.find((e) => e.id === target.executionId);
    const script = run && execution && this.step(run, execution);
    if (!script?.record)
      throw new InterlockError('Script approval request not found');
    if (script.record.state === 'approved') return script.record;
    const approved: ScriptApproval = {
      ...script.record,
      state: 'approved',
      approvedAt: new Date().toISOString(),
    };
    this.store.put(collection, approved);
    this.store.touchRun(target.runId);
    return approved;
  }
}
