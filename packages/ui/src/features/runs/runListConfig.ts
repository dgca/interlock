import type { ListTableLayout } from '../../components/ListTable/ListTable';
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

export const runTable: ListTableLayout = {
  minWidth: 466,
  columns: [
    { label: 'Run', width: '33%', compactWidth: '31%' },
    { label: 'Status', width: '36%', compactWidth: '36%' },
    { label: 'Started' },
    { label: 'Steps', width: '64px', compactWidth: '50px' },
  ],
};
