import type { Workflow, WorkflowNode } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
export function NodeInspector({
  node,
  workflows,
  onChange,
  onDelete,
}: {
  node: WorkflowNode;
  workflows: Workflow[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
}) {
  const patch = (value: Record<string, unknown>) =>
    onChange({ ...node, ...value } as WorkflowNode);
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">NODE CONFIGURATION</span>
        <h2>{node.label}</h2>
        <code>{node.id}</code>
      </div>
      <div className="inspector-fields">
        <label className="field">
          <span>Label</span>
          <input
            value={node.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </label>
        {node.kind === 'agent' && (
          <>
            <label className="field">
              <span>Assignment prompt</span>
              <textarea
                rows={8}
                value={node.prompt}
                onChange={(e) => patch({ prompt: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Context</span>
              <select
                value={node.context.mode}
                onChange={(e) =>
                  patch({ context: { ...node.context, mode: e.target.value } })
                }
              >
                <option value="current">Current conversation</option>
                <option value="fresh">Fresh agent session required</option>
              </select>
            </label>
            <p className="hint">
              Fresh context requires an executor that declares isolation.
              Interlock cannot erase a caller's conversation.
            </p>
            <label className="field">
              <span>Context instructions</span>
              <textarea
                rows={4}
                value={node.context.instructions}
                onChange={(e) =>
                  patch({
                    context: { ...node.context, instructions: e.target.value },
                  })
                }
              />
            </label>
            <label className="field">
              <span>Required tools, comma separated</span>
              <input
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
            </label>
            <label className="field">
              <span>Required skills, comma separated</span>
              <input
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
            </label>
            <label className="field">
              <span>Maximum attempts</span>
              <input
                type="number"
                min={1}
                max={10}
                value={node.maxAttempts}
                onChange={(e) => patch({ maxAttempts: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {node.kind === 'script' && (
          <>
            <label className="field">
              <span>Bash command</span>
              <textarea
                className="code"
                rows={7}
                value={node.command}
                onChange={(e) => patch({ command: e.target.value })}
              />
            </label>
            <p className="hint">
              Reads JSON from stdin. Write one JSON value to stdout. Runs
              locally with your OS permissions.
            </p>
            <label className="field">
              <span>Timeout, milliseconds</span>
              <input
                type="number"
                min={100}
                max={120000}
                value={node.timeoutMs}
                onChange={(e) => patch({ timeoutMs: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {(node.kind === 'workflow' || node.kind === 'map') && (
          <>
            <label className="field">
              <span>Child workflow</span>
              <select
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
              </select>
            </label>
            <label className="field">
              <span>Pinned version</span>
              <input
                type="number"
                min={1}
                value={node.version}
                onChange={(e) => patch({ version: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {node.kind === 'map' && (
          <>
            <label className="field">
              <span>Array path</span>
              <input
                value={node.itemsPath}
                placeholder="protocols, or empty for the input itself"
                onChange={(e) => patch({ itemsPath: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Concurrency</span>
              <input
                type="number"
                min={1}
                max={50}
                value={node.concurrency}
                onChange={(e) => patch({ concurrency: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>When a child fails</span>
              <select
                value={node.failurePolicy}
                onChange={(e) => patch({ failurePolicy: e.target.value })}
              >
                <option value="all">Fail and stop other children</option>
                <option value="collect">Collect successes and failures</option>
              </select>
            </label>
          </>
        )}
        {node.kind === 'condition' && (
          <>
            <label className="field">
              <span>Input path to compare</span>
              <input
                value={node.path}
                onChange={(e) => patch({ path: e.target.value })}
              />
            </label>
            <JsonEditor
              label="Equals, as JSON"
              value={node.equals}
              onChange={(equals) => patch({ equals })}
              rows={3}
            />
          </>
        )}
        <JsonEditor
          label="Input JSON Schema"
          value={node.inputSchema}
          onChange={(inputSchema) => patch({ inputSchema })}
        />
        <JsonEditor
          label="Output JSON Schema"
          value={node.outputSchema}
          onChange={(outputSchema) => patch({ outputSchema })}
        />
        {node.kind !== 'entry' && node.kind !== 'exit' && (
          <Button variant="danger" onClick={onDelete}>
            Delete node
          </Button>
        )}
      </div>
    </>
  );
}
