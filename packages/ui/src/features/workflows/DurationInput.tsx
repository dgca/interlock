import { Group, NativeSelect, TextInput } from '@mantine/core';
import { useRef, useState } from 'react';

const units = [
  { label: 'Milliseconds', ms: 1 },
  { label: 'Seconds', ms: 1000 },
  { label: 'Minutes', ms: 60_000 },
  { label: 'Hours', ms: 3_600_000 },
  { label: 'Days', ms: 86_400_000 },
];
export function formatDuration(ms: number) {
  const unit =
    [...units].reverse().find((unit) => ms >= unit.ms && ms % unit.ms === 0) ??
    units[0];
  const amount = ms / unit.ms;
  return `${amount} ${amount === 1 ? unit.label.toLowerCase().slice(0, -1) : unit.label.toLowerCase()}`;
}

function toMilliseconds(amount: number, unit: number) {
  const [decimal, exponent = '0'] = String(amount).split('e');
  const ms = amount * unit;
  if (!Number.isFinite(ms)) return { ms, wholeMilliseconds: false };
  const scale = (decimal.split('.')[1]?.length ?? 0) - Number(exponent);
  const coefficient = BigInt(decimal.replace('.', '')) * BigInt(unit);
  const numerator =
    scale < 0 ? coefficient * 10n ** BigInt(-scale) : coefficient;
  const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n;
  const wholeMilliseconds = numerator % denominator === 0n;
  // Normalize only exact integers. Floating-point multiplication can produce
  // either noise around an integer or an integer from a genuine fraction.
  return {
    ms: wholeMilliseconds ? Number(numerator / denominator) : ms,
    wholeMilliseconds,
  };
}

export function DurationInput({
  label,
  value,
  min = 0,
  max = 31_536_000_000,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (ms: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [unit, setUnit] = useState(
    () =>
      [...units]
        .reverse()
        .find((unit) => value >= unit.ms && value % unit.ms === 0)?.ms ?? 1000,
  );
  const changeAmount = (amount: number, nextUnit: number) => {
    const result = toMilliseconds(amount, nextUnit);
    input.current?.setCustomValidity(
      result.wholeMilliseconds ? '' : 'Use a whole number of milliseconds.',
    );
    onChange(result.ms);
  };
  return (
    <Group align="flex-end" grow mb="md" maw={360} gap="sm" wrap="nowrap">
      <TextInput
        ref={input}
        label={label}
        type="number"
        required
        min={min / unit}
        max={max / unit}
        // Fractional steps such as 1/60 lose precision in native validation.
        // Schemas enforce each field's precision and bounds.
        step={step !== undefined && step % unit === 0 ? step / unit : 'any'}
        value={value / unit}
        onChange={(event) => changeAmount(Number(event.target.value), unit)}
      />
      <NativeSelect
        label="Unit"
        aria-label={`${label} unit`}
        value={unit}
        onChange={(e) => {
          const next = Number(e.target.value);
          changeAmount(value / unit, next);
          setUnit(next);
        }}
        data={units
          .filter((unit) => unit.ms <= max && unit.ms >= (step ?? 1))
          .map((unit) => ({
            value: String(unit.ms),
            label: unit.label,
          }))}
      />
    </Group>
  );
}
