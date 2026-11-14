import { readFile } from 'node:fs/promises';
import {
  setPriceTableSchema,
  setStartCostWarningSchema,
} from '@interlock/core';
export { pricingLines } from '@interlock/core';
import { engineClient } from './engineClient.js';

const json = async (value: string): Promise<unknown> =>
  JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
/**
 * Read the price table, or replace it with {expectedId, table|null}.
 * `prices start-warning [json|@file]` reads or sets {threshold|null}.
 */
export async function runPricesCommand(args: string[]) {
  const client = engineClient();
  if (args[0] === 'start-warning') {
    if (args.length > 2)
      throw new Error('Usage: prices start-warning [json|@file]');
    return args[1]
      ? client.prices.setStartWarning.mutate(
          setStartCostWarningSchema.parse(await json(args[1])),
        )
      : client.prices.startWarning.query();
  }
  if (args.length > 1) throw new Error('Usage: prices [json|@file]');
  if (!args.length) return client.prices.read.query();
  return client.prices.set.mutate(
    setPriceTableSchema.parse(await json(args[0])),
  );
}
