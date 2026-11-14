const docs = [
  { type: 'doc', id: 'index', label: 'Overview' },
  {
    type: 'category',
    label: 'Get started',
    collapsed: false,
    items: [
      { type: 'doc', id: 'installation', label: 'Installation' },
      { type: 'doc', id: 'quickstart', label: 'Workflows and runs' },
      { type: 'doc', id: 'starter-workflows', label: 'Starter workflows' },
    ],
  },
  {
    type: 'category',
    label: 'Agents',
    collapsed: false,
    items: [
      { type: 'doc', id: 'agents', label: 'Run agents' },
      { type: 'doc', id: 'connect-mcp', label: 'Connect with MCP' },
      { type: 'doc', id: 'harness-setup', label: 'Connect your harness' },
    ],
  },
  {
    type: 'category',
    label: 'Build workflows',
    collapsed: true,
    items: [
      { type: 'doc', id: 'build-workflow', label: 'Build workflows' },
      { type: 'doc', id: 'reuse-work', label: 'Reuse work' },
      { type: 'doc', id: 'parallel', label: 'Parallel steps' },
      { type: 'doc', id: 'agent-tools', label: 'Tools for agents' },
      { type: 'doc', id: 'memory', label: 'Workflow memory' },
      {
        type: 'doc',
        id: 'permission-policy',
        label: 'Permission policy',
      },
      { type: 'doc', id: 'automation-guide', label: 'Automations' },
    ],
  },
  {
    type: 'category',
    label: 'Operate',
    collapsed: true,
    items: [
      { type: 'doc', id: 'inspect-runs', label: 'Inspect and manage runs' },
      { type: 'doc', id: 'workflow-boards', label: 'Boards' },
      { type: 'doc', id: 'run-budgets', label: 'Run budgets' },
      { type: 'doc', id: 'reports', label: 'Reports' },
      { type: 'doc', id: 'opentelemetry', label: 'OpenTelemetry traces' },
    ],
  },
  {
    type: 'category',
    label: 'Test and improve',
    collapsed: true,
    items: [
      { type: 'doc', id: 'testing-workflows', label: 'Test and improve' },
      {
        type: 'doc',
        id: 'workflow-proposals',
        label: 'Proposed workflow changes',
      },
    ],
  },
  {
    type: 'category',
    label: 'Reference',
    collapsed: true,
    items: [
      { type: 'doc', id: 'cli', label: 'CLI reference' },
      { type: 'doc', id: 'http-api', label: 'HTTP API' },
      { type: 'doc', id: 'upgrading', label: 'Upgrading' },
      { type: 'doc', id: 'troubleshooting', label: 'Troubleshooting' },
    ],
  },
];

export default { docs };
