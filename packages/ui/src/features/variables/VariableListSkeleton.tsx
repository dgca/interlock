import {
  Stack,
  FormPlaceholder,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { useNavigate } from 'react-router';

import {
  ListTableSkeleton,
  type ListTableLayout,
} from '../../components/ListTable/ListTable';

import { paths } from '../../routes/paths';

export const variableTable: ListTableLayout = {
  minWidth: 326,
  columns: [
    { label: 'Name' },
    { label: 'Kind', width: '90px', compactWidth: '66px' },
    { label: 'Status', width: '130px', compactWidth: '72px' },
    { label: 'Updated', width: '110px', compactWidth: '78px' },
  ],
};

export function VariableRowsSkeleton() {
  return (
    <ListTableSkeleton {...variableTable} label="Loading variables…">
      <Stack gap={7}>
        <Placeholder h={12} w="55%" />
        <Placeholder h={9} w="80%" />
      </Stack>
      <Placeholder h={18} w={46} />
      <Placeholder h={10} w={70} />
      <Placeholder h={10} w={70} />
    </ListTableSkeleton>
  );
}

export function VariableLibrarySkeleton() {
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Variables"
        subtitle={<Placeholder w={65} h={10} />}
        controls={
          <div className={workspacePage.search}>
            <Placeholder h={40} />
          </div>
        }
        actions={<Placeholder h={40} w={142} />}
      />
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
