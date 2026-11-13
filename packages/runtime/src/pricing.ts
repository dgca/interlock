import { createHash } from 'node:crypto';
import {
  DEFAULT_PRICE_TABLE,
  InterlockError,
  priceModelUsage,
  priceTableSchema,
  setPriceTableSchema,
  type PriceTable,
  type PriceTableRef,
  type RunUsageReport,
  type SetPriceTableInput,
  type UsageAttempt,
  type UsageSnapshot,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

// Content-addressed tables never change, so a captured run is priced the same
// way forever. The setting names the table new runs capture.
const tables = 'priceTables';
const setting = 'priceTableSetting';
const captures = 'runPricing';
interface StoredTable extends PriceTableRef {
  table: PriceTable;
}
interface RunPricing {
  id: string;
  runId: string;
  priceTableId: string;
  capturedAt: string;
}

function tableRecord(table: PriceTable, custom: boolean): StoredTable {
  const id = createHash('sha256')
    .update(JSON.stringify({ custom, table }))
    .digest('hex')
    .slice(0, 16);
  return { id, version: table.version, custom, table };
}
const shipped = tableRecord(priceTableSchema.parse(DEFAULT_PRICE_TABLE), false);
const reference = ({ id, version, custom }: StoredTable): PriceTableRef => ({
  id,
  version,
  custom,
});
const needsPrice = (snapshot: UsageSnapshot) =>
  snapshot.models.some(
    (model) =>
      !model.cost &&
      (model.inputTokens !== undefined || model.outputTokens !== undefined),
  );

export class Pricing {
  constructor(private store: Store) {}

  private current(): StoredTable {
    const selected = this.store.get<{ priceTableId: string }>(
      setting,
      'current',
    );
    return (
      (selected &&
        this.store.get<StoredTable>(tables, selected.priceTableId)) ||
      shipped
    );
  }
  read() {
    const current = this.current();
    return {
      ...reference(current),
      table: current.table,
      shippedVersion: shipped.version,
    };
  }
  set(input: SetPriceTableInput) {
    const { expectedId, table } = setPriceTableSchema.parse(input);
    return this.store.transaction(() => {
      if (this.current().id !== expectedId)
        throw new InterlockError(
          'Price table changed; read the current table before replacing it',
        );
      if (table === null) this.store.remove(setting, 'current');
      else {
        const record = tableRecord(table, true);
        if (!this.store.get(tables, record.id)) this.store.put(tables, record);
        this.store.put(setting, { id: 'current', priceTableId: record.id });
      }
      return this.read();
    });
  }
  /** Pin the current table to a run the first time it reports unpriced tokens. */
  capture(runId: string, snapshot: UsageSnapshot) {
    if (!needsPrice(snapshot) || this.store.get(captures, runId)) return;
    const current = this.current();
    if (!this.store.get(tables, current.id)) this.store.put(tables, current);
    this.store.put<RunPricing>(captures, {
      id: runId,
      runId,
      priceTableId: current.id,
      capturedAt: new Date().toISOString(),
    });
  }

  forRuns(runIds: Set<string>) {
    return this.price(
      this.store.forRuns<UsageAttempt>('usageAttempts', runIds),
      this.store.forRuns<RunUsageReport>('runUsage', runIds),
    );
  }
  /** Add derived costs to reads. Stored reports, and budgets, stay unchanged. */
  price(attempts: UsageAttempt[], runReports: RunUsageReport[] = []) {
    const runIds = new Set([
      ...attempts.map((attempt) => attempt.runId),
      ...runReports.map((report) => report.runId),
    ]);
    const loaded = new Map<string, StoredTable | null>();
    const byRun = new Map<string, StoredTable | null>();
    for (const capture of this.store.forRuns<RunPricing>(captures, runIds)) {
      if (!loaded.has(capture.priceTableId))
        loaded.set(
          capture.priceTableId,
          this.store.get<StoredTable>(tables, capture.priceTableId) ?? null,
        );
      byRun.set(capture.runId, loaded.get(capture.priceTableId)!);
    }
    const priced = (runId: string, snapshot: UsageSnapshot) => {
      const stored = byRun.get(runId) ?? null;
      return {
        ...snapshot,
        models: snapshot.models.map((model) =>
          priceModelUsage(
            model,
            stored?.table ?? null,
            stored ? reference(stored) : null,
          ),
        ),
      };
    };
    return {
      attempts: attempts.map((attempt) => ({
        ...attempt,
        ...(attempt.snapshot
          ? { snapshot: priced(attempt.runId, attempt.snapshot) }
          : {}),
        ...(attempt.observerReport
          ? {
              observerReport: {
                ...attempt.observerReport,
                snapshot: priced(
                  attempt.runId,
                  attempt.observerReport.snapshot,
                ),
              },
            }
          : {}),
      })),
      runReports: runReports.map((report) => ({
        ...report,
        snapshot: priced(report.runId, report.snapshot),
      })),
    };
  }
}
