import type { StartCostProjection } from '@interlock/core';
import { Alert } from '../../design-system';

const money = (micros: number, currency: string) =>
  `${currency} ${(micros / 1e6).toFixed(2)}`;
/** Shown before a start whose recent median cost exceeds the threshold. */
export function StartCostWarning({ cost }: { cost: StartCostProjection }) {
  return (
    <Alert color="yellow" title="Large run" mb="md">
      Recent runs of this workflow cost a median of{' '}
      {money(cost.medianMicros, cost.currency)} ({cost.sampleSize} runs), above
      the {money(cost.thresholdMicros, cost.currency)} warning threshold.
    </Alert>
  );
}
