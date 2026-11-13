import { readFile } from 'node:fs/promises';
import { setPriceTableSchema } from '@interlock/core';
export { pricingLines } from '@interlock/core';
import { engineClient } from './engineClient.js';

/** Read the price table, or replace it with {expectedId, table|null}. */
export async function runPricesCommand(args: string[]) {
  if (args.length > 1) throw new Error('Usage: prices [json|@file]');
  const client = engineClient();
  if (!args.length) return client.prices.read.query();
  const value = args[0];
  return client.prices.set.mutate(
    setPriceTableSchema.parse(
      JSON.parse(
        value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
      ),
    ),
  );
}
