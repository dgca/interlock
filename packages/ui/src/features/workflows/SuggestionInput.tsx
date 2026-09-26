import { useState, type ComponentProps } from 'react';
import { Autocomplete } from '@mantine/core';

export function SuggestionInput({
  value,
  onChange,
  onFocus,
  onClick,
  options,
  groupLabel,
  ...props
}: Omit<ComponentProps<typeof Autocomplete>, 'value' | 'onChange' | 'data'> & {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  groupLabel: string;
}) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const matchingOptions = showAllSuggestions
    ? options
    : options.filter((option) =>
        option.toLowerCase().includes(value.trim().toLowerCase()),
      );
  const visibleOptions = matchingOptions.slice(0, 50);
  const label =
    matchingOptions.length > visibleOptions.length
      ? `${groupLabel} · first 50 of ${matchingOptions.length}, type to narrow`
      : groupLabel;
  return (
    <Autocomplete
      {...props}
      value={value}
      onChange={(next) => {
        setShowAllSuggestions(false);
        onChange(next);
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
        visibleOptions.length
          ? [{ group: label, items: visibleOptions }]
          : visibleOptions
      }
      filter={({ options }) => options}
      maxDropdownHeight={240}
      comboboxProps={{ width: 'target', position: 'bottom-start' }}
    />
  );
}
