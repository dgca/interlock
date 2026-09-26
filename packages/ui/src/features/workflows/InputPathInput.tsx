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
  ...props
}: Omit<ComponentProps<typeof Autocomplete>, 'value' | 'onChange' | 'data'> & {
  schema: Contract;
  value: string;
  onChange: (value: string) => void;
  suggestionSource?: string;
  arraysOnly?: boolean;
}) {
  const paths = contractPaths(schema).filter(
    (path) => !arraysOnly || contractAtPath(schema, path).type === 'array',
  );
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
