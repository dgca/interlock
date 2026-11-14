import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { definitionScripts, type ScriptContent } from '@interlock/core';

export type ScriptApproval = {
  id: string;
  workflowId: string;
  hash: string;
  state: 'pending' | 'approved';
  source: 'import' | 'agent' | 'upgrade';
  createdAt: string;
  approvedAt?: string;
};

/**
 * Omitted language is Bash, so both spellings of a legacy Script share a hash.
 * A permission policy uses its own language tag, so it never shares a Script's hash.
 */
export function scriptContentHash(
  script: ScriptContent | { language: 'permission-policy'; command: string },
) {
  return createHash('sha256')
    .update(JSON.stringify([script.language ?? 'bash', script.command]))
    .digest('hex');
}
export const scriptApprovalId = (workflowId: string, hash: string) =>
  `${workflowId}:${hash}`;

/** Migration step: Script content already stored before approvals existed is approved. */
export function approveExistingScripts(db: DatabaseSync) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO documents VALUES ('scriptApprovals', ?, ?)",
  );
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      "SELECT collection, value FROM documents WHERE collection IN ('workflows', 'versions')",
    )
    .all() as { collection: string; value: string }[];
  for (const row of rows) {
    const doc = JSON.parse(row.value) as {
      id?: unknown;
      workflowId?: unknown;
      draft?: Parameters<typeof definitionScripts>[0];
      definition?: Parameters<typeof definitionScripts>[0];
    };
    const workflowId = row.collection === 'workflows' ? doc.id : doc.workflowId;
    const definition =
      row.collection === 'workflows' ? doc.draft : doc.definition;
    if (typeof workflowId !== 'string' || !Array.isArray(definition?.nodes))
      continue;
    for (const script of definitionScripts(definition)) {
      const hash = scriptContentHash(script);
      const id = scriptApprovalId(workflowId, hash);
      const approval: ScriptApproval = {
        id,
        workflowId,
        hash,
        state: 'approved',
        source: 'upgrade',
        createdAt: now,
        approvedAt: now,
      };
      insert.run(id, JSON.stringify(approval));
    }
  }
}

export function waitingScriptApprovals(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT id AS runId, json_extract(value, '$.executions[#-1].id') AS executionId,
        json_extract(value, '$.executions[#-1].scriptApproval.since') AS since
      FROM documents INDEXED BY script_approval_waiting WHERE collection = 'runs'
        AND json_extract(value, '$.status') = 'waiting'
        AND json_type(value, '$.executions[#-1].scriptApproval') = 'object'
      ORDER BY rowid`,
    )
    .all() as { runId: string; executionId: string; since: string }[];
}
