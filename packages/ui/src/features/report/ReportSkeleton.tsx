import {
  SimpleGrid,
  Stack,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
  PageToolbar,
  workspacePage,
} from '../../design-system';

import styles from './WorkflowReportView.module.css';

export function ReportLoadingContent() {
  return (
    <LoadingSkeleton label="Loading report…">
      <Stack gap="lg">
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 3 }} spacing="md">
          {Array.from({ length: 6 }, (_, index) => (
            <Stack key={index} gap="sm" className={workspacePage.card}>
              <Placeholder h={14} w="65%" />
              <Placeholder h={26} w="50%" />
              <Placeholder h={12} w="80%" />
            </Stack>
          ))}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {[0, 1].map((index) => (
            <Stack key={index} gap="md" className={workspacePage.card}>
              <Placeholder h={18} w="70%" />
              <Placeholder h={14} />
              <Placeholder h={14} />
              <Placeholder h={14} w="80%" />
            </Stack>
          ))}
        </SimpleGrid>
      </Stack>
    </LoadingSkeleton>
  );
}

export function ReportPageSkeleton() {
  return (
    <section className={workspacePage.page} aria-busy="true">
      <PageHeader
        title="Performance & cost report"
        actions={<Placeholder h={30} w={90} />}
      />
      <PageToolbar
        summary={
          <div className={styles.filters}>
            <Placeholder h={30} w={200} />
            <Placeholder h={30} w={245} />
            <Placeholder h={30} w={140} />
          </div>
        }
      >
        <Placeholder h={30} w={110} />
      </PageToolbar>
      <div className={workspacePage.content}>
        <ReportLoadingContent />
      </div>
    </section>
  );
}
