import {
  LoadingSkeleton,
  PageHeader,
  Placeholder,
  Stack,
  workspacePage,
} from '../../design-system';
import classes from './Boards.module.css';

export function BoardRowsSkeleton() {
  return (
    <LoadingSkeleton label="Loading boards…">
      {[1, 2, 3].map((row) => (
        <div key={row} className={classes.libraryRow}>
          <Placeholder w={40} h={40} />
          <Stack gap={7}>
            <Placeholder w="45%" h={16} />
            <Placeholder w="65%" h={12} />
          </Stack>
        </div>
      ))}
    </LoadingSkeleton>
  );
}

export function BoardLibrarySkeleton() {
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Boards"
        controls={<Placeholder className={classes.librarySearch} h={40} />}
        actions={<Placeholder w={116} h={40} />}
      />
      <div className={workspacePage.content}>
        <BoardRowsSkeleton />
      </div>
    </section>
  );
}

export function BoardColumnsSkeleton() {
  return (
    <LoadingSkeleton
      label="Loading board…"
      className={`${classes.scroller} ${classes.boardSkeleton}`}
    >
      <div className={classes.columns}>
        {[1, 2, 3].map((column) => (
          <Stack key={column} className={classes.column} gap="xs">
            <Placeholder h={16} w={95} />
            {[1, 2].map((card) => (
              <Stack key={card} className={classes.card} gap="xs">
                <Placeholder h={14} w="75%" />
                <Placeholder h={12} w="55%" />
              </Stack>
            ))}
          </Stack>
        ))}
      </div>
    </LoadingSkeleton>
  );
}
