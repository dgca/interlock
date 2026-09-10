import {
  TextInput,
  Switch,
  Textarea,
  NativeSelect,
  Input,
  SegmentedControl,
  Radio,
  Stack,
} from '@mantine/core';
import {
  nodeKindLabel,
  DEFAULT_BATCH_MAX_ITEMS,
  MAX_BATCH_ITEMS,
  type WorkflowDefinition,
  type Workflow,
  type WorkflowNode,
} from '@interlock/core';
import { workflowTargets } from './workflowTargets';
import { DurationInput } from './DurationInput';
import { FetchEditor } from './FetchEditor';
import { Button } from '../../components/Button/Button';
import { ContractEditor } from '../../components/ContractEditor/ContractEditor';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
export function NodeInspector({
  node,
  workflows,
  workflowId,
  hideWorkflowTarget = false,
  onOpenWorkflow,
  onChange,
  onDelete,
  definition,
  onBoundaryChange,
}: {
  node: WorkflowNode;
  workflows: Workflow[];
  workflowId?: string;
  hideWorkflowTarget?: boolean;
  onOpenWorkflow?: (id: string) => void;
  onChange: (node: WorkflowNode) => void;
  onDelete?: () => void;
  definition?: WorkflowDefinition;
  onBoundaryChange?: (schema: WorkflowDefinition['inputSchema']) => void;
}) {
  const patch = (value: Record<string, unknown>) =>
    onChange({ ...node, ...value } as WorkflowNode);
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">
          {nodeKindLabel(node.kind).toUpperCase()} NODE
        </span>
        <code> ID: {node.id}</code>
      </div>
      <div className="inspector-fields">
        <TextInput
          mb="md"
          label="Label"
          value={node.label}
          onChange={(e) => patch({ label: e.target.value })}
        />

        {node.kind === 'fetch' && (
          <FetchEditor node={node} onChange={onChange} />
        )}
        {node.kind === 'wait' && (
          <>
            <Input.Wrapper label="Resume" mb="md">
              <SegmentedControl
                aria-label="Resume"
                value={node.timing.kind}
                data={[
                  { value: 'duration', label: 'After a delay' },
                  { value: 'until', label: 'At a time from input' },
                ]}
                onChange={(kind) =>
                  patch({
                    timing:
                      kind === 'duration'
                        ? { kind, ms: 60_000 }
                        : { kind, path: '' },
                  })
                }
              />
            </Input.Wrapper>
            {node.timing.kind === 'duration' ? (
              <DurationInput
                label="Wait for"
                value={node.timing.ms}
                onChange={(ms) => patch({ timing: { kind: 'duration', ms } })}
              />
            ) : (
              <TextInput
                mb="md"
                label="Timestamp input path"
                value={node.timing.path}
                placeholder="dueAt, or blank for the whole input"
                description="ISO timestamp with a timezone, such as 2026-09-10T12:00:00Z. Past times resume immediately."
                onChange={(e) =>
                  patch({ timing: { kind: 'until', path: e.target.value } })
                }
              />
            )}
            <p className="hint">
              Passes input through unchanged. The deadline survives a server
              restart.
            </p>
          </>
        )}
        {node.kind === 'agent' && (
          <>
            <Textarea
              mb="md"
              label="Assignment prompt"
              rows={8}
              value={node.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
            />

            <Radio.Group
              mb="md"
              label="Context"
              value={node.context.mode}
              onChange={(mode) => patch({ context: { ...node.context, mode } })}
            >
              <Stack gap="xs" mt="xs">
                <Radio value="current" label="Current conversation" />
                <Radio value="fresh" label="Fresh agent session required" />
              </Stack>
            </Radio.Group>

            <p className="hint">
              Fresh context requires an executor that declares isolation.
              Interlock cannot erase a caller's conversation.
            </p>

            <Textarea
              mb="md"
              label="Context instructions"
              rows={4}
              value={node.context.instructions}
              onChange={(e) =>
                patch({
                  context: { ...node.context, instructions: e.target.value },
                })
              }
            />

            <TextInput
              mb="md"
              label="Required tools, comma separated"
              value={node.context.tools.join(', ')}
              onChange={(e) =>
                patch({
                  context: {
                    ...node.context,
                    tools: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />

            <TextInput
              mb="md"
              label="Required skills, comma separated"
              value={node.context.skills.join(', ')}
              onChange={(e) =>
                patch({
                  context: {
                    ...node.context,
                    skills: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
            />

            <Switch
              mb="md"
              label="Route on unclaimed timeout"
              checked={node.unclaimedTimeoutMs !== undefined}
              onChange={(e) =>
                patch({
                  unclaimedTimeoutMs: e.currentTarget.checked
                    ? 86_400_000
                    : undefined,
                })
              }
            />
            {node.unclaimedTimeoutMs !== undefined && (
              <>
                <DurationInput
                  label="If unclaimed for"
                  min={1}
                  value={node.unclaimedTimeoutMs}
                  onChange={(unclaimedTimeoutMs) =>
                    patch({ unclaimedTimeoutMs })
                  }
                />
                <p className="hint">
                  Connect Timeout to the next step for unanswered work. It
                  receives the original input. Claiming stops this timer; a
                  failed or expired claim starts a new timer when work becomes
                  available again.
                </p>
              </>
            )}
            <TextInput
              mb="md"
              label="Maximum attempts"
              type="number"
              min={1}
              max={10}
              value={node.maxAttempts}
              onChange={(e) => patch({ maxAttempts: Number(e.target.value) })}
            />
          </>
        )}
        {node.kind === 'script' && (
          <>
            <Input.Wrapper label="Language" mb="md">
              <SegmentedControl
                mt={4}
                style={{ display: 'flex', width: 'fit-content' }}
                aria-label="Language"
                value={node.language ?? 'bash'}
                onChange={(language) => {
                  const starter =
                    node.language === 'javascript' ? 'return input;' : 'cat';
                  patch({
                    language,
                    command:
                      node.command === starter
                        ? language === 'javascript'
                          ? 'return input;'
                          : 'cat'
                        : node.command,
                  });
                }}
                data={[
                  { value: 'javascript', label: 'JavaScript' },
                  { value: 'bash', label: 'Bash' },
                ]}
              />
            </Input.Wrapper>

            <CodeEditor
              label={
                node.language === 'javascript'
                  ? 'JavaScript code'
                  : 'Bash command'
              }
              language={node.language ?? 'bash'}
              value={node.command}
              onChange={(command) => patch({ command })}
            />

            <p className="hint">
              {node.language === 'javascript'
                ? 'Read the input variable and return a JSON value. Supports await and require. Console logs go to stderr.'
                : 'Reads JSON from stdin. Write one JSON value to stdout.'}{' '}
              Runs locally with your OS permissions.
            </p>

            <TextInput
              mb="md"
              label="Timeout, milliseconds"
              type="number"
              min={100}
              max={120000}
              value={node.timeoutMs}
              onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
            />
          </>
        )}
        {node.kind === 'workflow' && !hideWorkflowTarget && (
          <>
            <NativeSelect
              mb="md"
              label="Referenced workflow"
              value={node.workflowId}
              onChange={(e) =>
                patch({
                  workflowId: e.target.value,
                  version:
                    workflows.find((w) => w.id === e.target.value)
                      ?.latestVersion || null,
                })
              }
            >
              {!workflows.some((w) => w.id === node.workflowId) && (
                <option value={node.workflowId} disabled>
                  Choose a workflow
                </option>
              )}
              {[true, false].map((owned) => (
                <optgroup
                  key={String(owned)}
                  label={
                    owned ? 'Children of this workflow' : 'Library workflows'
                  }
                >
                  {workflowTargets(workflows, workflowId, node.workflowId)
                    .filter((w) => Boolean(w.ownerWorkflowId) === owned)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {!w.latestVersion ? ' · Not published' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </NativeSelect>

            <TextInput
              mb="md"
              label="Pinned version"
              type="number"
              min={1}
              value={node.version ?? ''}
              placeholder="Not published"
              onChange={(e) =>
                patch({
                  version: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            {(() => {
              const target = workflows.find((w) => w.id === node.workflowId);
              if (!target) return null;
              return (
                <>
                  <p className="hint">
                    {target.ownerWorkflowId
                      ? `Child of ${workflows.find((w) => w.id === target.ownerWorkflowId)?.name ?? 'this workflow'}`
                      : 'Library workflow'}
                  </p>
                  {target.latestVersion > (node.version ?? 0) && (
                    <Button
                      onClick={() => patch({ version: target.latestVersion })}
                    >
                      Use v{target.latestVersion}
                    </Button>
                  )}
                  {onOpenWorkflow && (
                    <Button onClick={() => onOpenWorkflow(target.id)}>
                      {target.ownerWorkflowId ? 'Open child' : 'Open workflow'}
                    </Button>
                  )}
                </>
              );
            })()}
          </>
        )}
        {node.kind === 'batch' && (
          <p className="hint">
            Connect Start to the first step and every branch to End. Output
            receives the ordered collection after all items finish. Input and
            output contracts apply to the whole Batch; use step contracts for
            individual items.
          </p>
        )}
        {node.kind === 'batch' && (
          <>
            <TextInput
              mb="md"
              label="Items path"
              value={node.itemsPath}
              placeholder="guests, or empty for the input itself"
              onChange={(e) => patch({ itemsPath: e.target.value })}
            />

            <TextInput
              mb="md"
              label="Maximum items"
              description="Reject larger lists before starting any items. Each item has its own step budget."
              type="number"
              required
              min={1}
              max={MAX_BATCH_ITEMS}
              value={node.maxItems ?? DEFAULT_BATCH_MAX_ITEMS}
              onChange={(e) => patch({ maxItems: Number(e.target.value) })}
            />
            <TextInput
              mb="md"
              label="Concurrency"
              type="number"
              min={1}
              max={50}
              value={node.concurrency}
              onChange={(e) => patch({ concurrency: Number(e.target.value) })}
            />

            <Radio.Group
              mb="md"
              label="When a child fails"
              value={node.failurePolicy}
              onChange={(failurePolicy) => patch({ failurePolicy })}
            >
              <Stack gap="xs" mt="xs">
                <Radio value="all" label="Fail and stop other children" />
                <Radio value="collect" label="Collect successes and failures" />
              </Stack>
            </Radio.Group>
          </>
        )}
        {node.kind === 'condition' && (
          <>
            <TextInput
              mb="md"
              label="Input path to compare"
              value={node.path}
              onChange={(e) => patch({ path: e.target.value })}
            />

            <JsonEditor
              label="Equals, as JSON"
              value={node.equals}
              onChange={(equals) => patch({ equals })}
              rows={3}
            />
          </>
        )}
        {(node.kind === 'entry' || node.kind === 'exit') &&
        definition &&
        onBoundaryChange ? (
          <>
            <p className="hint">
              {node.kind === 'entry'
                ? 'Entry passes the workflow input through unchanged. This contract is shared with Workflow settings.'
                : 'Exit returns the workflow output unchanged. This contract is shared with Workflow settings.'}
            </p>
            <ContractEditor
              label="Input / Output"
              value={
                node.kind === 'entry'
                  ? definition.inputSchema
                  : definition.outputSchema
              }
              onChange={onBoundaryChange}
            />
            {Object.keys(node.inputSchema).length > 0 && (
              <ContractEditor
                label="Additional node input constraint"
                value={node.inputSchema}
                onChange={(inputSchema) => patch({ inputSchema })}
              />
            )}
            {Object.keys(node.outputSchema).length > 0 && (
              <ContractEditor
                label="Additional node output constraint"
                value={node.outputSchema}
                onChange={(outputSchema) => patch({ outputSchema })}
              />
            )}
          </>
        ) : (
          <>
            {node.kind === 'batch' && (
              <p className="hint">
                {node.itemsPath
                  ? `The value at "${node.itemsPath}" must be an array. Input describes the enclosing value.`
                  : 'Input must be an array because Items path is blank.'}
              </p>
            )}
            <ContractEditor
              label="Input"
              value={
                node.kind === 'batch' &&
                !node.itemsPath &&
                Object.keys(node.inputSchema).length === 0
                  ? { type: 'array' }
                  : node.inputSchema
              }
              onChange={(inputSchema) => patch({ inputSchema })}
            />
            <ContractEditor
              label="Output"
              value={
                node.kind === 'batch' &&
                Object.keys(node.outputSchema).length === 0
                  ? { type: 'array' }
                  : node.outputSchema
              }
              onChange={(outputSchema) => patch({ outputSchema })}
            />
          </>
        )}
        {node.kind !== 'entry' && node.kind !== 'exit' && (
          <details>
            <summary>Input bindings</summary>
            <p className="hint">
              Build an input object from input, runInput, rootInput, or
              itemInput. Each field uses a source and dot-separated path. Blank
              path selects the whole value. Use runInput for configuration that
              must survive agent results.
            </p>
            <JsonEditor
              label="Bindings"
              value={node.inputBindings ?? {}}
              onChange={(inputBindings) =>
                patch({
                  inputBindings:
                    inputBindings && Object.keys(inputBindings).length === 0
                      ? undefined
                      : inputBindings,
                })
              }
              rows={5}
            />
          </details>
        )}
        {onDelete && node.kind !== 'entry' && node.kind !== 'exit' && (
          <Button variant="danger" onClick={onDelete}>
            Delete node
          </Button>
        )}
      </div>
    </>
  );
}
