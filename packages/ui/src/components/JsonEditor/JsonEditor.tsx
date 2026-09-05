import { Textarea } from '@mantine/core';
import { useEffect, useState, useRef } from 'react';
export function JsonEditor({
  value,
  onChange,
  label,
  rows = 9,
}: {
  value: unknown;
  onChange?: (value: any) => void;
  label: string;
  rows?: number;
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
          setError('');
          e.target.setCustomValidity('');
          onChange?.(parsed);
        } catch {
          setError('Enter valid JSON.');
          e.target.setCustomValidity('Enter valid JSON.');
        }
      }}
    />
  );
}
