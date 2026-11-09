import {
  Stack,
  Placeholder,
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../design-system';

import {
  ListTableSkeleton,
  type ListTableColumn,
} from '../../components/ListTable/ListTable';

import styles from './Harnesses.module.css';
import { useLocation } from 'react-router';
import { aiSettingsTab, aiSettingsTabs } from './aiSettingsNavigation';

export const harnessColumns: readonly ListTableColumn[] = [
  { label: 'Configuration', width: 'minmax(0, 1fr)' },
  { label: 'Installation', width: '140px', compactWidth: '110px' },
  { label: 'Status', width: '130px', compactWidth: '115px' },
  { label: '', width: '145px', compactWidth: '130px' },
];
export function HarnessRowsSkeleton() {
  return (
    <ListTableSkeleton
      columns={harnessColumns}
      label="Loading harnesses…"
      rowClassName={styles.rowHeading}
    >
      <Stack gap={7}>
        <Placeholder h={12} w="55%" />
        <Placeholder h={9} w="80%" />
      </Stack>
      <Placeholder h={18} w={70} />
      <Placeholder h={14} w={85} />
      <span>
        <Placeholder h={30} w={100} />
      </span>
    </ListTableSkeleton>
  );
}
export function HarnessLibrarySkeleton() {
  const tab = aiSettingsTab(useLocation());
  return (
    <section className={workspacePage.page}>
      <PageHeader title="AI Settings" />
      <PageTabsSkeleton items={aiSettingsTabs} value={tab} showCounts={false} />
      <div className={workspacePage.content}>
        <HarnessRowsSkeleton />
      </div>
    </section>
  );
}
