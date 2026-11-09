import { Group, Stack } from '@mantine/core';
import {
  FormPlaceholder,
  LoadingSkeleton,
  Placeholder,
} from '../components/LoadingSkeleton/LoadingSkeleton';
import layout from '../components/PageLayout/PageLayout.module.css';
import library from '../components/PageLayout/LibraryList.module.css';
import editor from '../features/workflows/WorkflowEditor.module.css';
import { WorkflowLibrarySkeleton } from '../features/workflows/WorkflowLibrarySkeleton';

export type LoadingSubject = 'workflows' | 'workflow' | 'prompts' | 'prompt';

export function RouteSkeleton({ subject }: { subject: LoadingSubject }) {
  if (subject === 'workflows') return <WorkflowLibrarySkeleton />;
  const listing = subject === 'prompts';
  return (
    <LoadingSkeleton
      label={`Loading ${subject}…`}
      className={listing ? layout.page : editor.editor}
    >
      {listing ? (
        <>
          <header className={`${layout.header} ${layout.libraryHeader}`}>
            <h1>Prompts</h1>
            <Placeholder h={32} w={114} />
          </header>
          <div className={layout.libraryToolbar}>
            <Placeholder h={12} w={86} />
            <Placeholder h={26} w="min(42%, 175px)" />
          </div>
          <div className={library.listPanel}>
            <ul className={library.list}>
              {[1, 2, 3].map((row) => (
                <li key={row} className={library.row}>
                  <div className={library.rowIdentity}>
                    <Placeholder h={35} w={35} />
                    <Stack gap={6} w="min(60%, 240px)">
                      <Placeholder h={13} w="75%" />
                      <Placeholder h={9} />
                    </Stack>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          <header className={editor.header}>
            <Placeholder h={28} w={32} />
            <Stack gap={6} w="min(45%, 240px)">
              <Placeholder h={16} />
              <Placeholder h={10} w="62%" />
            </Stack>
          </header>
          {subject === 'workflow' ? (
            <>
              <Group className={editor.subnav} pb="sm">
                <Placeholder h={23} w={54} />
                <Placeholder h={23} w={54} />
                <Placeholder h={23} w={88} />
              </Group>
              <div className={editor.canvasWrap}>
                <Group p="md">
                  <Placeholder h={32} w={105} />
                  <Placeholder h={32} w={82} />
                </Group>
                <Group justify="center" gap="md" p="lg" mt="xl">
                  <Placeholder h={82} w="min(36%, 160px)" />
                  <Placeholder h={82} w="min(36%, 160px)" />
                </Group>
              </div>
            </>
          ) : (
            <div className={layout.formPage}>
              <div className={layout.formCard}>
                <FormPlaceholder />
              </div>
            </div>
          )}
        </>
      )}
    </LoadingSkeleton>
  );
}
