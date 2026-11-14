import {
  blankDefinition,
  nodeSchema,
  type NodeExecution,
  type Run,
} from '@interlock/core';
import {
  AgentToolsEditor,
  ToolEdgesContext,
} from '../features/workflows/AgentToolsEditor';
import { ToolCallLinks } from '../features/runs/LinkedRuns';
import { Section, Specimen } from './GalleryLayout';

const definition = blankDefinition();
definition.nodes.push(
  nodeSchema.parse({
    id: 'checks',
    kind: 'script',
    label: 'Run checks',
    command: 'return input;',
  }),
  nodeSchema.parse({
    id: 'issue',
    kind: 'fetch',
    label: 'Read issue',
    url: 'https://example.test/issue',
  }),
);
definition.edges.push(
  {
    id: 'checks',
    source: 'agent',
    target: 'checks',
    port: 'default',
    kind: 'tool',
    maxCallsPerAttempt: 5,
  },
  {
    id: 'issue',
    source: 'agent',
    target: 'issue',
    port: 'default',
    kind: 'tool',
  },
);
const call = (
  id: string,
  name: string,
  status: Run['status'],
  started = true,
): Run => ({
  id,
  workflowId: 'workflow',
  workflowName: `Implement · ${name}`,
  version: 1,
  status,
  input: {},
  cursor: name,
  value: {},
  createdAt: '2026-03-02T10:15:00Z',
  updatedAt: '2026-03-02T10:15:00Z',
  toolCall: {
    workId: 'work',
    executionId: 'agent-step',
    attempt: id === 'c3' ? 2 : 1,
    edgeId: name,
    name,
    callId: id,
  },
  executions: started
    ? [
        {
          id: `${id}-step`,
          nodeId: name,
          kind: 'script',
          label: name,
          input: {},
          status,
          startedAt: '2026-03-02T10:15:00Z',
          childRunIds: [],
          nextItem: 0,
        },
      ]
    : [],
});
const calls = [
  call('c1', 'run_checks', 'completed'),
  call('c2', 'read_issue', 'failed'),
  call('c3', 'run_checks', 'running', false),
];
const agentStep = {
  id: 'agent-step',
  childRunIds: calls.map((c) => c.id),
} as NodeExecution;

/** Agent tool editing and the tool calls a run inspector shows. */
export function AgentTools() {
  return (
    <Section id="agent-tools" title="Agent tools">
      <Specimen name="AgentToolsEditor" wide>
        <ToolEdgesContext.Provider value={() => {}}>
          <AgentToolsEditor
            node={definition.nodes[1]}
            definition={definition}
          />
        </ToolEdgesContext.Provider>
      </Specimen>
      <Specimen name="AgentToolsEditor without tools" wide>
        <ToolEdgesContext.Provider value={() => {}}>
          <AgentToolsEditor
            node={definition.nodes[1]}
            definition={blankDefinition()}
          />
        </ToolEdgesContext.Provider>
      </Specimen>
      <Specimen name="ToolCallLinks" wide>
        <ToolCallLinks
          execution={agentStep}
          runIndex={new Map(calls.map((c) => [c.id, c]))}
          states={{}}
          onSelect={() => {}}
        />
      </Specimen>
    </Section>
  );
}
