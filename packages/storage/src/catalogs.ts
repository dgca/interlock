import type { DatabaseSync } from 'node:sqlite';
import type {
  PromptCatalogEntry,
  WorkflowCatalogEntry,
  WorkflowCatalogQuery,
} from '@interlock/core';

export function workflowCatalog(db: DatabaseSync, query: WorkflowCatalogQuery) {
  const filters = ["collection = 'workflows'"];
  const params: string[] = [];
  if (query.id !== undefined) {
    filters.push('id = ?');
    params.push(query.id);
  }
  if (query.boardId !== undefined) {
    filters.push("json_extract(value, '$.boardId') = ?");
    params.push(query.boardId);
  }
  const rows = db
    .prepare(
      `SELECT id,
      json_extract(value, '$.name') AS name,
      json_extract(value, '$.description') AS description,
      json_extract(value, '$.archived') AS archived,
      json_extract(value, '$.boardId') AS boardId,
      json_extract(value, '$.ownerWorkflowId') AS ownerWorkflowId,
      json_extract(value, '$.latestVersion') AS latestVersion,
      json_array_length(value, '$.draft.nodes') AS nodeCount,
      (SELECT count(*) FROM json_each(w.value, '$.draft.nodes') AS node
        WHERE json_extract(node.value, '$.kind') NOT IN ('entry', 'exit')) AS stepCount
    FROM documents AS w WHERE ${filters.join(' AND ')} ORDER BY rowid`,
    )
    .all(...params) as unknown as (Omit<
    WorkflowCatalogEntry,
    'archived' | 'boardId'
  > & {
    archived: number;
    boardId: string | null;
  })[];
  return rows.map(
    ({ archived, boardId, ...workflow }): WorkflowCatalogEntry => ({
      ...workflow,
      archived: Boolean(archived),
      ...(boardId === null ? {} : { boardId }),
    }),
  );
}

export function promptCatalog(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT id,
      json_extract(value, '$.name') AS name,
      json_extract(value, '$.description') AS description,
      json_extract(value, '$.revision') AS revision,
      json_extract(value, '$.createdAt') AS createdAt,
      json_extract(value, '$.updatedAt') AS updatedAt
    FROM documents WHERE collection = 'prompts' ORDER BY rowid`,
    )
    .all() as unknown as PromptCatalogEntry[];
}
