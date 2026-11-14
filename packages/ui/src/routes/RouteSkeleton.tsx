import {
  Center,
  Loader,
  Stack,
  Placeholder,
  PageTabsSkeleton,
  VisuallyHidden,
  workspacePage,
} from '../design-system';
import { useSearchParams } from 'react-router';

import {
  PromptEditorSkeleton,
  PromptLibrarySkeleton,
} from '../features/prompts/PromptSkeleton';
import editor from '../features/workflows/WorkflowEditor.module.css';
import { WorkflowLibrarySkeleton } from '../features/workflows/WorkflowLibrarySkeleton';
import { workflowSection } from '../features/workflows/workflowListConfig';

export type LoadingSubject = 'workflows' | 'workflow' | 'prompts' | 'prompt';

export function RouteSkeleton({ subject }: { subject: LoadingSubject }) {
  if (subject === 'workflows') return <WorkflowLibrarySkeleton />;
  if (subject === 'prompts') return <PromptLibrarySkeleton />;
  if (subject === 'prompt') return <PromptEditorSkeleton />;
  return <WorkflowLoading />;
}

function WorkflowLoading() {
  const [search] = useSearchParams();
  const view = search.get('view');
  const section = workflowSection(view);
  return (
    <>
      <VisuallyHidden role="status">Loading workflow…</VisuallyHidden>
      <section className={editor.editor} aria-busy="true" aria-hidden="true">
        <header className={workspacePage.header}>
          <div className={workspacePage.headerHeading}>
            <Placeholder h={40} w={40} />
            <Stack gap={6} w="min(45%, 240px)">
              <Placeholder h={28} />
              <Placeholder h={12} w="62%" />
            </Stack>
          </div>
        </header>
        <div
          className={editor.sections}
          data-canvas-section={section === 'editor' || undefined}
        >
          <PageTabsSkeleton
            items={[
              { value: 'editor', label: 'Editor' },
              { value: 'runs', label: 'Runs' },
              { value: 'tests', label: 'Tests' },
              { value: 'report', label: 'Report' },
              { value: 'memory', label: 'Memory' },
              { value: 'children', label: 'Child workflows' },
            ]}
            value={section}
            showCounts={false}
          />
          <Center
            className={
              section === 'editor' ? editor.canvasWrap : workspacePage.content
            }
            mih={0}
          >
            <Loader />
          </Center>
        </div>
      </section>
    </>
  );
}
