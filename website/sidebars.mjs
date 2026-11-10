const docs = [
  { type: 'doc', id: 'index', label: 'Overview' },
  {
    type: 'category',
    label: 'Get started',
    collapsed: false,
    items: [
      { type: 'doc', id: 'installation', label: 'Installation' },
      { type: 'doc', id: 'quickstart', label: 'Workflows and runs' },
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
    label: 'Using Interlock',
    collapsed: true,
    items: [
      { type: 'doc', id: 'build-workflow', label: 'Build workflows' },
      { type: 'doc', id: 'reuse-work', label: 'Reuse work' },
      { type: 'doc', id: 'automation-guide', label: 'Automations' },
      { type: 'doc', id: 'inspect-runs', label: 'Inspect and manage runs' },
      { type: 'doc', id: 'reports', label: 'Reports' },
      { type: 'doc', id: 'testing-workflows', label: 'Test and improve' },
    ],
  },
  { type: 'doc', id: 'troubleshooting', label: 'Troubleshooting' },
  { type: 'doc', id: 'cli', label: 'CLI reference' },
];

export default { docs };
