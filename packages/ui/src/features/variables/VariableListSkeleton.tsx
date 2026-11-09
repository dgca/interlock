import { Stack } from '@mantine/core';
import { useNavigate } from 'react-router';
import {
  PageHeader,
  PageToolbar,
  workspacePage,
} from '../../components/PageLayout/PageLayout';
import {
  ListTableSkeleton,
  type ListTableColumn,
} from '../../components/ListTable/ListTable';
import {
  FormPlaceholder,
  LoadingSkeleton,
  Placeholder,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import { paths } from '../../routes/paths';
import styles from './Variables.module.css';

export const variableColumns: readonly ListTableColumn[] = [
  { label: 'Name', width: 'minmax(0, 1fr)' },
  { label: 'Kind', width: '90px', compactWidth: '75px' },
  { label: 'Status', width: '130px', compactWidth: '110px' },
  { label: 'Updated', width: '110px', compactWidth: '95px' },
  { label: '', width: '16px' },
];

export function VariableRowsSkeleton() {
  return (
    <ListTableSkeleton
      columns={variableColumns}
      label="Loading variables…"
      rowClassName={styles.listRow}
    >
      <Stack gap={7}>
        <Placeholder h={12} w="55%" />
        <Placeholder h={9} w="80%" />
      </Stack>
      <Placeholder h={18} w={46} />
      <Placeholder h={10} w={70} />
      <Placeholder className={styles.updated} h={10} w={70} />
      <span />
    </ListTableSkeleton>
  );
}

export function VariableLibrarySkeleton() {
  return (
    <section className={workspacePage.page}>
      <PageHeader title="Variables" />
      <PageToolbar summary={<Placeholder w={65} h={10} />}>
        <Placeholder w={220} h={36} />
      </PageToolbar>
      <div className={workspacePage.content}>
        <VariableRowsSkeleton />
      </div>
    </section>
  );
}

export function VariableEditorSkeleton({ creating }: { creating: boolean }) {
  const navigate = useNavigate();
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={creating ? 'New variable' : 'Variable'}
        onBack={() => void navigate(paths.variables)}
        backLabel="Back to variables"
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          <LoadingSkeleton
            label="Loading variable…"
            className={workspacePage.card}
          >
            <FormPlaceholder />
          </LoadingSkeleton>
        </div>
      </div>
    </section>
  );
}
