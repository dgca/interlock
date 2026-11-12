import {
  Stack,
  Placeholder,
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../design-system';

import {
  ListTableSkeleton,
  type ListTableLayout,
} from '../../components/ListTable/ListTable';

import styles from './Harnesses.module.css';
import { useLocation } from 'react-router';
import { aiSettingsTab, aiSettingsTabs } from './aiSettingsNavigation';

export const harnessTable: ListTableLayout = {
  minWidth: 440,
  columns: [
    { label: 'Harness' },
    { label: 'Connection', width: '140px', compactWidth: '86px' },
    { label: 'Managed execution', width: '155px', compactWidth: '109px' },
    { label: 'Actions', width: '145px', compactWidth: '131px' },
  ],
};
export function HarnessRowsSkeleton() {
  return (
    <ListTableSkeleton {...harnessTable} label="Loading harnesses…">
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
    <section className={`${workspacePage.page} ${styles.aiPage}`}>
      <PageHeader title="AI Settings" />
      <PageTabsSkeleton items={aiSettingsTabs} value={tab} showCounts={false} />
      <div className={workspacePage.content}>
        <HarnessRowsSkeleton />
      </div>
    </section>
  );
}
