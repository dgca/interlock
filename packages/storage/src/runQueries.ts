import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import {
  InterlockError,
  readPath,
  type Run,
  type RunAncestry,
  type RunQuery,
} from '@interlock/core';
import type { CurrentRun } from './currentState.js';

/** Newest-first run lookup over indexed metadata; input is read only for returned rows. */
export function findRuns(
  db: DatabaseSync,
  query: RunQuery,
  runAncestry: (id: string, cache: Map<string, RunAncestry>) => RunAncestry,
) {
  const filters = ['1'];
  const parameters: (string | number)[] = [];
  for (const [key, value] of Object.entries(query.tags ?? {})) {
    filters.push(
      'id IN (SELECT run_id FROM run_tags WHERE tag_key = ? AND tag_value = ?)',
    );
    parameters.push(key, value);
  }
  if (query.requestId !== undefined) {
    filters.push('request_id = ?');
    parameters.push(query.requestId);
  }
  if (query.externalTask) {
    filters.push('task_system = ? AND task_id = ?');
    parameters.push(query.externalTask.system, query.externalTask.id);
  }
  if (query.workflowId !== undefined) {
    filters.push('workflow_id = ?');
    parameters.push(query.workflowId);
  }
  if (query.chainRootRunId !== undefined) {
    filters.push('chain_root_id = ?');
    parameters.push(query.chainRootRunId);
  }
  if (query.status !== undefined) {
    filters.push('status = ?');
    parameters.push(query.status);
  }
  if (query.rootOnly) filters.push('parent_id IS NULL');
  // Tool calls are listed under their Agent execution, not as runs.
  filters.push("json_extract(value, '$.toolCall') IS NULL");
  if (query.afterRunId !== undefined) {
    const cursor = runCursor(db, query.afterRunId);
    filters.push('(created_at, position) < (?, ?)');
    parameters.push(cursor.createdAt, cursor.position);
  }
  const bounded = !query.inputMatch && query.limit !== undefined;
  if (bounded) parameters.push(query.limit);
  const rows = db
    .prepare(
      `SELECT id, value FROM run_metadata WHERE ${filters.join(' AND ')}
    ORDER BY created_at DESC, position DESC ${bounded ? 'LIMIT ?' : ''}`,
    )
    .iterate(...parameters);
  const inputFor = db.prepare(
    "SELECT value -> '$.input' AS input FROM documents WHERE collection = 'runs' AND id = ?",
  );
  const ancestry = new Map<string, RunAncestry>();
  const result: (Pick<
    Run,
    | 'id'
    | 'workflowId'
    | 'workflowName'
    | 'version'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
    | 'cursor'
    | 'input'
    | 'parentRunId'
    | 'batchNodeId'
    | 'parallelBranch'
    | 'comparison'
    | 'chain'
    | 'startRequestId'
    | 'externalTask'
    | 'tags'
  > &
    RunAncestry)[] = [];
  for (const row of rows) {
    const run = JSON.parse(row.value as string) as CurrentRun;
    const rawInput = inputFor.get(row.id as string)?.input;
    const input = (
      typeof rawInput === 'string' ? JSON.parse(rawInput) : undefined
    ) as Run['input'];
    if (query.inputMatch) {
      try {
        if (
          !isDeepStrictEqual(
            readPath(input, query.inputMatch.path),
            query.inputMatch.equals,
          )
        )
          continue;
      } catch {
        continue;
      } // Missing paths do not match, including JSON null.
    }
    const {
      id,
      workflowId,
      workflowName,
      version,
      status,
      createdAt,
      updatedAt,
      cursor,
      parentRunId,
      batchNodeId,
      parallelBranch,
      comparison,
    } = run;
    result.push({
      ...runAncestry(id, ancestry),
      id,
      workflowId,
      workflowName,
      version,
      status,
      createdAt,
      updatedAt,
      cursor,
      input,
      parentRunId,
      batchNodeId,
      ...(parallelBranch ? { parallelBranch } : {}),
      ...(comparison ? { comparison } : {}),
      ...(run.startRequestId !== undefined
        ? { startRequestId: run.startRequestId }
        : {}),
      ...(run.externalTask ? { externalTask: run.externalTask } : {}),
      ...(run.tags !== undefined ? { tags: run.tags } : {}),
      ...(run.chain ? { chain: run.chain } : {}),
    });
    if (result.length === query.limit) break;
  }
  return result;
}

/** Ordering keys of a page cursor, which must name a retained run. */
export function runCursor(db: DatabaseSync, id: string) {
  const row = db
    .prepare('SELECT created_at, position FROM run_metadata WHERE id = ?')
    .get(id);
  if (!row)
    throw new InterlockError(
      `Run ${id} is not retained; restart paging without afterRunId`,
    );
  return {
    createdAt: row.created_at as string,
    position: row.position as number,
  };
}
