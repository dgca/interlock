import {
  FormPlaceholder,
  LoadingSkeleton,
  PageHeader,
  Placeholder,
  workspacePage,
} from '../../design-system';
import { ListTableSkeleton } from '../../components/ListTable/ListTable';
import styles from './Testing.module.css';

export const suiteTable = {
  columns: [
    { label: 'Suite', width: '50%' },
    { label: 'Cases', width: '14%' },
    { label: 'Revision', width: '16%' },
    { label: 'Updated', width: '20%' },
  ],
  minWidth: 520,
} as const;

export function SuiteRowPlaceholder() {
  return (
    <>
      <Placeholder h={14} w="60%" />
      <Placeholder h={12} w={24} />
      <Placeholder h={12} w={32} />
      <Placeholder h={12} w={72} />
    </>
  );
}

/** Tests section loading: toolbar and suite rows keep their loaded geometry. */
export function TestsViewSkeleton() {
  return (
    <div className={workspacePage.page}>
      <div className={workspacePage.toolbar} aria-hidden="true">
        <div className={workspacePage.filters}>
          <Placeholder h={40} w={150} />
        </div>
      </div>
      <div className={workspacePage.content}>
        <div className={styles.suiteContent}>
          <ListTableSkeleton {...suiteTable} label="Loading test suites…">
            <SuiteRowPlaceholder />
          </ListTableSkeleton>
        </div>
      </div>
    </div>
  );
}

/** Suite view and editor loading. The title is unknown until the suite loads. */
export function SuitePageSkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Test suite"
        subtitle={<Placeholder h={10} w={120} />}
        actions={<Placeholder h={40} w={120} />}
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          <LoadingSkeleton
            label="Loading test suite…"
            className={workspacePage.card}
          >
            <FormPlaceholder />
          </LoadingSkeleton>
        </div>
      </div>
    </section>
  );
}
