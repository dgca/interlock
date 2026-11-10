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
      <PageHeader
        title="Workflows"
        controls={<Placeholder h={40} w={240} />}
        actions={
          <>
            <Placeholder h={40} w={110} />
            <Placeholder h={40} w={170} />
          </>
        }
      />
      <PageTabsSkeleton items={workflowViews} value="active" />
      <div className={workspacePage.content}>
        <WorkflowCardsSkeleton />
      </div>
    </section>
  );
}
