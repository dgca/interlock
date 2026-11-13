import { z } from 'zod';
import type { ModelUsage } from './usage.js';

// Rates are integer millionths of the table currency per million tokens, so
// $0.075 / MTok is 75000. Integer rates keep every derived sum exact.
const rate = z.number().int().min(0).max(1_000_000_000_000);
const name = z.string().trim().min(1).max(200);
const modelPriceSchema = z
  .object({
    provider: name,
    model: name,
    inputMicros: rate,
    cachedInputMicros: rate.optional(),
    cacheWriteMicros: rate.optional(),
    outputMicros: rate,
  })
  .strict();
export const priceTableSchema = z
  .object({
    version: z.string().trim().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
    sources: z
      .array(
        z
          .object({ url: z.string().max(500), retrievedAt: z.string().max(40) })
          .strict(),
      )
      .max(20)
      .default([]),
    models: z.array(modelPriceSchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.models.map((model) =>
      JSON.stringify([model.provider, model.model]),
    );
    if (new Set(keys).size !== keys.length)
      context.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'Provider/model pairs must be unique',
      });
  });
export const setPriceTableSchema = z
  .object({
    expectedId: z
      .string()
      .min(1)
      .max(100)
      .describe('Current table id from the price table read.'),
    table: priceTableSchema
      .nullable()
      .describe('Replacement table; null restores the shipped default.'),
  })
  .strict();
export type ModelPrice = z.infer<typeof modelPriceSchema>;
export type PriceTable = z.infer<typeof priceTableSchema>;
export type SetPriceTableInput = z.input<typeof setPriceTableSchema>;
/** The table a run captured: content-addressed, so it never changes later. */
export interface PriceTableRef {
  id: string;
  version: string;
  custom: boolean;
}
/** Marks a cost Interlock derived; reported costs never carry it. */
interface DerivedCostBasis {
  priceTable: PriceTableRef;
  price: ModelPrice;
}
/** Why tokens reported without cost have no derived cost either. */
type PriceGap = z.infer<typeof priceGapSchema>;
export type PricedModelUsage = ModelUsage & {
  derivedCost?: DerivedCostBasis;
  priceGap?: PriceGap;
};

/**
 * Executors report dated snapshots (claude-haiku-4-5-20251001, or
 * claude-haiku-4-5@20251001 on Vertex) and context-window tags such as
 * claude-opus-4-7[1m]. Table entries name the undated model; an exact entry
 * still wins, so a table can price one snapshot differently.
 */
function normalizedModelId(model: string) {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, '')
    .replace(/[-@]\d{8}$/, '');
}
export function findModelPrice(
  table: PriceTable,
  provider: string,
  model: string,
): ModelPrice | null {
  const sameProvider = table.models.filter(
    (entry) => entry.provider.toLowerCase() === provider.trim().toLowerCase(),
  );
  return (
    sameProvider.find((entry) => entry.model === model) ??
    sameProvider.find(
      (entry) => normalizedModelId(entry.model) === normalizedModelId(model),
    ) ??
    null
  );
}

export type TokenCounts = Pick<
  ModelUsage,
  'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteInputTokens'
>;
/**
 * Price cumulative token counts with one model's rates. Pure and storage-free.
 * inputTokens includes cached reads and cache writes; reasoning tokens are part
 * of outputTokens. Unknown cached or cache-write counts are priced as ordinary
 * input. Returns null when input or output is unknown or the total is unsafe.
 */
export function priceTokens(
  tokens: TokenCounts,
  price: ModelPrice,
): number | null {
  const { inputTokens, outputTokens } = tokens;
  if (inputTokens === undefined || outputTokens === undefined) return null;
  const cached = tokens.cachedInputTokens ?? 0;
  const written = tokens.cacheWriteInputTokens ?? 0;
  const uncached = inputTokens - cached - written;
  if (uncached < 0) return null;
  const scaled =
    BigInt(uncached) * BigInt(price.inputMicros) +
    BigInt(cached) * BigInt(price.cachedInputMicros ?? price.inputMicros) +
    BigInt(written) * BigInt(price.cacheWriteMicros ?? price.inputMicros) +
    BigInt(outputTokens) * BigInt(price.outputMicros);
  // Round half up once, after summing every token class.
  const micros = (scaled + 500_000n) / 1_000_000n;
  return micros > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(micros);
}

/**
 * Price one model's usage with a run's captured table (null when the run
 * captured none). A reported cost always wins and is returned untouched.
 */
export function priceModelUsage(
  model: ModelUsage,
  table: PriceTable | null,
  ref: PriceTableRef | null,
): PricedModelUsage {
  if (model.cost) return model;
  if (model.inputTokens === undefined && model.outputTokens === undefined)
    return model;
  if (!table || !ref) return { ...model, priceGap: 'no_table' };
  const price = findModelPrice(table, model.provider, model.model);
  if (!price) return { ...model, priceGap: 'no_price' };
  const amountMicros = priceTokens(model, price);
  if (amountMicros === null) return { ...model, priceGap: 'incomplete_tokens' };
  return {
    ...model,
    cost: {
      amountMicros,
      currency: table.currency,
      source: `Interlock price table ${ref.version}${ref.custom ? ' (edited)' : ''}`,
    },
    derivedCost: { priceTable: ref, price },
  };
}

const PRICING_DETAIL_LIMIT = 20;
/**
 * State which prices a total assumed and which models have none. Present only
 * when usage passed through run pricing; bounded for MCP and API readers.
 */
export function summarizePricing(
  models: (PricedModelUsage | undefined)[],
): PricingSummary | undefined {
  const derived = models.filter((model) => model?.derivedCost);
  const gaps = models.filter((model) => model?.priceGap);
  if (!derived.length && !gaps.length) return undefined;
  const tables = new Map<string, PriceTableRef>();
  const prices = new Map<string, ModelPrice & { priceTableId: string }>();
  for (const model of derived) {
    const { priceTable, price } = model!.derivedCost!;
    tables.set(priceTable.id, priceTable);
    prices.set(JSON.stringify([priceTable.id, price.provider, price.model]), {
      ...price,
      priceTableId: priceTable.id,
    });
  }
  const unpriced = new Map<
    string,
    { provider: string; model: string; reason: PriceGap }
  >();
  for (const model of gaps)
    unpriced.set(
      JSON.stringify([model!.provider, model!.model, model!.priceGap]),
      {
        provider: model!.provider,
        model: model!.model,
        reason: model!.priceGap!,
      },
    );
  const sorted = <T>(map: Map<string, T>) =>
    [...map.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, value]) => value);
  return {
    derivedModels: derived.length,
    unpricedModels: gaps.length,
    tables: sorted(tables),
    prices: sorted(prices).slice(0, PRICING_DETAIL_LIMIT),
    unpriced: sorted(unpriced).slice(0, PRICING_DETAIL_LIMIT),
    truncated:
      prices.size > PRICING_DETAIL_LIMIT ||
      unpriced.size > PRICING_DETAIL_LIMIT,
  };
}
const priceGapSchema = z.enum(['no_table', 'no_price', 'incomplete_tokens']);
export const pricingSummarySchema = z
  .object({
    derivedModels: z.number().int().min(0),
    unpricedModels: z.number().int().min(0),
    tables: z.array(
      z.object({ id: z.string(), version: z.string(), custom: z.boolean() }),
    ),
    prices: z.array(modelPriceSchema.extend({ priceTableId: z.string() })),
    unpriced: z.array(
      z.object({
        provider: z.string(),
        model: z.string(),
        reason: priceGapSchema,
      }),
    ),
    truncated: z.boolean(),
  })
  .strict();
export type PricingSummary = z.infer<typeof pricingSummarySchema>;

// Dollars with at least two decimals: 4000000 -> 4.00, 75000 -> 0.075.
const perMTok = (micros: number) =>
  (micros / 1_000_000).toFixed(6).replace(/(\.\d\d\d*?)0+$/, '$1');
const gapText: Record<PriceGap, string> = {
  no_table: 'run predates price capture',
  no_price: 'not in the price table',
  incomplete_tokens: 'input or output tokens unknown',
};
/** Plain-text statement of the prices a total assumed, for CLI and UI. */
export function pricingLines(usage: { pricing?: PricingSummary }) {
  const pricing = usage.pricing;
  if (!pricing) return [];
  const tables = pricing.tables
    .map((table) => `${table.version}${table.custom ? ' (edited)' : ''}`)
    .join(', ');
  return [
    ...(pricing.derivedModels
      ? [
          `  Derived from price table ${tables} for ${pricing.derivedModels} model reports without executor cost (per million tokens):`,
          ...pricing.prices.map(
            (price) =>
              `    ${price.provider}/${price.model}: input ${perMTok(price.inputMicros)}, cached ${perMTok(price.cachedInputMicros ?? price.inputMicros)}, cache write ${perMTok(price.cacheWriteMicros ?? price.inputMicros)}, output ${perMTok(price.outputMicros)}`,
          ),
        ]
      : []),
    ...(pricing.unpricedModels
      ? [
          `  No price for ${pricing.unpricedModels} model reports: ${pricing.unpriced.map((gap) => `${gap.provider}/${gap.model} (${gapText[gap.reason]})`).join(', ')}`,
        ]
      : []),
    ...(pricing.truncated ? ['  Price details truncated.'] : []),
  ];
}
