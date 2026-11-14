import type { ListTableLayout } from '../../components/ListTable/ListTable';
import type { RunTab } from './runAttention';

/** `stages` is a workflow's own board and applies only inside a workflow. */
export type RunMode = 'list' | 'overview' | 'stages';

export function runMode(value: string | null): RunMode {
  return value === 'overview' || value === 'stages' ? value : 'list';
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
