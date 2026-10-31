import { useRef } from 'react';
import { Stack, Switch, Text } from '@mantine/core';
import {
  contractAtPath,
  contractPaths,
  outgoingPorts,
  supportsResultRouting,
  STARTED_RUN_SCHEMA,
  type WorkflowNode,
  type WorkflowDefinition,
} from '@interlock/core';
import { ContractEditor } from '../../components/ContractEditor/ContractEditor';
import { Button } from '../../components/Button/Button';
import { InputBindingsEditor } from './InputBindingsEditor';
import { ResultRulesEditor } from './ResultRulesEditor';
import { SwitchEditor } from './SwitchEditor';
import { suggestedMatchValue } from './TypedValueEditor';
import styles from './NodeResultEditor.module.css';
export function NodeResultEditor({
  node,
  definition,
  onChange,
}: {
  node: WorkflowNode;
  definition?: WorkflowDefinition;
  onChange: (node: WorkflowNode) => void;
}) {
  const patch = (changes: Partial<WorkflowNode>) =>
    onChange({ ...node, ...changes } as WorkflowNode);
  const enabled = supportsResultRouting(node);
  const remembered = useRef(node.routing);
  if (node.routing) remembered.current = node.routing;
  const reserved: string[] = outgoingPorts({
    ...node,
    routing: undefined,
  }).filter((p) => p === 'timeout' || p === 'failed');
  const starter = () => {
    const paths = contractPaths(node.outputSchema);
    const path =
      paths.find((path) =>
        Array.isArray(contractAtPath(node.outputSchema, path).enum),
      ) ??
      paths.find(
        (path) => contractAtPath(node.outputSchema, path).type === 'boolean',
      ) ??
      paths.find((path) =>
        ['string', 'number', 'integer'].includes(
          String(contractAtPath(node.outputSchema, path).type),
        ),
      ) ??
      '';
    const equals = suggestedMatchValue(contractAtPath(node.outputSchema, path));
    return {
      path,
      cases: [{ port: typeof equals === 'boolean' ? 'true' : 'match', equals }],
      default: typeof equals === 'boolean' ? 'false' : 'otherwise',
    };
  };
  return (
    <Stack gap="md">
      <div>
        <ContractEditor
          compact
          label={
            node.kind === 'workflow' && node.mode === 'detached'
              ? 'Output · Started run'
              : enabled
                ? 'Accepted result'
                : 'Result format'
          }
          readOnly={node.kind === 'workflow' && node.mode === 'detached'}
          value={
            node.kind === 'workflow' && node.mode === 'detached'
              ? STARTED_RUN_SCHEMA
              : node.kind === 'batch' && !Object.keys(node.outputSchema).length
                ? { type: 'array' }
                : node.outputSchema
          }
          onChange={(outputSchema) => patch({ outputSchema })}
        />
        {node.kind === 'agent' && (
          <details className={styles.checks}>
            <summary>Additional result checks</summary>
            <ResultRulesEditor
              value={node.resultRules}
              onChange={(resultRules) => patch({ resultRules })}
            />
          </details>
        )}
      </div>
      {enabled && (
        <div>
          <Switch
            label="Branch on result"
            aria-label="Branch on result"
            description="Interlock selects the branch after accepting the result."
            checked={Boolean(node.routing)}
            onChange={(event) =>
              patch({
                routing: event.currentTarget.checked
                  ? (remembered.current ?? starter())
                  : undefined,
              })
            }
          />
          {node.routing && (
            <div className={styles.routing}>
              <SwitchEditor
                node={{ ...node, kind: 'switch', ...node.routing }}
                onChange={(next) =>
                  patch({
                    routing: {
                      path: next.path,
                      cases: next.cases,
                      default: next.default,
                    },
                  })
                }
                inputSchema={node.outputSchema}
                inputSource="Node result"
                dataSource="result"
                reservedPorts={reserved}
                showConnectionWarning={false}
                connectedBranches={definition?.edges
                  .filter(
                    (edge) =>
                      edge.source === node.id && !reserved.includes(edge.port),
                  )
                  .map((edge) => edge.port)}
              />
            </div>
          )}
        </div>
      )}
      {enabled && (
        <div className={styles.group}>
          <h3>Send data onward</h3>
          <InputBindingsEditor
            mode="output"
            node={node}
            nodes={definition?.nodes ?? [node]}
            definition={definition}
            incomingSchema={node.outputSchema}
            workflowInputSchema={definition?.inputSchema ?? {}}
            onChange={(outputBindings) => patch({ outputBindings })}
          />
          {node.outputBindings && (
            <Text size="sm" c="dimmed">
              Routing uses the accepted result. These fields are sent to the
              next step; the original result stays available in the run.
            </Text>
          )}
        </div>
      )}
      {!enabled && (node.routing || node.outputBindings) && (
        <div>
          <Text size="sm">
            Result branching and output fields require an Agent, Script, Fetch
            or a Workflow that waits for its result.
          </Text>
          <Button
            style={{ marginTop: 12 }}
            onClick={() =>
              patch({ routing: undefined, outputBindings: undefined })
            }
          >
            Remove result settings
          </Button>
        </div>
      )}
    </Stack>
  );
}
