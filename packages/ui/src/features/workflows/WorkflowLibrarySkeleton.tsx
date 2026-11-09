import {
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../components/PageLayout/PageLayout';
import { Placeholder } from '../../components/LoadingSkeleton/LoadingSkeleton';
import { WorkflowCardsSkeleton } from '../../components/WorkflowCards/WorkflowCards';
import { workflowViews } from './workflowListConfig';
export function WorkflowLibrarySkeleton() {
  return (
    <section className={workspacePage.page}>
      <PageHeader title="Workflows" />
      <PageTabsSkeleton items={workflowViews} value="active">
        <Placeholder h={36} w={240} />
      </PageTabsSkeleton>
      <div className={workspacePage.content}>
        <WorkflowCardsSkeleton />
      </div>
    </section>
  );
}
