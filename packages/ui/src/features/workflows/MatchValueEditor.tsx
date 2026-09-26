import { Input, SegmentedControl, Select, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import {
  fieldType,
  fieldTypes,
  type Contract,
  type Json,
} from '@interlock/core';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { SuggestionInput } from './SuggestionInput';
import styles from './SwitchEditor.module.css';

type ValueType = 'text' | 'number' | 'boolean' | 'null' | 'json';
function valueType(value: Json): ValueType {
  if (value === null) return 'null';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}
const defaults: Record<ValueType, Json> = {
  text: '',
  number: 0,
  boolean: true,
  null: null,
  json: {},
};
export function suggestedMatchValue(schema: Contract): Json {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const value = schema.enum[0];
    if (
      value === null ||
      ['string', 'number', 'boolean'].includes(typeof value)
    )
      return value as Json;
  }
  switch (fieldType(schema)) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'object':
      return {};
    case 'array':
      return [];
    default:
      return '';
  }
}

function NumberValue({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(String(value));
    setError('');
    ref.current?.setCustomValidity('');
  }, [value]);
  return (
    <TextInput
      label="Match value"
      aria-label={label}
      inputMode="decimal"
      ref={ref}
      value={text}
      error={error || undefined}
      onChange={(event) => {
        const text = event.target.value;
        setText(text);
        let number: unknown;
        try {
          number = JSON.parse(text);
        } catch {
          /* Keep incomplete typing in the field. */
        }
        const valid = typeof number === 'number' && Number.isFinite(number);
        const problem = valid ? '' : 'Enter a number, such as 42 or 3.5.';
        event.target.setCustomValidity(problem);
        setError(problem);
        if (valid) onChange(number as number);
      }}
    />
  );
}

/** Keep JSON types intact while making ordinary text editable without JSON syntax. */
export function MatchValueEditor({
  value,
  onChange,
  label,
  suggestedSchema = {},
  suggestionSource,
}: {
  value: Json;
  onChange: (value: Json) => void;
  label: string;
  suggestedSchema?: Contract;
  suggestionSource?: string;
}) {
  const [type, setType] = useState<ValueType>(() => valueType(value));
  const expected = fieldType(suggestedSchema);
  const choices =
    Array.isArray(suggestedSchema.enum) &&
    suggestedSchema.enum.every((item) => typeof item === 'string')
      ? (suggestedSchema.enum as string[])
      : [];
  return (
    <div className={styles.matchValue}>
      <Select
        label="Type"
        aria-label={`${label} type`}
        value={type}
        allowDeselect={false}
        onChange={(next) => {
          if (!next) return;
          const nextType = next as ValueType;
          setType(nextType);
          // JSON can represent the current value without converting it.
          onChange(
            nextType === 'json' || nextType === valueType(value)
              ? value
              : defaults[nextType],
          );
        }}
        data={[
          { value: 'text', label: 'Text' },
          { value: 'number', label: 'Number' },
          { value: 'boolean', label: 'Boolean' },
          { value: 'null', label: 'Null' },
          { value: 'json', label: 'JSON' },
        ]}
      />
      <div className={styles.value}>
        {type === 'text' && choices.length > 0 ? (
          <SuggestionInput
            label="Match value"
            aria-label={label}
            value={value as string}
            options={choices}
            groupLabel={
              suggestionSource
                ? `Values from ${suggestionSource.toLowerCase()}`
                : 'Suggested values'
            }
            onChange={onChange}
          />
        ) : (
          type === 'text' && (
            <TextInput
              label="Match value"
              aria-label={label}
              value={value as string}
              onChange={(event) => onChange(event.target.value)}
            />
          )
        )}
        {type === 'number' && (
          <NumberValue
            value={value as number}
            onChange={onChange}
            label={label}
          />
        )}
        {type === 'boolean' && (
          <Input.Wrapper label="Match value">
            <SegmentedControl
              aria-label={label}
              fullWidth
              value={String(value)}
              data={[
                { value: 'true', label: 'True' },
                { value: 'false', label: 'False' },
              ]}
              onChange={(next) => onChange(next === 'true')}
            />
          </Input.Wrapper>
        )}
        {type === 'null' && (
          <TextInput
            label="Match value"
            aria-label={label}
            value="null"
            readOnly
          />
        )}
        {type === 'json' && (
          <JsonEditor
            label={`${label}, as JSON`}
            value={value}
            onChange={onChange}
            rows={2}
          />
        )}
        {expected !== 'any' && (
          <small className={styles.expected}>
            Input field: {fieldTypes[expected]}
          </small>
        )}
      </div>
    </div>
  );
}
