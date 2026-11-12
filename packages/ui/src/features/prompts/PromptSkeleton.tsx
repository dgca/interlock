import {
  Stack,
  FormPlaceholder,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  workspacePage,
} from '../../design-system';

import {
  ListTableSkeleton,
  type ListTableLayout,
} from '../../components/ListTable/ListTable';

export const promptTable: ListTableLayout = {
  minWidth: 288,
  columns: [
    { label: 'Name' },
    { label: 'Revision', width: '110px', compactWidth: '70px' },
    { label: 'Updated', width: '110px', compactWidth: '78px' },
  ],
};

export function PromptLibrarySkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Prompts"
        subtitle={<Placeholder h={10} w={65} />}
        controls={
          <div className={workspacePage.search}>
            <Placeholder h={40} />
          </div>
        }
        actions={<Placeholder h={40} w={134} />}
      />
      <div className={workspacePage.content}>
        <ListTableSkeleton {...promptTable} label="Loading prompts…">
          <Stack gap={7}>
            <Placeholder h={13} w="55%" />
            <Placeholder h={10} w="80%" />
          </Stack>
          <Placeholder h={12} w={70} />
          <Placeholder h={12} w={70} />
        </ListTableSkeleton>
      </div>
    </section>
  );
}

export function PromptEditorSkeleton({
  creating = false,
}: {
  creating?: boolean;
}) {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title={creating ? 'New prompt' : 'Prompt'}
        actions={<Placeholder h={40} w={100} />}
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          <LoadingSkeleton
            label="Loading prompt…"
            className={workspacePage.card}
          >
            <FormPlaceholder />
          </LoadingSkeleton>
        </div>
      </div>
    </section>
  );
}
