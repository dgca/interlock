import { NativeSelect, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { Json } from '@interlock/core';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
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
}: {
  value: Json;
  onChange: (value: Json) => void;
  label: string;
}) {
  const [type, setType] = useState<ValueType>(() => valueType(value));
  return (
    <div className={styles.matchValue}>
      <NativeSelect
        label="Type"
        aria-label={`${label} type`}
        value={type}
        onChange={(event) => {
          const next = event.target.value as ValueType;
          setType(next);
          // JSON can represent the current value without converting it.
          onChange(
            next === 'json' || next === valueType(value)
              ? value
              : defaults[next],
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
        {type === 'text' && (
          <TextInput
            label="Match value"
            aria-label={label}
            placeholder="e.g. ticket"
            value={value as string}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {type === 'number' && (
          <NumberValue
            value={value as number}
            onChange={onChange}
            label={label}
          />
        )}
        {type === 'boolean' && (
          <NativeSelect
            label="Match value"
            aria-label={label}
            value={String(value)}
            data={['true', 'false']}
            onChange={(event) => onChange(event.target.value === 'true')}
          />
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
      </div>
    </div>
  );
}
