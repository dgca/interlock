import { Button, TextInput } from '../../design-system';

import { useState } from 'react';

import { Plus, Trash2 } from 'lucide-react';
import styles from './CustomProfileDialog.module.css';

export interface KeyValueEditorProps {
  label: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  tokens?: string[];
}

export function KeyValueEditor({
  label,
  values,
  onChange,
  keyPlaceholder = 'VARIABLE_NAME',
  valuePlaceholder = 'value',
  tokens = [
    '$INTERLOCK_WORK_ID',
    '$INTERLOCK_RUN_ID',
    '$INTERLOCK_CWD',
    '$INTERLOCK_CLAIM_TOKEN',
  ],
}: KeyValueEditorProps) {
  const entries = Object.entries(values);
  const [activeInputIndex, setActiveInputIndex] = useState<number | null>(null);

  const handleKeyChange = (index: number, newKey: string) => {
    const newEntries = [...entries];
    const oldVal = newEntries[index][1];
    newEntries[index] = [newKey, oldVal];
    const result: Record<string, string> = {};
    for (const [k, v] of newEntries) {
      if (k.trim()) result[k] = v;
    }
    onChange(result);
  };

  const handleValueChange = (index: number, newVal: string) => {
    const newEntries = [...entries];
    const key = newEntries[index][0];
    newEntries[index] = [key, newVal];
    const result: Record<string, string> = {};
    for (const [k, v] of newEntries) {
      if (k.trim()) result[k] = v;
    }
    onChange(result);
  };

  const handleAdd = () => {
    const result = { ...values, '': '' };
    onChange(result);
  };

  const handleDelete = (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index);
    const result: Record<string, string> = {};
    for (const [k, v] of newEntries) {
      if (k.trim()) result[k] = v;
    }
    onChange(result);
  };

  const insertToken = (token: string) => {
    if (activeInputIndex !== null && activeInputIndex < entries.length) {
      const currentVal = entries[activeInputIndex][1];
      handleValueChange(activeInputIndex, currentVal + token);
    } else if (entries.length > 0) {
      const lastIndex = entries.length - 1;
      const currentVal = entries[lastIndex][1];
      handleValueChange(lastIndex, currentVal + token);
    } else {
      onChange({ ...values, NEW_VAR: token });
    }
  };

  return (
    <div className={styles.keyValueContainer}>
      <div className={styles.keyValueHeader}>
        <span className={styles.fieldLabel}>{label}</span>
        <Button
          variant="ghost"
          leftSection={<Plus size={12} />}
          onClick={handleAdd}
        >
          Add variable
        </Button>
      </div>

      {entries.length > 0 && (
        <div className={styles.keyValueTable}>
          {entries.map(([key, val], idx) => (
            <div key={idx} className={styles.keyValueRow}>
              <TextInput
                placeholder={keyPlaceholder}
                value={key}
                onChange={(e) => handleKeyChange(idx, e.currentTarget.value)}
                className={styles.keyInput}
              />
              <TextInput
                placeholder={valuePlaceholder}
                value={val}
                onChange={(e) => handleValueChange(idx, e.currentTarget.value)}
                onFocus={() => setActiveInputIndex(idx)}
                className={styles.valueInput}
              />
              <Button
                variant="ghost"
                color="red"
                onClick={() => handleDelete(idx)}
                aria-label="Remove item"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <div className={styles.tokenChips}>
          <span className={styles.tokenChipsLabel}>Template tokens:</span>
          {tokens.map((tok) => (
            <Button
              variant="ghost"
              key={tok}
              className={styles.tokenChip}
              onClick={() => insertToken(tok)}
              title={`Insert ${tok}`}
            >
              {tok}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
