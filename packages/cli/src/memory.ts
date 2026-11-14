import {
  memoryManageSchema,
  memoryReadSchema,
  workMemorySchema,
} from '@interlock/core';
import { engineClient } from './engineClient.js';
import { parse } from './json.js';

/** Workflow memory: read and manage notes, or read and write during a claim. */
export async function runMemoryCommand(args: string[]) {
  const [mode, request] = args;
  if (args.length !== 2 || !['read', 'manage', 'work'].includes(mode))
    throw new Error('Usage: memory <read|manage|work> <json|@file>');
  const client = engineClient();
  const body: unknown = await parse(request);
  if (mode === 'read')
    return client.memory.read.query(memoryReadSchema.parse(body));
  return mode === 'manage'
    ? client.memory.manage.mutate(memoryManageSchema.parse(body))
    : client.memory.work.mutate(workMemorySchema.parse(body));
}
