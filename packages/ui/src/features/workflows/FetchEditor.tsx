import {
  Checkbox,
  Input,
  SegmentedControl,
  NativeSelect,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  jsonSchema,
  resolveFetch,
  type Contract,
  type FetchNode,
  type FetchField,
  type FetchBinding,
} from '@interlock/core';
import { DurationInput } from './DurationInput';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { InputPathInput } from './InputPathInput';
import { TypedValueEditor } from './TypedValueEditor';
import { FetchUrlInput } from './FetchUrlInput';
import styles from './FetchEditor.module.css';

function Fields({
  label,
  fields,
  onChange,
  json = false,
  inputSchema = {},
  inputSource,
}: {
  label: string;
  fields: FetchField[];
  onChange: (fields: FetchField[]) => void;
  json?: boolean;
  inputSchema?: Contract;
  inputSource?: string;
}) {
  const [keys, setKeys] = useState(() => fields.map(() => crypto.randomUUID()));
  const patch = (index: number, value: Partial<FetchField>) =>
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...value } : field)),
    );
  return (
    <section className={styles.fields} aria-label={`${label}s`}>
      <div className={styles.heading}>
        <h3>{label}s</h3>
        <Button
          variant="ghost"
          onClick={() => {
            setKeys([...keys, crypto.randomUUID()]);
            onChange([
              ...fields,
              { name: '', value: { kind: 'fixed', value: '' } },
            ]);
          }}
        >
          <Plus size={14} />
          Add {label.toLowerCase()}
        </Button>
      </div>
      {fields.map((field, index) => (
        <div className={styles.field} key={keys[index]}>
          <div className={styles.values}>
            <div className={styles.nameAndSource}>
              <TextInput
                label="Name"
                aria-label={`${label} name ${index + 1}`}
                value={field.name}
                onChange={(e) => patch(index, { name: e.target.value })}
              />
              <Input.Wrapper label="Value source">
                <SegmentedControl
                  style={{
                    display: 'flex',
                    width: 'fit-content',
                    minHeight: 36,
                  }}
                  aria-label={`${label} value source ${index + 1}`}
                  value={field.value.kind}
                  onChange={(kind) =>
                    patch(index, {
                      value:
                        kind === 'input'
                          ? { kind: 'input', path: '' }
                          : { kind: 'fixed', value: '' },
                    })
                  }
                  data={[
                    { value: 'fixed', label: 'Fixed value' },
                    { value: 'input', label: 'From input' },
                  ]}
                />
              </Input.Wrapper>
            </div>
            {field.value.kind === 'input' ? (
              <InputPathInput
                label="Input field"
                aria-label={`${label} input field ${index + 1}`}
                placeholder="customerId"
                value={field.value.path}
                schema={inputSchema}
                suggestionSource={inputSource}
                onChange={(path) =>
                  patch(index, { value: { kind: 'input', path } })
                }
              />
            ) : json ? (
              <TypedValueEditor
                label={`${label} fixed value ${index + 1}`}
                valueLabel="Fixed value"
                value={field.value.value}
                onChange={(value) =>
                  patch(index, {
                    value: { kind: 'fixed', value } as FetchBinding,
                  })
                }
              />
            ) : (
              <TextInput
                label="Value"
                aria-label={`${label} fixed value ${index + 1}`}
                value={String(field.value.value)}
                onChange={(e) =>
                  patch(index, {
                    value: { kind: 'fixed', value: e.target.value },
                  })
                }
              />
            )}
          </div>
          <Button
            variant="ghost"
            className={styles.remove}
            aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
            title={`Remove ${label.toLowerCase()} ${index + 1}`}
            onClick={() => {
              setKeys(keys.filter((_, i) => i !== index));
              onChange(fields.filter((_, i) => i !== index));
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
    </section>
  );
}
export function FetchEditor({
  node,
  onChange,
  inputSchema = {},
  inputSource,
}: {
  node: FetchNode;
  onChange: (node: FetchNode) => void;
  inputSchema?: Contract;
  inputSource?: string;
}) {
  const patch = (value: Partial<FetchNode>) => onChange({ ...node, ...value });
  const [sample, setSample] = useState('{}');
  let preview: unknown,
    previewError = '';
  try {
    preview = resolveFetch(node, jsonSchema.parse(JSON.parse(sample)));
  } catch (e) {
    previewError = (e as Error).message;
  }
  const bodyAllowed = !['GET', 'HEAD'].includes(node.method);
  return (
    <>
      <div className={styles.request}>
        <NativeSelect
          mb="xs"
          label="Method"
          value={node.method}
          onChange={(e) =>
            patch({
              method: e.target.value as FetchNode['method'],
              ...(['GET', 'HEAD'].includes(e.target.value)
                ? { body: { kind: 'none' } as const }
                : {}),
            })
          }
          data={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']}
        />
        <FetchUrlInput
          value={node.url}
          onChange={(url) => patch({ url })}
          schema={inputSchema}
          suggestionSource={inputSource}
        />
      </div>
      <p className="hint">
        Use {'{{input.field}}'} in the path or query. Inserted values are
        URL-encoded. Field bindings use dot-separated paths such as customer.id
        or items.0.id; missing fields fail the step.
      </p>
      <Fields
        label="Query parameter"
        fields={node.query}
        inputSchema={inputSchema}
        inputSource={inputSource}
        onChange={(query) => patch({ query })}
      />
      <Fields
        label="Header"
        fields={node.headers}
        inputSchema={inputSchema}
        inputSource={inputSource}
        onChange={(headers) => patch({ headers })}
      />
      <NativeSelect
        mb="md"
        label="JSON body"
        disabled={!bodyAllowed}
        value={node.body.kind}
        onChange={(e) => {
          const kind = e.target.value as FetchNode['body']['kind'];
          patch({
            body:
              kind === 'fixed'
                ? { kind, value: {} }
                : kind === 'fields'
                  ? { kind, fields: [] }
                  : { kind },
          });
        }}
      >
        <option value="none">No body</option>
        <option value="input">Use entire input</option>
        <option value="fields">Build from fields</option>
        <option value="fixed">Fixed JSON</option>
      </NativeSelect>
      {node.body.kind === 'fields' && (
        <Fields
          label="Body field"
          json
          fields={node.body.fields}
          inputSchema={inputSchema}
          inputSource={inputSource}
          onChange={(fields) => patch({ body: { kind: 'fields', fields } })}
        />
      )}
      {node.body.kind === 'fixed' && (
        <JsonEditor
          label="Fixed JSON body"
          value={node.body.value}
          onChange={(value) => patch({ body: { kind: 'fixed', value } })}
        />
      )}
      <DurationInput
        key={node.id}
        label="Timeout"
        min={100}
        max={120_000}
        value={node.timeoutMs}
        onChange={(timeoutMs) => patch({ timeoutMs })}
      />
      <Checkbox
        mb="md"
        label="Fail on HTTP errors (outside 200–299)"
        checked={node.failOnHttpError}
        onChange={(e) => patch({ failOnHttpError: e.currentTarget.checked })}
      />
      <p className="hint">
        Returns status, headers, and body. JSON responses are parsed; other
        responses return text. Empty bodies return null. Requests have no
        automatic retries.
      </p>
      <details>
        <summary>Request preview</summary>
        <Textarea
          mt="sm"
          label="Sample input JSON"
          rows={5}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          styles={{ input: { fontFamily: 'var(--mono)' } }}
        />
        <p className="hint">
          Preview only. No request is sent and sample data is not saved.
        </p>
        {previewError ? (
          <p role="status" className="hint">
            {previewError}
          </p>
        ) : (
          <JsonEditor label="Resolved request" value={preview} />
        )}
      </details>
    </>
  );
}
