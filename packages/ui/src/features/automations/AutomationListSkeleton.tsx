import { Stack } from '@mantine/core';
import { useSearchParams } from 'react-router';
import {
  LoadingSkeleton,
  Placeholder,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import {
  PageHeader,
  workspacePage,
} from '../../components/PageLayout/PageLayout';
import { listQuery, statusViews } from './model';
import classes from './Automations.module.css';

export function AutomationListSkeleton() {
  const [search] = useSearchParams();
  const { status } = listQuery(search);
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Automations"
        actions={<Placeholder h={32} w={126} />}
      />
      <div className={workspacePage.tabs} aria-hidden="true">
        <div className={workspacePage.tabLinks}>
          {statusViews.map((view) => (
            <span
              key={view.value}
              className={workspacePage.tab}
              aria-current={status === view.value ? 'page' : undefined}
            >
              {view.label}
              <Placeholder h={10} w={10} />
            </span>
          ))}
        </div>
        <div className={workspacePage.filters}>
          <div className={classes.workflowFilter}>
            <Placeholder h={36} />
          </div>
          <div className={classes.toolbarSearch}>
            <Placeholder h={36} />
          </div>
        </div>
      </div>
      <div className={workspacePage.content}>
        <AutomationRowsSkeleton />
      </div>
    </section>
  );
}

export function AutomationRowsSkeleton() {
  return (
    <LoadingSkeleton label="Loading automations…">
      <div className={classes.list}>
        <div className={classes.listHeader}>
          <span>Automation</span>
          <span>Workflow</span>
          <span>Status</span>
          <span>Activity</span>
          <span />
        </div>
        {[1, 2, 3].map((row) => (
          <div key={row} className={classes.listRow} style={{ minHeight: 92 }}>
            <Stack gap={7}>
              <Placeholder h={13} w="75%" />
              <Placeholder h={10} w="60%" />
            </Stack>
            <Placeholder h={13} w="70%" />
            <Placeholder h={12} w={70} />
            <Stack gap={7}>
              <Placeholder h={11} w="88%" />
              <Placeholder h={10} w="72%" />
            </Stack>
            <Placeholder h={14} w={8} />
          </div>
        ))}
      </div>
      <div className={classes.pagination}>
        <Placeholder h={10} w={85} />
      </div>
    </LoadingSkeleton>
  );
}
