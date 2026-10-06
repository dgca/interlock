import {
  TextInput,
  TagsInput,
  Text,
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
  STARTED_RUN_SCHEMA,
  nodeInputHint,
  contractAtPath,
  type WorkflowDefinition,
  type Workflow,
  type WorkflowNode,
  type FetchNode,
  type PollCheck,
} from '@interlock/core';
import { workflowTargets } from './workflowTargets';
import { DurationInput } from './DurationInput';
import { InputBindingsEditor } from './InputBindingsEditor';
import { InputPathInput } from './InputPathInput';
import { TypedValueEditor } from './TypedValueEditor';
import { FetchEditor } from './FetchEditor';
import { SwitchEditor } from './SwitchEditor';
import { WorkflowModeEditor } from './WorkflowModeEditor';
import { nodeDescriptions } from './nodeDescriptions';
import { Button } from '../../components/Button/Button';
import { ContractEditor } from '../../components/ContractEditor/ContractEditor';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
export function NodeInspector({
  node,
  workflows,
  workflowId,
  hideWorkflowTarget = false,
  creating = false,
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
  creating?: boolean;
  onOpenWorkflow?: (id: string) => void;
  onChange: (node: WorkflowNode) => void;
  onDelete?: () => void;
  definition?: WorkflowDefinition;
  onBoundaryChange?: (schema: WorkflowDefinition['inputSchema']) => void;
}) {
  const patch = (value: Record<string, unknown>) =>
    onChange({ ...node, ...value } as WorkflowNode);
  const hint = definition
    ? nodeInputHint(definition, node)
    : { schema: node.inputSchema, source: '', inferred: false };
  const inputShape = hint.schema;
  const incomingShape = definition
    ? nodeInputHint(definition, {
        ...node,
        inputSchema: {},
        inputBindings: undefined,
      }).schema
    : {};
  return (
    <>
      {!creating && (
        <div className="inspector-heading">
          <span className="eyebrow">
            {nodeKindLabel(node.kind).toUpperCase()} NODE
          </span>
          <p>{nodeDescriptions[node.kind]}</p>
        </div>
      )}
      <div className="inspector-fields">
        <TextInput
          mb="md"
          label="Name"
          value={node.label}
          onChange={(e) => patch({ label: e.target.value })}
        />

        {node.kind === 'fetch' && (
          <FetchEditor
            node={node}
            onChange={onChange}
            inputSchema={inputShape}
            inputSource={hint.source}
          />
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
                  { value: 'poll', label: 'When a check passes' },
                ]}
                onChange={(kind) =>
                  patch({
                    timing:
                      kind === 'duration'
                        ? { kind, ms: 60_000 }
                        : kind === 'until'
                          ? { kind, path: '' }
                          : {
                              kind,
                              everyMs: 60_000,
                              check: {
                                kind: 'script',
                                language: 'javascript',
                                command: 'return { ready: true };',
                                timeoutMs: 30_000,
                              },
                              path: 'ready',
                              equals: true,
                            },
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
            ) : node.timing.kind === 'until' ? (
              <InputPathInput
                mb="md"
                label="Timestamp input path"
                value={node.timing.path}
                schema={inputShape}
                suggestionSource={hint.source}
                stringsOnly
                placeholder="dueAt, or blank for the whole input"
                description="ISO timestamp with a timezone, such as 2026-09-10T12:00:00Z. Past times resume immediately."
                onChange={(path) => patch({ timing: { kind: 'until', path } })}
              />
            ) : (
              <PollEditor
                node={node}
                timing={node.timing}
                inputSchema={inputShape}
                inputSource={hint.source}
                onChange={(timing) => patch({ timing })}
              />
            )}
            {node.timing.kind !== 'poll' && (
              <p className="hint">
                Passes input through unchanged. The deadline survives a server
                restart.
              </p>
            )}
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

            <TagsInput
              mb="md"
              label="Required tools"
              description="Enter a name and press Enter. These must match the executor's declared tools."
              placeholder="Add a tool"
              value={node.context.tools}
              acceptValueOnBlur
              allowDuplicates
              onChange={(tools) =>
                patch({
                  context: {
                    ...node.context,
                    tools: tools.map((name) => name.trim()).filter(Boolean),
                  },
                })
              }
            />

            <TagsInput
              mb="md"
              label="Required skills"
              description="Enter a name and press Enter. These must match the executor's declared skills."
              placeholder="Add a skill"
              value={node.context.skills}
              acceptValueOnBlur
              allowDuplicates
              onChange={(skills) =>
                patch({
                  context: {
                    ...node.context,
                    skills: skills.map((name) => name.trim()).filter(Boolean),
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

            <DurationInput
              key={`script-timeout-${node.id}`}
              label="Timeout"
              min={100}
              max={120_000}
              value={node.timeoutMs}
              onChange={(timeoutMs) => patch({ timeoutMs })}
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
        {node.kind === 'workflow' && (
          <WorkflowModeEditor key={node.id} node={node} onChange={onChange} />
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
            <InputPathInput
              mb="md"
              label="List to process"
              description="Use dots for nested fields, or leave blank when the whole input is a list."
              value={node.itemsPath}
              schema={inputShape}
              suggestionSource={hint.source}
              arraysOnly
              placeholder="e.g. guests or response.items"
              onChange={(itemsPath) => patch({ itemsPath })}
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
              label="Items at a time"
              description="How many item paths can run at once."
              type="number"
              min={1}
              max={50}
              value={node.concurrency}
              onChange={(e) => patch({ concurrency: Number(e.target.value) })}
            />

            <Radio.Group
              mb="md"
              label="When an item fails"
              value={node.failurePolicy}
              onChange={(failurePolicy) => patch({ failurePolicy })}
            >
              <Stack gap="xs" mt="xs">
                <Radio value="all" label="Fail and stop other items" />
                <Radio value="collect" label="Collect successes and failures" />
              </Stack>
            </Radio.Group>
          </>
        )}
        {node.kind === 'condition' && (
          <>
            <InputPathInput
              mb="md"
              label="Check this input field"
              description="Use dots for nested fields, or leave blank to check the whole input. A missing field fails the run."
              placeholder="e.g. approved or request.status"
              value={node.path}
              schema={inputShape}
              suggestionSource={hint.source}
              onChange={(path) => patch({ path })}
            />

            <TypedValueEditor
              key={node.id}
              label="Condition match value"
              value={node.equals}
              onChange={(equals) => patch({ equals })}
              suggestedSchema={contractAtPath(inputShape, node.path)}
              suggestionSource={hint.source}
            />
            <Text size="xs" c="dimmed" mt="xs" mb="md">
              Matches follow True; everything else follows False. Text and
              numbers are different values.
            </Text>
          </>
        )}
        {node.kind === 'switch' && (
          <SwitchEditor
            key={node.id}
            node={node}
            onChange={onChange}
            connectedBranches={definition?.edges
              .filter((edge) => edge.source === node.id)
              .map((edge) => edge.port)}
            inputSchema={inputShape}
            inputSource={hint.source}
          />
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
            <section aria-label="Input">
              <h3>Input</h3>
              {node.kind !== 'entry' && node.kind !== 'exit' && (
                <InputBindingsEditor
                  key={node.id}
                  node={node}
                  nodes={
                    definition?.nodes.map((candidate) =>
                      candidate.id === node.id ? node : candidate,
                    ) ?? [node]
                  }
                  incomingSchema={incomingShape}
                  workflowInputSchema={definition?.inputSchema ?? {}}
                  onChange={(inputBindings) => patch({ inputBindings })}
                />
              )}
              {node.kind === 'batch' && (
                <p className="hint">
                  {node.itemsPath
                    ? `The value at "${node.itemsPath}" must be an array. Expected format describes the enclosing value.`
                    : 'Input must be an array because List to process is blank.'}
                </p>
              )}
              {hint.inferred && Object.keys(inputShape).length > 0 && (
                <div className="hint" role="status">
                  Input shape from {hint.source.toLowerCase()}.
                  {(node.kind !== 'batch' ||
                    node.itemsPath ||
                    inputShape.type === 'array') && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        patch({ inputSchema: structuredClone(inputShape) })
                      }
                    >
                      Use as expected format
                    </Button>
                  )}
                </div>
              )}
              <ContractEditor
                label="Expected format"
                value={
                  node.kind === 'batch' &&
                  !node.itemsPath &&
                  Object.keys(node.inputSchema).length === 0
                    ? { type: 'array' }
                    : node.inputSchema
                }
                onChange={(inputSchema) => patch({ inputSchema })}
              />
            </section>
            <ContractEditor
              label={
                node.kind === 'workflow' && node.mode === 'detached'
                  ? 'Output · Started run'
                  : 'Output'
              }
              readOnly={node.kind === 'workflow' && node.mode === 'detached'}
              value={
                node.kind === 'workflow' && node.mode === 'detached'
                  ? STARTED_RUN_SCHEMA
                  : node.kind === 'batch' &&
                      Object.keys(node.outputSchema).length === 0
                    ? { type: 'array' }
                    : node.outputSchema
              }
              onChange={(outputSchema) => patch({ outputSchema })}
            />
          </>
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

type PollTiming = Extract<
  Extract<WorkflowNode, { kind: 'wait' }>['timing'],
  { kind: 'poll' }
>;
const blankFetchCheck: PollCheck = {
  kind: 'fetch',
  url: '',
  method: 'GET',
  query: [],
  headers: [],
  body: { kind: 'none' },
  timeoutMs: 30_000,
  failOnHttpError: true,
};
function PollEditor({
  node,
  timing,
  inputSchema,
  inputSource,
  onChange,
}: {
  node: WorkflowNode;
  timing: PollTiming;
  inputSchema: Record<string, unknown>;
  inputSource?: string;
  onChange: (timing: PollTiming) => void;
}) {
  const patch = (value: Partial<PollTiming>) =>
    onChange({ ...timing, ...value });
  const check = timing.check;
  return (
    <>
      <Input.Wrapper label="Check" mb="md">
        <SegmentedControl
          mt={4}
          style={{ display: 'flex', width: 'fit-content' }}
          aria-label="Check"
          value={check.kind}
          data={[
            { value: 'script', label: 'Script' },
            { value: 'fetch', label: 'Fetch' },
          ]}
          onChange={(kind) =>
            patch({
              check:
                kind === check.kind
                  ? check
                  : kind === 'fetch'
                    ? blankFetchCheck
                    : {
                        kind: 'script',
                        language: 'javascript',
                        command: 'return { ready: true };',
                        timeoutMs: 30_000,
                      },
            })
          }
        />
      </Input.Wrapper>
      {check.kind === 'script' ? (
        <>
          <Input.Wrapper label="Language" mb="md">
            <SegmentedControl
              mt={4}
              style={{ display: 'flex', width: 'fit-content' }}
              aria-label="Check language"
              value={check.language ?? 'bash'}
              onChange={(language) =>
                patch({
                  check: {
                    ...check,
                    language: language as 'javascript' | 'bash',
                  },
                })
              }
              data={[
                { value: 'javascript', label: 'JavaScript' },
                { value: 'bash', label: 'Bash' },
              ]}
            />
          </Input.Wrapper>
          <CodeEditor
            label={
              check.language === 'javascript'
                ? 'Check JavaScript code'
                : 'Check Bash command'
            }
            language={check.language ?? 'bash'}
            value={check.command}
            onChange={(command) => patch({ check: { ...check, command } })}
          />
          <p className="hint">
            {check.language === 'javascript'
              ? 'Reads the input variable and returns a JSON value.'
              : 'Reads the step input as JSON on stdin and writes one JSON value to stdout.'}{' '}
            Runs on the server with your OS permissions each time the check is
            due. A failing check is recorded and tried again.
          </p>
          <DurationInput
            key={`check-timeout-${node.id}`}
            label="Check timeout"
            min={100}
            max={120_000}
            value={check.timeoutMs}
            onChange={(timeoutMs) => patch({ check: { ...check, timeoutMs } })}
          />
        </>
      ) : (
        <FetchEditor
          node={{ ...node, outputSchema: {}, ...check } as FetchNode}
          inputSchema={inputSchema}
          inputSource={inputSource}
          onChange={(fetch) =>
            patch({
              check: {
                kind: 'fetch',
                url: fetch.url,
                method: fetch.method,
                query: fetch.query,
                headers: fetch.headers,
                body: fetch.body,
                timeoutMs: fetch.timeoutMs,
                failOnHttpError: fetch.failOnHttpError,
              },
            })
          }
        />
      )}
      <DurationInput
        key={`poll-every-${node.id}`}
        label="Check every"
        min={1000}
        value={timing.everyMs}
        onChange={(everyMs) => patch({ everyMs })}
      />
      <TextInput
        mb="md"
        label="Check output field"
        description="Dot-separated path in the check's output. A missing field fails the step."
        placeholder="e.g. ready or body.state"
        value={timing.path}
        onChange={(e) => patch({ path: e.target.value })}
      />
      <TypedValueEditor
        key={`poll-equals-${node.id}`}
        label="Continue when it equals"
        value={timing.equals}
        onChange={(equals) => patch({ equals })}
      />
      <Switch
        mt="xs"
        mb="md"
        label="Give up after a deadline"
        description="Disabling removes the Timeout connection when changes are applied."
        checked={timing.timeoutMs !== undefined}
        onChange={(e) =>
          patch({
            timeoutMs: e.currentTarget.checked ? 3_600_000 : undefined,
          })
        }
      />
      {timing.timeoutMs !== undefined && (
        <DurationInput
          key={`poll-timeout-${node.id}`}
          label="Deadline"
          min={1}
          value={timing.timeoutMs}
          onChange={(timeoutMs) => patch({ timeoutMs })}
        />
      )}
      <p className="hint">
        Continues with the input merged with the passing check's output. The
        schedule survives a server restart; an interrupted check runs again.
        {timing.timeoutMs !== undefined &&
          ' At the deadline, Timeout receives the original input.'}
      </p>
    </>
  );
}
