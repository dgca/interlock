import { TextInput, Textarea, NativeSelect } from '@mantine/core';
import {
  nodeKindLabel,
  type WorkflowDefinition,
  type Workflow,
  type WorkflowNode,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { ContractEditor } from '../../components/ContractEditor/ContractEditor';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
export function NodeInspector({
  node,
  workflows,
  nodes = [],
  onChange,
  onDelete,
  definition,
  onBoundaryChange,
}: {
  node: WorkflowNode;
  workflows: Workflow[];
  nodes?: WorkflowNode[];
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

        {node.kind !== 'entry' && node.kind !== 'exit' && (
          <NativeSelect
            mb="md"
            label="List group"
            value={node.listId ?? ''}
            onChange={(e) =>
              patch({
                listId: e.target.value || undefined,
                position: e.target.value
                  ? { x: 130, y: 160 }
                  : { x: 150, y: 360 },
              })
            }
          >
            <option value="">Main workflow</option>
            {nodes
              .filter((n) => n.kind === 'list' && n.id !== node.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
          </NativeSelect>
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

            <NativeSelect
              mb="md"
              label="Context"
              value={node.context.mode}
              onChange={(e) =>
                patch({ context: { ...node.context, mode: e.target.value } })
              }
            >
              <option value="current">Current conversation</option>
              <option value="fresh">Fresh agent session required</option>
            </NativeSelect>

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
            <NativeSelect
              mb="md"
              label="Language"
              value={node.language ?? 'bash'}
              onChange={(e) => {
                const language = e.target.value;
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
            >
              <option value="javascript">JavaScript</option>
              <option value="bash">Bash</option>
            </NativeSelect>

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
        {(node.kind === 'workflow' || node.kind === 'map') && (
          <>
            <NativeSelect
              mb="md"
              label="Child workflow"
              value={node.workflowId}
              onChange={(e) =>
                patch({
                  workflowId: e.target.value,
                  version:
                    workflows.find((w) => w.id === e.target.value)
                      ?.latestVersion || 1,
                })
              }
            >
              <option value="">Choose a published workflow</option>
              {workflows
                .filter((w) => w.latestVersion)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </NativeSelect>

            <TextInput
              mb="md"
              label="Pinned version"
              type="number"
              min={1}
              value={node.version}
              onChange={(e) => patch({ version: Number(e.target.value) })}
            />
          </>
        )}
        {node.kind === 'list' && (
          <p className="hint">
            Connect Start to the first step and every branch to End. Output
            receives the ordered collection after all items finish. Input and
            output contracts apply to the whole List; use step contracts for
            individual items.
          </p>
        )}
        {node.kind === 'map' && (
          <p className="hint">
            Legacy Map runs a pinned workflow for each item. New repeated paths
            use List nodes.
          </p>
        )}
        {(node.kind === 'map' || node.kind === 'list') && (
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
              label="Concurrency"
              type="number"
              min={1}
              max={50}
              value={node.concurrency}
              onChange={(e) => patch({ concurrency: Number(e.target.value) })}
            />

            <NativeSelect
              mb="md"
              label="When a child fails"
              value={node.failurePolicy}
              onChange={(e) => patch({ failurePolicy: e.target.value })}
            >
              <option value="all">Fail and stop other children</option>
              <option value="collect">Collect successes and failures</option>
            </NativeSelect>
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
            {node.kind === 'list' && (
              <p className="hint">
                {node.itemsPath
                  ? `The value at "${node.itemsPath}" must be an array. Input describes the enclosing value.`
                  : 'Input must be an array because Items path is blank.'}
              </p>
            )}
            <ContractEditor
              label="Input"
              value={
                node.kind === 'list' &&
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
                node.kind === 'list' &&
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
