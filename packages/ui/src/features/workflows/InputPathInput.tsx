import { useState, type ComponentProps } from 'react';
import { Autocomplete } from '@mantine/core';
import { contractAtPath, contractPaths, type Contract } from '@interlock/core';

export function InputPathInput({
  schema,
  value,
  onChange,
  onFocus,
  onClick,
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
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const paths = contractPaths(schema).filter(
    (path) => !arraysOnly || contractAtPath(schema, path).type === 'array',
  );
  const matchingPaths = showAllSuggestions
    ? paths
    : paths.filter((path) =>
        path.toLowerCase().includes(value.trim().toLowerCase()),
      );
  const visiblePaths = matchingPaths.slice(0, 50);
  const sourceLabel = suggestionSource
    ? `Fields from ${suggestionSource.toLowerCase()}`
    : 'Suggested fields';
  const groupLabel =
    matchingPaths.length > visiblePaths.length
      ? `${sourceLabel} · first 50 of ${matchingPaths.length}, type to narrow`
      : sourceLabel;
  return (
    <Autocomplete
      {...props}
      value={value}
      onChange={(path) => {
        setShowAllSuggestions(false);
        onChange(path);
      }}
      onFocus={(event) => {
        setShowAllSuggestions(true);
        onFocus?.(event);
      }}
      onClick={(event) => {
        setShowAllSuggestions(true);
        onClick?.(event);
      }}
      data={
        visiblePaths.length
          ? [
              {
                group: groupLabel,
                items: visiblePaths,
              },
            ]
          : visiblePaths
      }
      filter={({ options }) => options}
      maxDropdownHeight={240}
      comboboxProps={{ width: 'target', position: 'bottom-start' }}
    />
  );
}
