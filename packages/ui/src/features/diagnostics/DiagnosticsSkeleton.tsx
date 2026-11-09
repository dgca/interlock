import {
  Group,
  Stack,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  workspacePage,
} from '../../design-system';

export function DiagnosticsLoadingContent() {
  return (
    <LoadingSkeleton label="Running diagnostics…">
      <Stack gap="lg">
        <Group className={workspacePage.card} justify="space-between">
          <Stack gap="sm" w="min(100%, 320px)">
            <Placeholder h={20} w="80%" />
            <Placeholder h={12} />
          </Stack>
          <Placeholder h={24} w={140} />
        </Group>
        {[0, 1, 2].map((category) => (
          <Stack key={category} className={workspacePage.card} gap="md">
            <Placeholder h={16} w="45%" />
            <Placeholder h={12} w="70%" />
            <Placeholder h={14} />
            <Placeholder h={14} w="85%" />
          </Stack>
        ))}
      </Stack>
    </LoadingSkeleton>
  );
}

export function DiagnosticsPageSkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Diagnostics"
        controls={<Placeholder h={20} w={85} />}
        actions={<Placeholder h={40} w={120} />}
      />
      <div className={workspacePage.content}>
        <DiagnosticsLoadingContent />
      </div>
    </section>
  );
}
