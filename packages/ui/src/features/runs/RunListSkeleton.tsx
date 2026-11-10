import {
  Stack,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  PageToolbar,
  PageTabsSkeleton,
  workspacePage,
} from '../../design-system';

import { useSearchParams } from 'react-router';

import { ListTableSkeleton } from '../../components/ListTable/ListTable';

import { runTab } from './runAttention';
import { runColumns, runViews, runMode } from './runListConfig';
import classes from './RunList.module.css';

export function RunListSkeleton({ embedded = false }: { embedded?: boolean }) {
  const [search] = useSearchParams();
  const tab = runTab(search.get('tab'));
  const mode = runMode(search.get('mode'));
  const controls = (
    <>
      <Placeholder h={40} w={180} />
      <Placeholder h={40} w={130} />
    </>
  );
  const actions = <Placeholder h={40} w={110} />;
  return (
    <section className={workspacePage.page} aria-busy="true">
      {!embedded && (
        <PageHeader title="Runs" controls={controls} actions={actions} />
      )}
      {mode === 'list' ? (
        <PageTabsSkeleton
          items={runViews}
          value={tab}
          toolbar={
            embedded ? (
              <>
                {controls}
                {actions}
              </>
            ) : undefined
          }
        />
      ) : embedded ? (
        <PageToolbar>
          {controls}
          {actions}
        </PageToolbar>
      ) : null}
      <div className={workspacePage.content}>
        {mode === 'overview' ? <RunBoardSkeleton /> : <RunRowsSkeleton />}
      </div>
    </section>
  );
}

export function RunBoardSkeleton() {
  return (
    <LoadingSkeleton label="Loading runs…" className={classes.board}>
      {['Active runs', 'Needs attention', 'Completed runs'].map((title) => (
        <div key={title} className={classes.boardColumn}>
          <div className={classes.columnHeading}>
            <h2>{title}</h2>
            <Placeholder h={20} w={24} />
          </div>
          {[0, 1].map((card) => (
            <div key={card} className={classes.runCard} data-loading>
              <div className={classes.cardBody}>
                <Placeholder h={12} w={90} />
                <Placeholder h={22} w="80%" />
                <Placeholder h={26} w={105} />
                <Placeholder h={14} w="70%" />
                <Placeholder h={12} w="95%" />
              </div>
              <div className={classes.cardAction}>
                <Placeholder h={13} w={100} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </LoadingSkeleton>
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
