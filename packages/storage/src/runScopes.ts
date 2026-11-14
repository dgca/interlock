import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@interlock/core';
import type { CurrentRun } from './currentState.js';
import { readRuns } from './runExecutions.js';
import { runCursor } from './runQueries.js';

/** Indexed reads for engine paths that previously loaded every retained run. */
export class RunScopes {
  constructor(private readonly db: DatabaseSync) {}

  /** Roots and every descendant (detached included) as compact metadata, in creation order. */
  trees(ids: ReadonlySet<string>): CurrentRun[] {
    if (!ids.size) return [];
    return this.db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
        SELECT value FROM json_each(?)
        UNION
        SELECT child.id FROM tree CROSS JOIN run_metadata child ON child.parent_id = tree.id
      ) SELECT r.value FROM tree CROSS JOIN run_metadata r ON r.id = tree.id ORDER BY r.position`,
      )
      .all(JSON.stringify([...ids]))
      .map((row) => JSON.parse(row.value as string) as CurrentRun);
  }

  /** Direct children that share the parent's lifecycle. */
  attachedChildIds(parentId: string): string[] {
    return this.db
      .prepare(
        `SELECT id FROM run_metadata WHERE parent_id = ?
        AND json_extract(value, '$.parentMode') IS NOT 'detached' ORDER BY position`,
      )
      .all(parentId)
      .map((row) => row.id as string);
  }

  /** Full runs, most recently stored first, after an optional cursor run. */
  page({ limit, afterRunId }: { limit: number; afterRunId?: string }): Run[] {
    const position =
      afterRunId === undefined
        ? Number.MAX_SAFE_INTEGER
        : runCursor(this.db, afterRunId).position;
    return readRuns(
      this.db,
      this.db
        .prepare(
          `SELECT d.value FROM run_metadata m
          CROSS JOIN documents d ON d.collection = 'runs' AND d.id = m.id
          WHERE m.position < ? ORDER BY m.position DESC LIMIT ?`,
        )
        .all(position, limit),
    );
  }

  /** Runs with at least one execution that still holds its resources. */
  withActiveResources(): Run[] {
    return readRuns(
      this.db,
      this.db
        .prepare(
          `SELECT d.value FROM (
          SELECT DISTINCT run_id FROM run_executions INDEXED BY run_executions_resource_active
          WHERE json_extract(value, '$.resourceActive') = 1
        ) a CROSS JOIN documents d ON d.collection = 'runs' AND d.id = a.run_id ORDER BY d.rowid`,
        )
        .all(),
    );
  }

  /** Every run recorded for one comparison sample, including continuations. */
  comparisonSample(comparisonId: string, sampleId: string): Run[] {
    return readRuns(
      this.db,
      this.db
        .prepare(
          `SELECT d.value FROM run_metadata m
          CROSS JOIN documents d ON d.collection = 'runs' AND d.id = m.id
          WHERE json_extract(m.value, '$.comparison.comparisonId') = ?
            AND json_extract(m.value, '$.comparison.sampleId') = ?
          ORDER BY d.rowid`,
        )
        .all(comparisonId, sampleId),
    );
  }
}
