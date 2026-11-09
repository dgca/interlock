import { useSearchParams } from 'react-router';
import { Stack } from '@mantine/core';
import { Placeholder } from '../../components/LoadingSkeleton/LoadingSkeleton';
import { ListTableSkeleton } from '../../components/ListTable/ListTable';
import {
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../components/PageLayout/PageLayout';
import { runTab } from './runAttention';
import { runColumns, runViews } from './runListConfig';
import classes from './RunList.module.css';

export function RunListSkeleton({ embedded = false }: { embedded?: boolean }) {
  const [search] = useSearchParams();
  return (
    <section className={workspacePage.page} aria-busy="true">
      {!embedded && <PageHeader title="Runs" />}
      <PageTabsSkeleton items={runViews} value={runTab(search.get('tab'))}>
        <Placeholder h={30} w={130} />
      </PageTabsSkeleton>
      <div className={workspacePage.content}>
        <RunRowsSkeleton />
      </div>
    </section>
  );
}

export function RunRowsSkeleton() {
  return (
    <ListTableSkeleton
      columns={runColumns}
      label="Loading runs…"
      rowClassName={classes.row}
    >
      <Stack gap={7}>
        <Placeholder h={13} w="75%" />
        <Placeholder h={10} w={90} />
      </Stack>
      <Stack gap={7}>
        <Placeholder h={12} w={70} />
        <Placeholder h={10} w="80%" />
      </Stack>
      <Stack gap={7}>
        <Placeholder h={12} w="70%" />
        <Placeholder h={10} w="85%" />
      </Stack>
      <span>
        <Placeholder h={12} w={20} />
      </span>
      <Placeholder h={14} w={8} />
    </ListTableSkeleton>
  );
}
