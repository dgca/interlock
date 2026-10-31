import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  NativeSelect,
  Stack,
  TextInput,
  Switch,
  Text,
  Group,
} from '@mantine/core';
import {
  contractAtPath,
  nodeOutputContract,
  valueBindingsSchema,
  STARTED_RUN_SCHEMA,
  type Contract,
  type WorkflowNode,
  type WorkflowDefinition,
  type ValueBinding,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { bindingNodes } from './inputBindings';
import { InputPathInput } from './InputPathInput';
import { TypedValueEditor, suggestedMatchValue } from './TypedValueEditor';
import {
  bindingRows,
  bindingsFromRows,
  bindingRowError,
  renameBindingRow,
  type BindingRow,
} from './bindingRows';
import styles from './InputBindingsEditor.module.css';

export function InputBindingsEditor({
  node,
  nodes,
  definition,
  incomingSchema = {},
  workflowInputSchema = {},
  mode = 'input',
  onChange,
}: {
  node: WorkflowNode;
  nodes: WorkflowNode[];
  definition?: WorkflowDefinition;
  incomingSchema?: Contract;
  workflowInputSchema?: Contract;
  mode?: 'input' | 'output';
  onChange: (bindings: WorkflowNode['inputBindings']) => void;
}) {
  const value = mode === 'input' ? node.inputBindings : node.outputBindings;
  const serialized = JSON.stringify(value),
    emitted = useRef(serialized);
  const [rows, setRows] = useState(() => bindingRows(value));
  const [advanced, setAdvanced] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (serialized !== emitted.current) {
      setRows(bindingRows(value));
      emitted.current = serialized;
    }
  }, [serialized, value]);
  const candidates = bindingNodes(node, nodes);
  const emit = (bindings: WorkflowNode['inputBindings']) => {
    emitted.current = JSON.stringify(bindings);
    onChange(bindings);
  };
  const update = (next: BindingRow[]) => {
    setRows(next);
    if (!next.some((row) => bindingRowError(row, next)))
      emit(bindingsFromRows(next));
  };
  const patch = (index: number, changes: Partial<BindingRow>) =>
    update(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const sources = [
    {
      value: 'input',
      label: mode === 'input' ? 'Previous step output' : 'Node result',
    },
    { value: 'runInput', label: 'Original workflow input' },
    { value: 'rootInput', label: 'Original root input' },
    { value: 'node', label: 'Earlier node output' },
    { value: 'literal', label: 'Fixed value' },
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
  const sourceSchema = (binding: ValueBinding): Contract => {
    if (binding.source === 'input') return incomingSchema;
    if (binding.source === 'runInput') return workflowInputSchema;
    if (binding.source === 'node') {
      const source = nodes.find((n) => n.id === binding.nodeId);
      if (source?.kind === 'agent' && source.unclaimedTimeoutMs !== undefined)
        return {};
      if (source?.kind === 'workflow' && source.mode === 'detached')
        return STARTED_RUN_SCHEMA;
      return source
        ? definition
          ? nodeOutputContract(definition, source)
          : source.outputSchema
        : {};
    }
    if (binding.source === 'itemInput') {
      const batch = nodes.find((n) => n.id === node.batchId);
      if (batch?.kind === 'batch') {
        const items = contractAtPath(batch.inputSchema, batch.itemsPath).items;
        return items && typeof items === 'object' && !Array.isArray(items)
          ? (items as Contract)
          : {};
      }
    }
    return {};
  };
  return (
    <Stack gap="md" mb="md" ref={form}>
      <NativeSelect
        label={mode === 'input' ? 'Source' : 'Data to send'}
        aria-label={mode === 'input' ? 'Source' : 'Data to send'}
        value={value === undefined ? 'previous' : 'fields'}
        data={[
          {
            value: 'previous',
            label: mode === 'input' ? 'Previous step output' : 'Node result',
          },
          { value: 'fields', label: 'Choose fields' },
        ]}
        onChange={(event) => {
          if (event.target.value === 'previous') {
            setRows([]);
            emit(undefined);
            setAdvanced(false);
          } else emit(bindingsFromRows(rows));
        }}
      />
      {value !== undefined && (
        <Stack gap="sm">
          {!advanced && (
            <Group justify="flex-end">
              <Button variant="ghost" onClick={() => setShowTypes(!showTypes)}>
                {showTypes ? 'Hide value types' : 'Show value types'}
              </Button>
            </Group>
          )}
          {!rows.length && !advanced && (
            <Text size="sm" c="dimmed">
              {mode === 'input'
                ? 'This step receives an empty object.'
                : 'This step sends an empty object.'}
            </Text>
          )}
          {!advanced &&
            rows.map((row, index) => {
              const binding = row.binding;
              const pathBinding =
                binding.source !== 'literal' && binding.source !== 'object'
                  ? binding
                  : undefined;
              const sourceLabel =
                binding.source === 'node'
                  ? `${nodes.find((n) => n.id === binding.nodeId)?.label ?? 'Node'} output`
                  : sources.find((s) => s.value === binding.source)?.label;
              return (
                <div
                  className={styles.field}
                  data-following-row={index > 0}
                  key={index}
                >
                  <div className={styles.fields}>
                    <TextInput
                      label={mode === 'input' ? 'Input field' : 'Output field'}
                      aria-label={`${mode === 'input' ? 'Input' : 'Output'} field ${index + 1}`}
                      placeholder="project.repoPath"
                      value={row.name}
                      required
                      error={bindingRowError(row, rows) || undefined}
                      ref={(element) =>
                        element?.setCustomValidity(bindingRowError(row, rows))
                      }
                      description={
                        row.keys.some((key) => key.includes('.'))
                          ? 'Literal field name, preserved from this definition.'
                          : undefined
                      }
                      onChange={(event) =>
                        patch(index, renameBindingRow(row, event.target.value))
                      }
                    />
                    <NativeSelect
                      label="Read from"
                      aria-label={`Read from for field ${index + 1}`}
                      value={binding.source}
                      data={[
                        ...sources,
                        ...(binding.source === 'object'
                          ? [{ value: 'object', label: 'Empty object' }]
                          : []),
                      ]}
                      onChange={(event) => {
                        const source = event.target
                          .value as ValueBinding['source'];
                        const path = pathBinding?.path ?? '';
                        const fallback =
                          pathBinding && Object.hasOwn(pathBinding, 'default')
                            ? { default: pathBinding.default }
                            : {};
                        patch(index, {
                          binding:
                            source === 'literal'
                              ? { source, value: '' }
                              : source === 'node'
                                ? { source, nodeId: '', path, ...fallback }
                                : source === 'object'
                                  ? { source, fields: {} }
                                  : { source, path, ...fallback },
                        });
                      }}
                    />
                    <div className={styles.value}>
                      {pathBinding && (
                        <InputPathInput
                          label="Source path"
                          aria-label={`Source path for field ${index + 1}`}
                          value={pathBinding.path}
                          schema={sourceSchema(binding)}
                          suggestionSource={sourceLabel}
                          placeholder="Whole value"
                          onChange={(path) =>
                            patch(index, { binding: { ...pathBinding, path } })
                          }
                        />
                      )}
                      {binding.source === 'literal' && (
                        <TypedValueEditor
                          label={`${mode} field ${index + 1} value`}
                          valueLabel="Value"
                          showType={showTypes}
                          value={binding.value}
                          onChange={(value) =>
                            patch(index, {
                              binding: { source: 'literal', value },
                            })
                          }
                        />
                      )}
                      {binding.source === 'object' && (
                        <Text size="sm" mt="xl">
                          {'{}'}
                        </Text>
                      )}
                    </div>
                    <Button
                      className={styles.remove}
                      variant="ghost"
                      aria-label={`Remove field ${index + 1}`}
                      title={`Remove field ${index + 1}`}
                      onClick={() => update(rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                  {binding.source === 'node' && (
                    <NativeSelect
                      mt="sm"
                      label="Node"
                      aria-label={`Node for field ${index + 1}`}
                      value={binding.nodeId}
                      required
                      description="Latest completed output in this run."
                      onChange={(event) =>
                        patch(index, {
                          binding: { ...binding, nodeId: event.target.value },
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose a node
                      </option>
                      {!candidates.some((n) => n.id === binding.nodeId) &&
                        binding.nodeId && (
                          <option value={binding.nodeId} disabled>
                            Unavailable node · {binding.nodeId}
                          </option>
                        )}
                      {candidates.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label} · {n.id}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                  {pathBinding &&
                    (pathBinding.path ||
                      Object.hasOwn(pathBinding, 'default')) && (
                      <div className={styles.fallback}>
                        <Switch
                          label="Default if missing"
                          aria-label={`Use default for field ${index + 1}`}
                          size="xs"
                          checked={Object.hasOwn(pathBinding, 'default')}
                          onChange={(event) => {
                            const { default: _default, ...rest } = pathBinding;
                            patch(index, {
                              binding: event.currentTarget.checked
                                ? {
                                    ...rest,
                                    default: suggestedMatchValue(
                                      contractAtPath(
                                        sourceSchema(binding),
                                        pathBinding.path,
                                      ),
                                    ),
                                  }
                                : rest,
                            });
                          }}
                        />
                        {Object.hasOwn(pathBinding, 'default') && (
                          <div className={styles.defaultValue}>
                            <TypedValueEditor
                              label={`${mode} field ${index + 1} default value`}
                              valueLabel="Default value"
                              showType={showTypes}
                              value={pathBinding.default!}
                              onChange={(value) =>
                                patch(index, {
                                  binding: { ...pathBinding, default: value },
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          {!advanced && (
            <Button
              variant="secondary"
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
                  {
                    name,
                    keys: [name],
                    binding: { source: 'input', path: '' },
                  },
                ]);
              }}
            >
              Add {mode === 'input' ? 'input' : 'output'} field
            </Button>
          )}
          {advanced && (
            <JsonEditor
              label={`${mode === 'input' ? 'Input' : 'Output'} fields JSON`}
              value={value}
              rows={8}
              validate={(input) => {
                const result = valueBindingsSchema.safeParse(input);
                return result.success
                  ? undefined
                  : result.error.issues
                      .map((issue) => issue.message)
                      .join('; ');
              }}
              onChange={(input) => {
                const fields = valueBindingsSchema.parse(input);
                setRows(bindingRows(fields));
                emit(fields);
              }}
            />
          )}
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Use dots to build nested object fields.
            </Text>
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
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
