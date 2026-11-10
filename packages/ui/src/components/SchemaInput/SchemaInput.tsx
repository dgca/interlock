import {
  TextInput,
  Input,
  NumberInput,
  Select,
  SegmentedControl,
  JsonEditor,
} from '../../design-system';

import { useRef } from 'react';
import type { Json } from '@interlock/core';

/** Common object contracts get fields; complex values remain editable JSON. */
export function SchemaInput({
  schema,
  value,
  onChange,
  onValidityChange,
  disabledKeys = [],
}: {
  schema: Record<string, unknown>;
  value: Record<string, Json>;
  onChange: (value: Record<string, Json>) => void;
  onValidityChange?: (valid: boolean) => void;
  disabledKeys?: string[];
}) {
  const invalid = useRef(new Set<string>());
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return (
    <>
      {Object.entries(properties).map(([key, property]) => {
        const label = typeof property.title === 'string' ? property.title : key;
        const update = (next: Json | undefined) => {
          const result = { ...value };
          if (next === undefined) delete result[key];
          else result[key] = next;
          onChange(result);
        };
        const required =
          Array.isArray(schema.required) && schema.required.includes(key);
        const disabled = disabledKeys.includes(key);
        const description = disabled
          ? 'Provided by schedule metadata.'
          : typeof property.description === 'string'
            ? property.description
            : undefined;
        if (
          Array.isArray(property.enum) &&
          property.enum.every((item) => typeof item === 'string')
        )
          return (
            <Select
              mb="md"
              key={key}
              label={label}
              description={description}
              withAsterisk={required}
              aria-required={required}
              disabled={disabled}
              clearable={!required}
              value={typeof value[key] === 'string' ? value[key] : null}
              data={property.enum as string[]}
              onChange={(next) => update(next ?? undefined)}
            />
          );
        if (property.type === 'string')
          return (
            <TextInput
              mb="md"
              key={key}
              label={label}
              description={description}
              withAsterisk={required}
              aria-required={required}
              disabled={disabled}
              value={typeof value[key] === 'string' ? value[key] : ''}
              onChange={(e) => update(e.target.value)}
            />
          );
        if (property.type === 'number' || property.type === 'integer')
          return (
            <NumberInput
              mb="md"
              key={key}
              label={label}
              description={description}
              withAsterisk={required}
              aria-required={required}
              disabled={disabled}
              allowDecimal={property.type !== 'integer'}
              value={typeof value[key] === 'number' ? value[key] : ''}
              onChange={(next) =>
                update(typeof next === 'number' ? next : undefined)
              }
            />
          );
        if (property.type === 'boolean')
          return (
            <Input.Wrapper
              label={label}
              description={description}
              withAsterisk={required}
              aria-required={required}
              mb="md"
              key={key}
            >
              <SegmentedControl
                mt={4}
                style={{ display: 'flex', width: 'fit-content' }}
                aria-label={label}
                disabled={disabled}
                value={String(value[key] ?? false)}
                onChange={(next) => update(next === 'true')}
                data={[
                  { value: 'false', label: 'False' },
                  { value: 'true', label: 'True' },
                ]}
              />
            </Input.Wrapper>
          );
        return (
          <JsonEditor
            key={key}
            label={label}
            value={value[key] ?? null}
            onChange={disabled ? undefined : update}
            rows={8}
            onValidityChange={(valid) => {
              if (valid) invalid.current.delete(key);
              else invalid.current.add(key);
              onValidityChange?.(invalid.current.size === 0);
            }}
          />
        );
      })}
    </>
  );
}
