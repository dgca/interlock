export const aiSettingsTabs = [
  { value: 'harnesses', label: 'Harnesses' },
  { value: 'model-aliases', label: 'Agent presets' },
  { value: 'execution', label: 'Execution settings' },
] as const;

export function aiSettingsTab(location: { search: string; hash: string }) {
  const anchor = location.hash.slice(1);
  if (anchor === 'model-aliases') return 'model-aliases';
  if (
    [
      'execution-settings',
      'concurrency',
      'stall-settings',
      'history-retention',
      'script-approval',
    ].includes(anchor)
  )
    return 'execution';
  if (anchor === 'harnesses') return 'harnesses';
  const tab = new URLSearchParams(location.search).get('tab');
  return tab === 'model-aliases' || tab === 'execution' ? tab : 'harnesses';
}
