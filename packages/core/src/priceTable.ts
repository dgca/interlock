import type { PriceTable } from './pricing.js';

// Public list prices, standard (non-batch, non-priority) processing, in integer
// millionths of USD per million tokens. Edit the table at runtime with
// `interlock prices`; replace this default only from the vendors' pages below.
//
// Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
//   (IDs: https://platform.claude.com/docs/en/about-claude/models/overview),
//   retrieved 2026-11-13. cacheWrite is the 5-minute cache write rate.
//   Omitted: Claude Haiku 5.5 (price depends on each request's prompt size),
//   and Opus 4, Opus 4.1 and Sonnet 4 (retired on the Claude API).
// OpenAI: https://developers.openai.com/api/docs/pricing, retrieved 2026-11-13.
//   Short-context rates (requests up to 272K input tokens); cacheWrite is the
//   30-minute write rate where listed. Omitted: models the page does not list,
//   including gpt-5.x-codex variants other than gpt-5.3-codex.
const m = (dollars: number) => Math.round(dollars * 1_000_000);
const anthropic = (
  model: string,
  input: number,
  cacheWrite: number,
  cachedInput: number,
  output: number,
) => ({
  provider: 'anthropic',
  model,
  inputMicros: m(input),
  cachedInputMicros: m(cachedInput),
  cacheWriteMicros: m(cacheWrite),
  outputMicros: m(output),
});
const openai = (
  model: string,
  input: number,
  output: number,
  cachedInput: number,
  cacheWrite?: number,
) => ({
  provider: 'openai',
  model,
  inputMicros: m(input),
  cachedInputMicros: m(cachedInput),
  ...(cacheWrite === undefined ? {} : { cacheWriteMicros: m(cacheWrite) }),
  outputMicros: m(output),
});

export const DEFAULT_PRICE_TABLE: PriceTable = {
  version: '2026-11-13',
  currency: 'USD',
  sources: [
    {
      url: 'https://platform.claude.com/docs/en/about-claude/pricing',
      retrievedAt: '2026-11-13',
    },
    {
      url: 'https://developers.openai.com/api/docs/pricing',
      retrievedAt: '2026-11-13',
    },
  ],
  models: [
    // model, input, 5m cache write, cache hit, output
    anthropic('claude-fable-5-2', 8, 10, 0.2, 40),
    anthropic('claude-mythos-5-2', 8, 10, 0.2, 40),
    anthropic('claude-fable-5-1', 10, 12.5, 0.25, 50),
    anthropic('claude-mythos-5-1', 10, 12.5, 0.25, 50),
    anthropic('claude-fable-5', 10, 12.5, 1, 50),
    anthropic('claude-mythos-5', 10, 12.5, 1, 50),
    anthropic('claude-opus-5-5', 4, 5, 0.2, 20),
    anthropic('claude-opus-5', 5, 6.25, 0.5, 25),
    anthropic('claude-opus-4-8', 5, 6.25, 0.5, 25),
    anthropic('claude-opus-4-7', 5, 6.25, 0.5, 25),
    anthropic('claude-opus-4-6', 5, 6.25, 0.5, 25),
    anthropic('claude-opus-4-5', 5, 6.25, 0.5, 25),
    anthropic('claude-sonnet-5-5', 2, 2.5, 0.1, 10),
    anthropic('claude-sonnet-5', 2, 2.5, 0.2, 10),
    anthropic('claude-sonnet-4-6', 3, 3.75, 0.3, 15),
    anthropic('claude-sonnet-4-5', 3, 3.75, 0.3, 15),
    anthropic('claude-haiku-4-5', 1, 1.25, 0.1, 5),
    // model, input, output, cached input, 30m cache write
    openai('gpt-6-astra', 10, 50, 1, 12.5),
    openai('gpt-6.1-sol', 2, 10, 0.1, 2.5),
    openai('gpt-6.1-terra', 1, 5, 0.05, 1.25),
    openai('gpt-6-sol', 2, 10, 0.2, 2.5),
    openai('gpt-6-luna', 0.1, 0.5, 0.01, 0.125),
    openai('gpt-5.6-sol', 4, 20, 0.4, 5),
    openai('gpt-5.6-terra', 2, 12, 0.2, 2.5),
    openai('gpt-5.6-luna', 0.2, 1.2, 0.02, 0.25),
    openai('gpt-5.5', 5, 30, 0.5),
    openai('gpt-5.4', 2.5, 15, 0.25),
    openai('gpt-5.4-mini', 0.75, 4.5, 0.075),
    openai('gpt-5.3-codex', 1.75, 14, 0.175),
    openai('gpt-5.2', 1.75, 14, 0.175),
  ],
};
