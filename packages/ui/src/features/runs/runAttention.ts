import type {
  RequestTarget,
  RunAttention,
  RunAttentionReason,
  RunWaiting,
  RunSummary,
} from '@interlock/core';
import { paths } from '../../routes/paths';
export type RunTab = 'active' | 'attention' | 'history';
export const runTab = (value: string | null): RunTab =>
  value === 'history' || value === 'attention' ? value : 'active';
export function attentionText(entry: RunAttention) {
  const labels = {
    approval: 'Approval requested',
    question: 'Answer needed',
    model: 'Choose a model',
    recovery: 'Recovery needed',
    stalled: 'Stalled',
    human: 'Human input needed',
    budget: 'Budget blocked',
  };
  return entry.reasons.map((reason) => labels[reason]).join(' · ');
}

/** Waits whose projected label already names the attention reason. */
export const attentionWait = (run: { waiting?: RunWaiting | null }) =>
  run.waiting?.kind === 'human_request' || run.waiting?.kind === 'budget';

export const waitReasonText: Record<
  NonNullable<RunSummary['waitReason']>,
  string
> = {
  held: 'Assignment on hold',
  agent: 'Waiting for an agent',
  managed: 'Waiting for a harness',
  claimed: 'Agent working',
  external_input: 'External input needed',
  external_review: 'Review external input',
  timer: 'Waiting for a timer',
  child: 'Waiting for a child run',
};

export function requestActionLabel(
  kind: RequestTarget['kind'] | RunAttentionReason | undefined,
) {
  switch (kind) {
    case 'model':
      return 'Choose a model';
    case 'recovery':
    case 'resource':
    case 'script':
      return 'Review recovery';
    case 'stalled':
      return 'Resolve stall';
    default:
      return 'Review request';
  }
}

export function runReviewLink(
  run: { request?: RequestTarget; attention?: RunAttention },
  runHref: (id: string, executionId?: string) => string,
  returnTo: string,
) {
  if (run.request)
    return {
      href: paths.request(run.request, returnTo),
      label: requestActionLabel(run.request.kind),
    };
  if (run.attention)
    return {
      href: runHref(
        run.attention.target.runId,
        run.attention.target.executionId,
      ),
      label: requestActionLabel(run.attention.reasons[0]),
    };
}
