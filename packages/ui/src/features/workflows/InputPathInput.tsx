import type { ComponentProps } from 'react';
import { Autocomplete } from '@mantine/core';
import { contractAtPath, contractPaths, type Contract } from '@interlock/core';
import { SuggestionInput } from './SuggestionInput';

export function InputPathInput({
  schema,
  value,
  onChange,
  suggestionSource,
  arraysOnly = false,
  stringsOnly = false,
  ...props
}: Omit<ComponentProps<typeof Autocomplete>, 'value' | 'onChange' | 'data'> & {
  schema: Contract;
  value: string;
  onChange: (value: string) => void;
  suggestionSource?: string;
  arraysOnly?: boolean;
  stringsOnly?: boolean;
}) {
  const paths = contractPaths(schema).filter((path) => {
    const field = contractAtPath(schema, path);
    if (arraysOnly && field.type !== 'array') return false;
    if (!stringsOnly) return true;
    if (field.type === 'string') return true;
    if (field.type !== undefined) return false;
    return (
      !Array.isArray(field.enum) ||
      field.enum.every((value) => typeof value === 'string')
    );
  });
  return (
    <SuggestionInput
      {...props}
      value={value}
      onChange={onChange}
      options={paths}
      groupLabel={
        suggestionSource
          ? `Fields from ${suggestionSource.toLowerCase()}`
          : 'Suggested fields'
      }
    />
  );
}
