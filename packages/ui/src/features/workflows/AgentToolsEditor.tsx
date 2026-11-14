import { createContext, useContext } from 'react';
import { Button, Stack, TextInput } from '../../design-system';
import {
  agentTools,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
} from '@interlock/core';
import styles from './NodeInspector.module.css';

/** Lets node settings edit the Agent's tool edges, which live beside the node. */
export const ToolEdgesContext = createContext<
  ((edges: WorkflowEdge[]) => void) | undefined
>(undefined);

const limit = (value: string) =>
  value.trim() === '' ? undefined : Math.trunc(Number(value));

export function AgentToolsEditor({
  node,
  definition,
}: {
  node: WorkflowNode;
  definition?: WorkflowDefinition;
}) {
  const onEdgesChange = useContext(ToolEdgesContext);
  if (node.kind !== 'agent' || !definition || !onEdgesChange) return null;
  const tools = agentTools(definition, node.id);
  const update = (id: string, patch: Partial<WorkflowEdge> | null) =>
    onEdgesChange(
      definition.edges.flatMap((edge) =>
        edge.id !== id ? [edge] : patch ? [{ ...edge, ...patch }] : [],
      ),
    );
  return (
    <Stack gap="sm" mb="md">
      <div className={styles.toolIntro}>
        <strong>Tools</strong>
        <p className="hint">
          {tools.length
            ? 'The agent can call these steps during its turn. Leave a limit blank for the default.'
            : "Connect this Agent's Tools handle to a Script or Fetch step to let the agent call it during its turn."}
        </p>
      </div>
      {tools.map((tool) => {
        const edge = definition.edges.find((e) => e.id === tool.edgeId)!;
        const target = definition.nodes.find((n) => n.id === tool.nodeId);
        return (
          <div className={styles.toolField} key={tool.edgeId}>
            <div className={styles.toolName}>
              <code>{tool.name}</code>
              <span className="hint">{target?.label}</span>
            </div>
            <TextInput
              label="Calls per attempt"
              type="number"
              min={1}
              max={100}
              placeholder="10"
              value={edge.maxCallsPerAttempt ?? ''}
              onChange={(event) =>
                update(edge.id, {
                  maxCallsPerAttempt: limit(event.target.value),
                })
              }
            />
            <TextInput
              label="Calls per execution"
              type="number"
              min={1}
              max={1000}
              placeholder="30"
              value={edge.maxCallsPerExecution ?? ''}
              onChange={(event) =>
                update(edge.id, {
                  maxCallsPerExecution: limit(event.target.value),
                })
              }
            />
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Remove tool ${tool.name}`}
              onClick={() => update(edge.id, null)}
            >
              Remove
            </Button>
          </div>
        );
      })}
    </Stack>
  );
}
