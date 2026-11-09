import {
  Stack,
  FormPlaceholder,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  PageToolbar,
  workspacePage,
} from '../../design-system';

import {
  ListTableSkeleton,
  type ListTableColumn,
} from '../../components/ListTable/ListTable';

import styles from './Prompts.module.css';

export const promptColumns: readonly ListTableColumn[] = [
  { label: 'Name', width: 'minmax(0, 1fr)' },
  { label: 'Revision', width: '110px', compactWidth: '100px' },
  { label: 'Updated', width: '110px', compactWidth: '95px' },
  { label: '', width: '16px' },
];

export function PromptLibrarySkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader title="Prompts" actions={<Placeholder h={32} w={114} />} />
      <PageToolbar summary={<Placeholder h={10} w={65} />}>
        <div className={workspacePage.search}>
          <Placeholder h={36} />
        </div>
      </PageToolbar>
      <div className={workspacePage.content}>
        <ListTableSkeleton
          columns={promptColumns}
          label="Loading prompts…"
          rowClassName={styles.listRow}
        >
          <Stack gap={7}>
            <Placeholder h={13} w="55%" />
            <Placeholder h={10} w="80%" />
          </Stack>
          <Placeholder h={12} w={70} />
          <Placeholder className={styles.updated} h={12} w={70} />
          <Placeholder className={styles.rowArrow} h={14} w={8} />
        </ListTableSkeleton>
      </div>
    </section>
  );
}

export function PromptEditorSkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader title="Prompt" actions={<Placeholder h={32} w={70} />} />
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
