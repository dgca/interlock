import {
  Placeholder,
  PageHeader,
  PageTabsSkeleton,
  workspacePage,
} from '../../design-system';

import { WorkflowCardsSkeleton } from '../../components/WorkflowCards/WorkflowCards';
import { workflowViews } from './workflowListConfig';
export function WorkflowLibrarySkeleton() {
  return (
    <section className={workspacePage.page}>
      <PageHeader title="Workflows" />
      <PageTabsSkeleton
        items={workflowViews}
        value="active"
        toolbar={
          <>
            <Placeholder h={36} w={240} />
          </>
        }
      />
      <div className={workspacePage.content}>
        <WorkflowCardsSkeleton />
      </div>
    </section>
  );
}
