import type { ListTableColumn } from '../../components/ListTable/ListTable';
import type { RunTab } from './runAttention';

export type RunMode = 'list' | 'overview';

export function runMode(value: string | null): RunMode {
  return value === 'overview' ? 'overview' : 'list';
}

export const runViews: { value: RunTab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'history', label: 'History' },
];

export const runColumns: ListTableColumn[] = [
  {
    label: 'Workflow',
    width: 'minmax(200px, 1.25fr)',
    compactWidth: 'minmax(160px, 1.2fr)',
  },
  {
    label: 'Status',
    width: 'minmax(220px, 1.4fr)',
    compactWidth: 'minmax(180px, 1.4fr)',
  },
  {
    label: 'Started',
    width: 'minmax(170px, .85fr)',
    compactWidth: 'minmax(140px, 1fr)',
  },
  { label: 'Steps', width: '64px', compactWidth: '45px' },
];
