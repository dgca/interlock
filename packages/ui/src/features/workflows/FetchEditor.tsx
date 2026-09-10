import {
  Checkbox,
  Input,
  SegmentedControl,
  Group,
  NativeSelect,
  Stack,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useState } from 'react';
import {
  jsonSchema,
  resolveFetch,
  type FetchNode,
  type FetchField,
  type FetchBinding,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';

function Fields({
  label,
  fields,
  onChange,
  json = false,
}: {
  label: string;
  fields: FetchField[];
  onChange: (fields: FetchField[]) => void;
  json?: boolean;
}) {
  const patch = (index: number, value: Partial<FetchField>) =>
    onChange(
      fields.map((field, i) => (i === index ? { ...field, ...value } : field)),
    );
  return (
    <Stack gap="sm" mb="md">
      <strong>{label}</strong>
      {fields.map((field, index) => (
        <Stack
          gap="xs"
          key={index}
          p="sm"
          style={{ border: '1px solid var(--border)', borderRadius: 6 }}
        >
          <Group grow align="end">
            <TextInput
              label={`${label} name ${index + 1}`}
              value={field.name}
              onChange={(e) => patch(index, { name: e.target.value })}
            />
            <Input.Wrapper label={`${label} value source ${index + 1}`}>
              <SegmentedControl
                mt={4}
                style={{ display: 'flex', width: 'fit-content' }}
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
          </Group>
          {field.value.kind === 'input' ? (
            <TextInput
              label={`${label} input field ${index + 1}`}
              placeholder="customerId"
              value={field.value.path}
              onChange={(e) =>
                patch(index, { value: { kind: 'input', path: e.target.value } })
              }
            />
          ) : json ? (
            <JsonEditor
              label={`${label} fixed JSON ${index + 1}`}
              rows={3}
              value={field.value.value}
              onChange={(value) =>
                patch(index, {
                  value: { kind: 'fixed', value } as FetchBinding,
                })
              }
            />
          ) : (
            <TextInput
              label={`${label} fixed value ${index + 1}`}
              value={String(field.value.value)}
              onChange={(e) =>
                patch(index, {
                  value: { kind: 'fixed', value: e.target.value },
                })
              }
            />
          )}
          <Button
            onClick={() => onChange(fields.filter((_, i) => i !== index))}
          >
            Remove {label.toLowerCase()} {index + 1}
          </Button>
        </Stack>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...fields,
            { name: '', value: { kind: 'fixed', value: '' } },
          ])
        }
      >
        Add {label.toLowerCase()}
      </Button>
    </Stack>
  );
}
export function FetchEditor({
  node,
  onChange,
}: {
  node: FetchNode;
  onChange: (node: FetchNode) => void;
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
      <Group grow align="end" mb="md">
        <NativeSelect
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
        <TextInput
          label="Timeout, milliseconds"
          type="number"
          min={100}
          max={120000}
          required
          value={node.timeoutMs}
          onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
        />
      </Group>
      <TextInput
        mb="xs"
        label="URL"
        placeholder="https://api.example.com/customers/{{input.customerId}}"
        value={node.url}
        onChange={(e) => patch({ url: e.target.value })}
      />
      <p className="hint">
        Use {'{{input.field}}'} in the path or query. Inserted values are
        URL-encoded. Field bindings use dot-separated paths such as customer.id
        or items.0.id; missing fields fail the step.
      </p>
      <Fields
        label="Query parameter"
        fields={node.query}
        onChange={(query) => patch({ query })}
      />
      <Fields
        label="Header"
        fields={node.headers}
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
