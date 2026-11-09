import { Group, NativeSelect, TextInput } from '@mantine/core';
import { useState } from 'react';

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
  const precision = Math.max(
    0,
    (decimal.split('.')[1]?.length ?? 0) - Number(exponent),
  );
  const ms = amount * unit;
  // An integer unit cannot add decimal places. Remove multiplication noise
  // beyond the amount's precision without rounding actual fractional ms.
  // toFixed supports at most 100 places; retain smaller fractions unchanged.
  return precision > 100 ? ms : Number(ms.toFixed(precision));
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
  const [unit, setUnit] = useState(
    () =>
      [...units]
        .reverse()
        .find((unit) => value >= unit.ms && value % unit.ms === 0)?.ms ?? 1000,
  );
  return (
    <Group align="flex-end" grow mb="md" maw={360} gap="sm" wrap="nowrap">
      <TextInput
        label={label}
        type="number"
        required
        min={min / unit}
        max={max / unit}
        // Fractional steps such as 1/60 lose precision in native validation.
        // Schemas enforce each field's precision and bounds.
        step={step !== undefined && step % unit === 0 ? step / unit : 'any'}
        value={value / unit}
        onChange={(e) => onChange(toMilliseconds(Number(e.target.value), unit))}
      />
      <NativeSelect
        label="Unit"
        aria-label={`${label} unit`}
        value={unit}
        onChange={(e) => {
          const next = Number(e.target.value);
          onChange(Math.round((value / unit) * next));
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
