import { useEffect, useRef, useState } from 'react';
import { NativeSelect, Stack, TextInput } from '@mantine/core';
import { nodeSchema, type WorkflowNode } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { bindingNodes, type InputBinding } from './inputBindings';
import styles from './InputBindingsEditor.module.css';

type Row = { name: string; binding: InputBinding };
const rowsFrom = (value: WorkflowNode['inputBindings']): Row[] =>
  Object.entries(value ?? {}).map(([name, binding]) => ({ name, binding }));

export function InputBindingsEditor({
  node,
  nodes,
  onChange,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  onChange: (bindings: WorkflowNode['inputBindings']) => void;
}) {
  const value = node.inputBindings;
  const serialized = JSON.stringify(value);
  const emitted = useRef(serialized);
  const [rows, setRows] = useState(() => rowsFrom(value));
  const [advanced, setAdvanced] = useState(false);
  const [choosingFields, setChoosingFields] = useState(value !== undefined);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (serialized !== emitted.current) {
      setRows(rowsFrom(value));
      setChoosingFields(value !== undefined);
      emitted.current = serialized;
    }
  }, [serialized, value]);
  const candidates = bindingNodes(node, nodes);
  const nameError = (row: Row, list = rows) =>
    !row.name
      ? 'Enter an input field name.'
      : list.filter((other) => other.name === row.name).length > 1
        ? 'Each input field needs a unique name.'
        : '';
  const update = (next: Row[]) => {
    setRows(next);
    if (next.some((row) => nameError(row, next))) return;
    const bindings = next.length
      ? Object.fromEntries(next.map((row) => [row.name, row.binding]))
      : undefined;
    emitted.current = JSON.stringify(bindings);
    onChange(bindings);
  };
  const patch = (index: number, changes: Partial<Row>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const sources = [
    { value: 'input', label: 'Previous step output' },
    { value: 'node', label: 'Node output' },
    { value: 'runInput', label: 'Original workflow input' },
    { value: 'rootInput', label: 'Original root input' },
    ...(node.batchId || rows.some((row) => row.binding.source === 'itemInput')
      ? [
          {
            value: 'itemInput',
            label: 'Original Batch item',
            disabled: !node.batchId,
          },
        ]
      : []),
  ];
  return (
    <Stack gap="md" mb="md" ref={form}>
      <NativeSelect
        label="Get input from"
        aria-label="Get input from"
        value={choosingFields ? 'fields' : 'previous'}
        data={[
          { value: 'previous', label: 'Previous step output' },
          { value: 'fields', label: 'Choose fields' },
        ]}
        onChange={(event) => {
          const choose = event.target.value === 'fields';
          setChoosingFields(choose);
          if (!choose) {
            update([]);
            setAdvanced(false);
          }
        }}
      />
      {choosingFields && (
        <Stack gap="md">
          {value === undefined && rows.length === 0 && (
            <p className="hint">
              Add fields to replace the previous step's output with an input
              object.
            </p>
          )}
          {value !== undefined && rows.length === 0 && (
            <p className="hint">
              No fields are selected. This step receives an empty input object.
            </p>
          )}
          {!advanced &&
            rows.map((row, index) => (
              <fieldset key={index} className={styles.field}>
                <legend>Field {index + 1}</legend>
                <div className={styles.fields}>
                  <TextInput
                    label="Input field"
                    aria-label={`Input field ${index + 1}`}
                    value={row.name}
                    required
                    error={nameError(row) || undefined}
                    ref={(element) =>
                      element?.setCustomValidity(nameError(row))
                    }
                    onChange={(event) =>
                      patch(index, { name: event.target.value })
                    }
                  />
                  <NativeSelect
                    label="Read from"
                    aria-label={`Read from for field ${index + 1}`}
                    value={row.binding.source}
                    data={sources}
                    onChange={(event) => {
                      const source = event.target
                        .value as InputBinding['source'];
                      patch(index, {
                        binding:
                          source === 'node'
                            ? { source, nodeId: '', path: row.binding.path }
                            : { source, path: row.binding.path },
                      });
                    }}
                  />
                  {row.binding.source === 'node' && (
                    <NativeSelect
                      label="Node"
                      aria-label={`Node for field ${index + 1}`}
                      value={row.binding.nodeId}
                      required
                      description="Latest completed result in this run."
                      onChange={(event) =>
                        patch(index, {
                          binding: {
                            source: 'node',
                            nodeId: event.target.value,
                            path: row.binding.path,
                          },
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose a node
                      </option>
                      {!candidates.some(
                        (candidate) =>
                          row.binding.source === 'node' &&
                          candidate.id === row.binding.nodeId,
                      ) &&
                        row.binding.nodeId && (
                          <option value={row.binding.nodeId} disabled>
                            Unavailable node · {row.binding.nodeId}
                          </option>
                        )}
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label} · {candidate.id}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                  <TextInput
                    label="Output path"
                    aria-label={`Output path for field ${index + 1}`}
                    value={row.binding.path}
                    placeholder="Whole output"
                    description="Dot-separated fields or array indices. Blank selects the whole value."
                    onChange={(event) =>
                      patch(index, {
                        binding: { ...row.binding, path: event.target.value },
                      })
                    }
                  />
                </div>
                <div className={styles.actions}>
                  <Button
                    variant="ghost"
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => {
                      update(rows.filter((_, i) => i !== index));
                      if (rows.length === 1) setChoosingFields(false);
                    }}
                  >
                    Remove field
                  </Button>
                </div>
              </fieldset>
            ))}
          {!advanced && (
            <Button
              onClick={() => {
                let name = 'field';
                for (
                  let suffix = 2;
                  rows.some((row) => row.name === name);
                  suffix++
                )
                  name = `field${suffix}`;
                update([
                  ...rows,
                  { name, binding: { source: 'input', path: '' } },
                ]);
              }}
            >
              Add input field
            </Button>
          )}
          {advanced && (
            <JsonEditor
              label="Input fields JSON"
              value={value ?? {}}
              rows={8}
              validate={(input) => {
                const result = nodeSchema.safeParse({
                  ...node,
                  inputBindings: input,
                });
                return result.success
                  ? undefined
                  : result.error.issues
                      .map((issue) => issue.message)
                      .join('; ');
              }}
              onChange={(input) => {
                const bindings = nodeSchema.parse({
                  ...node,
                  inputBindings: input,
                }).inputBindings;
                emitted.current = JSON.stringify(bindings);
                setRows(rowsFrom(bindings));
                onChange(bindings);
              }}
            />
          )}
          <Button
            variant="ghost"
            onClick={() => {
              const invalid =
                form.current?.querySelector<HTMLInputElement>(':invalid');
              if (invalid) {
                invalid.reportValidity();
                return;
              }
              setAdvanced(!advanced);
            }}
          >
            {advanced ? 'Use field editor' : 'Advanced JSON'}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
