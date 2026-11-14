import type { EventDelivery } from '@interlock/core';
import type { DatabaseSync } from 'node:sqlite';

/** Newest-first page of a trigger's lifecycle deliveries with its exact total. */
export function eventDeliveries(
  db: DatabaseSync,
  triggerId: string,
  offset: number,
  limit: number,
) {
  const total = Number(
    db
      .prepare(
        "SELECT count(*) AS total FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ?",
      )
      .get(triggerId)!.total,
  );
  const items = db
    .prepare(
      "SELECT value FROM documents WHERE collection = 'eventDeliveries' AND json_extract(value, '$.triggerId') = ? ORDER BY json_extract(value, '$.createdAt') DESC, rowid DESC LIMIT ? OFFSET ?",
    )
    .all(triggerId, limit, offset)
    .map((row) => JSON.parse(row.value as string) as EventDelivery);
  return {
    items,
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null,
  };
}

/**
 * Newest-first page of one collection's documents whose top-level fields
 * equal the filters, with the exact total. Only the page is parsed.
 */
export function documentPage<T>(
  db: DatabaseSync,
  collection: string,
  filters: Readonly<Record<string, string>>,
  offset: number,
  limit: number,
) {
  const fields = Object.keys(filters);
  if (fields.some((field) => !/^[A-Za-z]\w*$/.test(field)))
    throw new Error('Invalid document filter');
  const where = [
    'collection = ?',
    ...fields.map((field) => `json_extract(value, '$.${field}') = ?`),
  ].join(' AND ');
  const values = [collection, ...fields.map((field) => filters[field])];
  const total = Number(
    db
      .prepare(`SELECT count(*) AS total FROM documents WHERE ${where}`)
      .get(...values)!.total,
  );
  const items = db
    .prepare(
      `SELECT value FROM documents WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset)
    .map((row) => JSON.parse(row.value as string) as T);
  return { items, total };
}
