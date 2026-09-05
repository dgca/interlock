import { Tabs, Textarea } from '@mantine/core';
import { createContext, useContext, useRef, useState } from 'react';
import { Braces, List, WandSparkles } from 'lucide-react';
import {
  contractExample,
  fieldType,
  fieldTypes,
  inferContract,
  propertiesOf,
  validateContractSchema,
  visualIssues,
  type Contract,
} from '@interlock/core';
import { Modal } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { FieldEditor } from './FieldEditor';
import styles from './ContractEditor.module.css';

export type ContractPage = {
  value: Contract;
  label: string;
  onApply: (schema: Contract) => void;
};
export const ContractNavigation = createContext<
  ((page: ContractPage) => void) | null
>(null);

export function ContractEditor({
  value,
  onChange,
  label,
}: {
  value: Contract;
  onChange: (schema: Contract) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useContext(ContractNavigation);
  const issues = visualIssues(value),
    type = fieldType(value);
  const summary = issues.length
    ? 'Advanced JSON Schema'
    : type === 'object'
      ? `${Object.keys(propertiesOf(value)).length} named fields`
      : fieldTypes[type];
  return (
    <section className={styles.card}>
      <div>
        <span>{label}</span>
        <strong>{summary}</strong>
        {!issues.length && type === 'object' && (
          <small>
            {Object.keys(propertiesOf(value)).slice(0, 4).join(', ') ||
              'Add fields to describe the data.'}
          </small>
        )}
        {!issues.length && type === 'any' && (
          <small>No restrictions on the value.</small>
        )}
      </div>
      <Button
        onClick={() =>
          navigate
            ? navigate({ value, label, onApply: onChange })
            : setOpen(true)
        }
      >
        <List size={14} />
        {issues.length ? 'Edit schema' : 'Edit fields'}
      </Button>
      {open && (
        <Modal
          title={`${label} contract`}
          onClose={() => setOpen(false)}
          size={960}
        >
          <ContractForm
            value={value}
            onClose={() => setOpen(false)}
            onApply={(schema) => {
              onChange(schema);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
export function ContractForm({
  value,
  onClose,
  onApply,
}: {
  value: Contract;
  onClose: () => void;
  onApply: (schema: Contract) => void;
}) {
  const [draft, setDraft] = useState<Contract>(() => structuredClone(value));
  const [mode, setMode] = useState<'fields' | 'advanced' | 'example'>(() =>
    visualIssues(value).length ? 'advanced' : 'fields',
  );
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2)),
    [example, setExample] = useState(''),
    [notes, setNotes] = useState<string[]>([]),
    [error, setError] = useState('');
  const body = useRef<HTMLDivElement>(null);
  let candidate = draft,
    parseError = '';
  if (mode === 'advanced')
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('The schema must be a JSON object.');
      candidate = parsed;
    } catch (e) {
      parseError = (e as Error).message;
    }
  const issues = visualIssues(candidate);
  const switchMode = (next: 'fields' | 'advanced' | 'example') => {
    if (mode === 'advanced') {
      if (parseError) {
        setError(parseError);
        return;
      }
      setDraft(candidate);
    }
    const invalid = body.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    setError('');
    if (next === 'advanced') setRaw(JSON.stringify(candidate, null, 2));
    setMode(next);
  };
  const apply = () => {
    const invalid = body.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    try {
      if (parseError) throw new Error(parseError);
      validateContractSchema(candidate);
      onApply(candidate);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Tabs
        value={mode}
        onChange={(value) => {
          if (value === 'fields' || value === 'advanced' || value === 'example')
            switchMode(value);
        }}
        mb="lg"
      >
        <Tabs.List>
          <Tabs.Tab
            value="fields"
            disabled={issues.length > 0 || Boolean(parseError)}
            leftSection={<List size={15} />}
          >
            Fields
          </Tabs.Tab>
          <Tabs.Tab value="advanced" leftSection={<Braces size={15} />}>
            Advanced JSON
          </Tabs.Tab>
          <Tabs.Tab value="example" leftSection={<WandSparkles size={15} />}>
            Generate from example JSON
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value={mode} pt="lg">
          <div ref={body} className={styles.layout}>
            <section className={styles.editing}>
              {mode === 'example' ? (
                <>
                  <h3>Start with a result you would expect</h3>
                  <p className="hint">
                    This creates a replacement draft. Review it before applying.
                    Examples reveal structure, but cannot establish which fields
                    are always required.
                  </p>

                  <Textarea
                    mb="md"
                    label="Example JSON"
                    aria-label="Example JSON"
                    styles={{ input: { fontFamily: 'var(--mono)' } }}
                    rows={14}
                    value={example}
                    placeholder={
                      '{\n  "findings": "...",\n  "sources": [{"title": "Docs", "url": "https://example.com"}]\n}'
                    }
                    onChange={(e) => setExample(e.target.value)}
                  />

                  <Button
                    variant="primary"
                    onClick={() => {
                      try {
                        if (example.length > 100000)
                          throw new Error(
                            'Use an example smaller than 100 KB.',
                          );
                        const inferred = inferContract(JSON.parse(example));
                        setDraft(inferred.schema);
                        setRaw(JSON.stringify(inferred.schema, null, 2));
                        setNotes(inferred.notes);
                        setMode(
                          visualIssues(inferred.schema).length
                            ? 'advanced'
                            : 'fields',
                        );
                        setError('');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Generate draft
                  </Button>
                </>
              ) : mode === 'advanced' ? (
                <>
                  {issues.length > 0 && (
                    <div className={styles.notice}>
                      <strong>Preserved in advanced mode</strong>
                      <p>
                        This contract uses features the field editor cannot
                        represent. Its full schema stays intact.
                      </p>
                      <ul>
                        {issues.slice(0, 5).map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Textarea
                    mb="md"
                    label="JSON Schema"
                    aria-label="Advanced JSON Schema"
                    styles={{ input: { fontFamily: 'var(--mono)' } }}
                    rows={22}
                    value={raw}
                    spellCheck={false}
                    onChange={(e) => {
                      setRaw(e.target.value);
                      setError('');
                    }}
                  />

                  {parseError && <p className="error-text">{parseError}</p>}
                </>
              ) : (
                <FieldEditor schema={draft} onChange={setDraft} />
              )}
            </section>
            <aside className={styles.preview}>
              <span className="eyebrow">EXAMPLE VALUE</span>
              <p className="hint">
                An illustrative value, updated as you edit. Field descriptions
                guide the agent; required fields may still use an explicit
                “unknown” choice.
              </p>
              {!issues.length && !parseError ? (
                <pre aria-label="Example value">
                  {JSON.stringify(contractExample(candidate), null, 2)}
                </pre>
              ) : (
                <p className="hint">
                  Preview is available for contracts supported by the field
                  editor.
                </p>
              )}
              {notes.length > 0 && (
                <div className={styles.notice}>
                  <strong>Review these assumptions</strong>
                  <ul>
                    {notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
        </Tabs.Panel>
      </Tabs>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={mode === 'example' || Boolean(parseError)}
          onClick={apply}
        >
          Apply contract
        </Button>
      </div>
    </>
  );
}
