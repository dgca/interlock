import { useSearchParams } from 'react-router';
import { Stack } from '@mantine/core';
import {
  LoadingSkeleton,
  Placeholder,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import {
  PageHeader,
  workspacePage,
} from '../../components/PageLayout/PageLayout';
import { runTab } from './runAttention';
import classes from './RunList.module.css';

export function RunListSkeleton({ embedded = false }: { embedded?: boolean }) {
  const [search] = useSearchParams();
  const selected = runTab(search.get('tab'));
  return (
    <section className={workspacePage.page} aria-busy="true">
      {!embedded && <PageHeader title="Runs" />}
      <div className={workspacePage.tabs} aria-hidden="true">
        <div className={workspacePage.tabLinks}>
          {[
            ['active', 'Active'],
            ['attention', 'Needs attention'],
            ['history', 'History'],
          ].map(([value, label]) => (
            <span
              key={value}
              className={workspacePage.tab}
              aria-current={selected === value ? 'page' : undefined}
            >
              {label}
              <Placeholder h={10} w={10} />
            </span>
          ))}
        </div>
        <div className={workspacePage.filters}>
          <Placeholder h={30} w={130} />
        </div>
      </div>
      <div className={workspacePage.content}>
        <RunRowsSkeleton />
      </div>
    </section>
  );
}

export function RunRowsSkeleton() {
  return (
    <LoadingSkeleton label="Loading runs…">
      <div className={classes.table}>
        <div className={classes.heading}>
          <span>Workflow</span>
          <span>Status</span>
          <span>Started</span>
          <span>Steps</span>
          <span />
        </div>
        {[1, 2, 3].map((row) => (
          <div key={row} className={classes.row}>
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
          </div>
        ))}
      </div>
    </LoadingSkeleton>
  );
}
