import {
  SimpleGrid,
  Stack,
  LoadingSkeleton,
  Placeholder,
  PageHeader,
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
        controls={
          <>
            <div className={styles.workflowFilter}>
              <Placeholder h={40} />
            </div>
            <div className={styles.durationFilter}>
              <Placeholder h={40} />
            </div>
            <div className={styles.timeFilter}>
              <Placeholder h={40} />
            </div>
            <Placeholder h={40} w={132} />
          </>
        }
        actions={<Placeholder h={40} w={100} />}
      />
      <div className={workspacePage.content}>
        <ReportLoadingContent />
      </div>
    </section>
  );
}
