import {
  Stack,
  Placeholder,
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../design-system';

import { useSearchParams } from 'react-router';

import { ListTableSkeleton } from '../../components/ListTable/ListTable';

import { automationTable, listQuery, statusViews } from './model';
import classes from './Automations.module.css';

export function AutomationListSkeleton() {
  const [search] = useSearchParams();
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Automations"
        controls={
          <>
            <div className={classes.workflowFilter}>
              <Placeholder h={40} />
            </div>
            <div className={classes.toolbarSearch}>
              <Placeholder h={40} />
            </div>
          </>
        }
        actions={<Placeholder h={40} w={145} />}
      />
      <PageTabsSkeleton items={statusViews} value={listQuery(search).status} />
      <div className={workspacePage.content}>
        <AutomationRowsSkeleton />
      </div>
    </section>
  );
}

export function AutomationRowsSkeleton() {
  return (
    <ListTableSkeleton
      {...automationTable}
      label="Loading automations…"
      footer={
        <div className={classes.pagination}>
          <Placeholder h={10} w={85} />
        </div>
      }
    >
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
    </ListTableSkeleton>
  );
}
