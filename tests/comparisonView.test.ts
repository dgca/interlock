// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  availabilityText,
  costText,
  type ComparisonSide,
} from '../packages/ui/src/features/testing/comparisonText';

const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('../packages/ui/src/lib/api', async () => {
  const { mockRpcClient } = await import('./mockRpcClient');
  return {
    api: mockRpcClient({ testbench: { report: { query: mocks.report } } }),
    errorMessage: (error: Error) => error.message,
  };
});
const { notPassedChecks } =
  await import('../packages/ui/src/features/testing/SampleChecks');

afterEach(() => vi.clearAllMocks());

const usage = (
  costs: { value: number | null; overflow?: boolean }[],
  costCoverage: string,
) =>
  ({
    costs: costs.map((c, i) => ({
      currency: ['USD', 'EUR'][i],
      amountMicros: {
        value: c.value,
        coverage: c.value === null ? 'unknown' : 'complete',
        overflow: c.overflow ?? false,
      },
    })),
    costCoverage,
    currencyCount: costs.length,
    currenciesTruncated: false,
  }) as unknown as ComparisonSide['usage'];

it('keeps unknown, overflowing and partial costs explicit', () => {
  expect(costText(usage([], 'unknown'))).toBe('Not reported');
  expect(costText(usage([{ value: null }], 'unknown'))).toBe(
    'Unknown USD · unknown',
  );
  expect(costText(usage([{ value: 1, overflow: true }], 'complete'))).toBe(
    'Too large to total USD',
  );
  expect(
    costText(usage([{ value: 1_500_000 }, { value: 250_000 }], 'partial')),
  ).toBe('1.5 USD, 0.25 EUR · partial');
});

it('names each availability gap and never claims a winner', () => {
  expect(
    availabilityText({
      state: 'insufficient_evidence',
      reasons: ['reported_cost_incomplete', 'quality_unjudged', 'new_reason'],
    }),
  ).toBe(
    'Incomplete evidence: reported cost is incomplete; some samples have no quality judgment; new_reason.',
  );
  expect(
    availabilityText({ state: 'pending', reasons: ['execution_pending'] }),
  ).toBe('Still running: samples are still running.');
  expect(availabilityText({ state: 'descriptive', reasons: [] })).toMatch(
    /does not pick a winner/,
  );
});

it('finds a failed check beyond the report’s first check page', async () => {
  const check = (index: number, status: string) => ({
    index,
    kind: 'output',
    status,
    reason: status === 'fail' ? 'Output does not satisfy equals' : 'ok',
    assertion: {
      kind: 'output',
      path: `p${index}`,
      visit: 1,
      operator: 'exists',
    },
    expectedOmitted: false,
  });
  mocks.report.mockImplementation(({ checkOffset }: { checkOffset: number }) =>
    Promise.resolve({
      samples: [
        {
          observation: {
            checks: Array.from(
              { length: Math.min(10, 15 - checkOffset) },
              (_, i) =>
                check(
                  checkOffset + i,
                  checkOffset + i === 11 ? 'fail' : 'pass',
                ),
            ),
          },
        },
      ],
    }),
  );
  const found = await notPassedChecks('comparison', 3, 15);
  expect(found.map((c) => c.index)).toEqual([11]);
  expect(mocks.report).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'comparison',
      offset: 3,
      limit: 1,
      checkOffset: 10,
    }),
  );
});
