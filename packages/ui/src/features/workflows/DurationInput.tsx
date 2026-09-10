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

export function DurationInput({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (ms: number) => void;
}) {
  const [unit, setUnit] = useState(
    () =>
      [...units]
        .reverse()
        .find((unit) => value >= unit.ms && value % unit.ms === 0)?.ms ?? 1000,
  );
  return (
    <Group align="flex-end" grow mb="md">
      <TextInput
        label={label}
        type="number"
        required
        min={min / unit}
        max={31_536_000_000 / unit}
        step="any"
        value={value / unit}
        onChange={(e) => onChange(Number(e.target.value) * unit)}
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
        data={units.map((unit) => ({
          value: String(unit.ms),
          label: unit.label,
        }))}
      />
    </Group>
  );
}
