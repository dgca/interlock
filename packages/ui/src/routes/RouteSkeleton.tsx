import { Group, Stack, LoadingSkeleton, Placeholder } from '../design-system';

import {
  PromptEditorSkeleton,
  PromptLibrarySkeleton,
} from '../features/prompts/PromptSkeleton';
import editor from '../features/workflows/WorkflowEditor.module.css';
import { WorkflowLibrarySkeleton } from '../features/workflows/WorkflowLibrarySkeleton';

export type LoadingSubject = 'workflows' | 'workflow' | 'prompts' | 'prompt';

export function RouteSkeleton({ subject }: { subject: LoadingSubject }) {
  if (subject === 'workflows') return <WorkflowLibrarySkeleton />;
  if (subject === 'prompts') return <PromptLibrarySkeleton />;
  if (subject === 'prompt') return <PromptEditorSkeleton />;
  return (
    <LoadingSkeleton label={`Loading ${subject}…`} className={editor.editor}>
      <header className={editor.header}>
        <Placeholder h={28} w={32} />
        <Stack gap={6} w="min(45%, 240px)">
          <Placeholder h={16} />
          <Placeholder h={10} w="62%" />
        </Stack>
      </header>
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
    </LoadingSkeleton>
  );
}
