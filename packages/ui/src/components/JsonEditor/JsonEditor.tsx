import { Textarea } from '@mantine/core';
import { useEffect, useState, useRef } from 'react';
export function JsonEditor({
  value,
  onChange,
  label,
  rows = 9,
  validate,
}: {
  value: unknown;
  onChange?: (value: any) => void;
  label: string;
  rows?: number;
  validate?: (value: unknown) => string | undefined;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const serialized = JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized),
    [error, setError] = useState('');
  useEffect(() => {
    setText(serialized);
    setError('');
    ref.current?.setCustomValidity('');
  }, [serialized]);
  return (
    <Textarea
      mb="md"
      error={error || undefined}
      label={label}
      ref={ref}
      styles={{ input: { fontFamily: 'var(--mono)' } }}
      aria-label={label}
      rows={rows}
      value={text}
      readOnly={!onChange}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const parsed = JSON.parse(e.target.value);
          const problem = validate?.(parsed);
          setError(problem ?? '');
          e.target.setCustomValidity(problem ?? '');
          if (!problem) onChange?.(parsed);
        } catch {
          setError('Enter valid JSON.');
          e.target.setCustomValidity('Enter valid JSON.');
        }
      }}
    />
  );
}
