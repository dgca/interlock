import { Button, TextInput } from '../../design-system';

import { Plus, Trash2 } from 'lucide-react';
import styles from './IntegrationEditor.module.css';

export interface KeyValueEditorProps {
  label: string;
  addLabel: string;
  hideLabel?: boolean;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueEditor({
  label,
  addLabel,
  hideLabel = false,
  values,
  onChange,
  keyPlaceholder = 'VARIABLE_NAME',
  valuePlaceholder = 'value',
}: KeyValueEditorProps) {
  const entries = Object.entries(values);

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

  return (
    <div className={styles.keyValueContainer}>
      <div className={styles.keyValueHeader}>
        {!hideLabel && <span className={styles.fieldLabel}>{label}</span>}
        <Button
          variant="ghost"
          leftSection={<Plus size={12} />}
          onClick={handleAdd}
        >
          {addLabel}
        </Button>
      </div>

      {entries.length > 0 && (
        <div className={styles.keyValueTable}>
          {entries.map(([key, val], idx) => (
            <div key={idx} className={styles.keyValueRow}>
              <TextInput
                aria-label={`${label} key ${idx + 1}`}
                placeholder={keyPlaceholder}
                value={key}
                onChange={(e) => handleKeyChange(idx, e.currentTarget.value)}
                className={styles.keyInput}
              />
              <TextInput
                aria-label={`${label} value ${idx + 1}`}
                placeholder={valuePlaceholder}
                value={val}
                onChange={(e) => handleValueChange(idx, e.currentTarget.value)}
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
    </div>
  );
}
