import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpRight, ChevronDown, Copy } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import {
  requestKey,
  requestTargetSchema,
  type HumanResponse,
  type Json,
  type RequestTarget,
} from '@interlock/core';
import {
  ActionError,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Loader,
  NativeSelect,
  Menu,
  ScrollArea,
  PageHeader,
  Stack,
  Text,
  Textarea,
  workspacePage,
} from '../../design-system';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import { paths, runReturnLocation } from '../../routes/paths';
import { ManagedRequestControls } from '../executors/ManagedExecutionPanel';
import { ModelPicker } from '../executors/ModelPicker';
import { ExternalTaskLink } from '../../components/ExternalTaskLink';
import classes from './Boards.module.css';
import { approvedLabel, RequestEvidence, ReviewText } from './RequestEvidence';

type Detail = Awaited<ReturnType<typeof api.requests.get.query>>;
type HumanDetail = Extract<Detail, { kind: 'human' }>;
type Draft = {
  choice?: string;
  comment?: string;
  text?: string;
  submission?: Extract<HumanResponse, { action: 'answer' }>;
};
const drafts = new Map<string, Draft>();
const pageSize = 100;

export function parseRequestTarget(
  value: string | null,
): RequestTarget | undefined {
  if (!value) return;
  try {
    const parsed = requestTargetSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function GlobalRequestRoute() {
  const [search] = useSearchParams();
  const target = parseRequestTarget(search.get('request'));
  const { state } = useLocation();
  const navigate = useNavigate();
  const returnTo = runReturnLocation(search.get('returnTo') ?? state?.returnTo);
  if (!target)
    return (
      <div className={classes.content}>
        <ActionError message="Request target is missing or invalid." />
      </div>
    );
  return (
    <RequestView
      target={target}
      backLabel={returnTo?.label ?? 'Back to runs'}
      onBack={() => void navigate(returnTo?.path ?? paths.runs('attention'))}
      requestHref={(next) => paths.request(next, returnTo?.path)}
    />
  );
}

export function RequestView({
  target,
  backLabel,
  onBack,
  requestHref,
}: {
  target: RequestTarget;
  backLabel: string;
  onBack: () => void;
  requestHref: (target: RequestTarget) => string;
}) {
  const query = useQuery(trpc.requests.get.queryOptions(target));
  const detail = query.data;
  const heading = useRef<HTMLHeadingElement>(null);
  const key = requestKey(target);
  useEffect(() => {
    if (detail) heading.current?.focus({ preventScroll: true });
  }, [key, Boolean(detail)]);
  const location = useLocation();
  const runLink = paths.run(target.runId, {
    tab: 'attention',
    executionId: target.executionId,
    returnTo: location.pathname + location.search,
  });
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title={detail?.card.title ?? 'Request'}
        subtitle={
          detail && (
            <Group gap="sm">
              <span>
                {detail.card.workflowName} · Run {target.runId.slice(0, 8)}
              </span>
              <ExternalTaskLink task={detail.card.externalTask} />
            </Group>
          )
        }
        actions={
          <Button component={Link} to={runLink}>
            <ArrowUpRight size={16} /> Open run
          </Button>
        }
      />
      <div className={classes.requestScroll}>
        <div className={classes.requestBody}>
          <Group justify="space-between" className={classes.requestNav}>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={16} /> {backLabel}
            </Button>
            {detail && (
              <RequestSelector
                key={detail.card.id}
                detail={detail}
                requestHref={requestHref}
              />
            )}
          </Group>
          {query.error && <ActionError message={errorMessage(query.error)} />}
          {query.isPending && <Loader aria-label="Loading request" />}
          {detail && (
            <Stack gap="md" className={classes.requestCard}>
              <h2 ref={heading} tabIndex={-1}>
                {detail.question}
              </h2>
              {'context' in detail && detail.context && (
                <ReviewText>{detail.context}</ReviewText>
              )}
              <RequestEvidence detail={detail} />
              <RequestAnswer
                key={key}
                detail={detail}
                reload={query.refetch}
                requestHref={requestHref}
              />
            </Stack>
          )}
        </div>
      </div>
    </div>
  );
}

function RequestSelector({
  detail,
  requestHref,
}: {
  detail: Detail;
  requestHref: (target: RequestTarget) => string;
}) {
  const [pages, setPages] = useState(1);
  const results = useQueries({
    queries: Array.from({ length: pages }, (_, index) =>
      trpc.requests.list.queryOptions({
        runId: detail.card.id,
        offset: index * pageSize,
        limit: pageSize,
      }),
    ),
  });
  const selected = requestKey(detail.target);
  const choices = new Map(
    results
      .flatMap((result) => result.data?.items ?? [])
      .map((item) => [requestKey(item.target), item]),
  );
  if (!choices.has(selected))
    choices.set(selected, {
      target: detail.target,
      label: detail.executionLabel,
      cardId: detail.card.id,
      since: '',
    });
  if (choices.size < 2) return null;
  const labelCounts = new Map<string, number>();
  for (const { label } of choices.values())
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  return (
    <Group gap="xs">
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            variant="secondary"
            rightSection={<ChevronDown size={16} aria-hidden="true" />}
          >
            Switch request
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <ScrollArea.Autosize mah={280}>
            {[...choices].map(([key, item]) => (
              <Menu.Item
                key={key}
                component={Link}
                to={requestHref(item.target)}
                aria-current={key === selected ? 'page' : undefined}
                replace
                preventScrollReset
              >
                {item.label}
                {(labelCounts.get(item.label) ?? 0) > 1 &&
                  ` · ${('requestId' in item.target ? item.target.requestId : (item.target.executionId ?? item.target.runId)).slice(0, 8)}`}
              </Menu.Item>
            ))}
          </ScrollArea.Autosize>
        </Menu.Dropdown>
      </Menu>
      {results.at(-1)?.data?.nextOffset != null && (
        <Button variant="ghost" onClick={() => setPages((count) => count + 1)}>
          More requests
        </Button>
      )}
    </Group>
  );
}

function RequestAnswer({
  detail,
  reload,
  requestHref,
}: {
  detail: Detail;
  reload: () => Promise<{ isError: boolean; data?: Detail }>;
  requestHref: (target: RequestTarget) => string;
}) {
  const queryClient = useQueryClient();
  const siblings = useQuery(
    trpc.requests.list.queryOptions({
      runId: detail.card.id,
      offset: 0,
      limit: pageSize,
    }),
  );
  const currentKey = requestKey(detail.target);
  const next = siblings.data?.items.find(
    (item) => requestKey(item.target) !== currentKey,
  );
  const [draft, setDraft] = useState<Draft>(() => drafts.get(currentKey) ?? {});
  const [model, setModel] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [recoveryReason, setRecoveryReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertainState, setUncertainState] = useState<Detail['state']>();
  const [error, setError] = useState<{
    state: Detail['state'];
    message: string;
  }>();
  const uncertain = uncertainState === detail.state;
  const lock = useRef(false);
  const changeDraft = (change: Partial<Draft>) => {
    const updated = { ...draft, submission: undefined, ...change };
    drafts.set(currentKey, updated);
    setDraft(updated);
    setError(undefined);
  };
  const verify = async () => {
    const check = await reload();
    setUncertainState(check.isError ? detail.state : undefined);
    return check;
  };
  const perform = async (
    mutate: () => Promise<unknown>,
    clearDraft = false,
  ) => {
    if (lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await mutate();
      if (clearDraft) {
        drafts.delete(currentKey);
        setDraft({});
      }
      await verify();
      void refreshQueries(queryClient);
    } catch (e) {
      const check = await verify();
      if (!check.data || check.data.state === detail.state)
        setError({ state: detail.state, message: errorMessage(e) });
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const respond = (human: HumanDetail, value: Json) => {
    const saved = draft.submission;
    const submission: Extract<HumanResponse, { action: 'answer' }> =
      saved && JSON.stringify(saved.value) === JSON.stringify(value)
        ? saved
        : {
            action: 'answer',
            target: human.target,
            expectedRevision: human.status.revision,
            submissionId: crypto.randomUUID(),
            value,
          };
    changeDraft({ submission });
    void perform(
      () => api.requests.answer.mutate({ request: submission }),
      true,
    );
  };

  const disabled = busy || uncertain;
  const actionable = detail.state === 'open' || detail.state === 'saved';
  const remaining = next
    ? ` ${next.label} still needs attention.`
    : detail.remainingBlocker
      ? ` ${detail.remainingBlocker}.`
      : '';
  const receipt =
    detail.state === 'accepted'
      ? `${decision(detail)}${detail.kind === 'human' && detail.source === 'mcp' ? ' through MCP' : ''}.${remaining ?? ''}`
      : detail.state === 'cancelled'
        ? 'Request cancelled.'
        : detail.state === 'superseded'
          ? 'This request was replaced.'
          : detail.state === 'resolved'
            ? detail.kind === 'stalled'
              ? 'Investigation cleared.'
              : 'Recovery resolved.'
            : undefined;
  const held =
    detail.kind === 'human' &&
    Boolean(detail.status.heldByRunId || detail.status.pauseCount);
  const holding = detail.kind === 'human' ? detail.holding : undefined;
  const unsent = draft.comment || draft.text;
  return (
    <>
      {receipt && (
        <Text role="status" className={classes.receipt}>
          {receipt}
        </Text>
      )}
      {receipt && unsent && (
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Your unsent {draft.comment ? 'comment' : 'answer'}
            </Text>
            <CopyButton value={unsent}>
              {({ copied, copy }) => (
                <Button variant="ghost" onClick={copy}>
                  <Copy size={14} />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              )}
            </CopyButton>
          </Group>
          <Textarea
            aria-label="Unsent draft"
            value={unsent}
            readOnly
            autosize
            maxRows={8}
          />
        </Stack>
      )}
      {receipt && (detail.replacement || next) && (
        <Group justify="flex-end">
          <Button
            component={Link}
            to={requestHref(detail.replacement ?? next!.target)}
            replace
            preventScrollReset
          >
            {detail.replacement
              ? 'Open current request'
              : `Open ${next!.label}`}
          </Button>
        </Group>
      )}
      {detail.kind === 'human' && detail.state === 'saved' && (
        <>
          <Text role="status" className={classes.receipt}>
            {held
              ? 'Answer saved; waiting for hold release.'
              : 'Answer saved. Accept it to continue.'}
          </Text>
          <Group justify="flex-end">
            {holding && (
              <Button
                disabled={disabled}
                onClick={() =>
                  void perform(() =>
                    api.runs.externalInput.mutate({
                      action: 'release',
                      runId: holding.runId,
                      expectedRevision: holding.revision,
                    }),
                  )
                }
              >
                Release acceptance hold
              </Button>
            )}
            <Button
              variant="primary"
              disabled={disabled || held}
              onClick={() =>
                void perform(() =>
                  api.requests.answer.mutate({
                    request: {
                      action: 'accept',
                      target: detail.target,
                      expectedRevision: detail.status.revision,
                    },
                  }),
                )
              }
            >
              Accept saved answer
            </Button>
          </Group>
        </>
      )}
      {detail.kind === 'human' && detail.state === 'open' && (
        <HumanForm
          detail={detail}
          draft={draft}
          change={changeDraft}
          disabled={disabled}
          respond={(value) => respond(detail, value)}
        />
      )}
      {detail.state === 'open' &&
        (detail.kind === 'permission' || detail.kind === 'question') &&
        'managedExecutionId' in detail.target && (
          <ManagedRequestControls
            request={detail.request}
            focused
            busy={disabled}
            sending={busy}
            onAnswer={(answer) =>
              perform(() =>
                api.executors.manage.mutate({
                  action: 'respond',
                  executionId:
                    'managedExecutionId' in detail.target
                      ? detail.target.managedExecutionId
                      : '',
                  requestId: detail.request.id,
                  answer,
                }),
              )
            }
          />
        )}
      {detail.state === 'open' &&
        detail.kind === 'model' &&
        'managedExecutionId' in detail.target && (
          <>
            <ModelPicker
              label="Replacement model"
              defaultLabel="Choose a model"
              value={model}
              onChange={setModel}
              profileId={detail.profileId}
              disabled={disabled}
            />
            <Group justify="flex-end">
              <Button
                variant="primary"
                disabled={disabled || !model}
                onClick={() => {
                  const target = detail.target;
                  if (model && 'managedExecutionId' in target)
                    void perform(() =>
                      api.executors.manage.mutate({
                        action: 'retry_model',
                        executionId: target.managedExecutionId,
                        model,
                      }),
                    );
                }}
              >
                Retry with selected model
              </Button>
            </Group>
          </>
        )}
      {detail.state === 'open' &&
        detail.kind === 'recovery' &&
        'managedExecutionId' in detail.target && (
          <>
            <Checkbox
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              label="I verified that the harness and its commands have stopped"
              disabled={disabled}
            />
            <Group justify="flex-end">
              <Button
                variant="primary"
                disabled={disabled || !confirmed}
                onClick={() => {
                  const target = detail.target;
                  if ('managedExecutionId' in target)
                    void perform(() =>
                      api.executors.manage.mutate({
                        action: 'reconcile',
                        executionId: target.managedExecutionId,
                        confirmStopped: true,
                      }),
                    );
                }}
              >
                Confirm stopped
              </Button>
            </Group>
          </>
        )}
      {detail.state === 'open' &&
        (detail.kind === 'resource' || detail.kind === 'script') && (
          <>
            <Checkbox
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              label={
                detail.kind === 'script'
                  ? 'I verified that the supervisor and Script stopped and inspected their effects'
                  : 'I verified that this attempt and its subprocesses have stopped'
              }
              disabled={disabled}
            />
            {detail.kind === 'script' && (
              <Textarea
                label="Reconciliation reason"
                required
                maxLength={1000}
                value={recoveryReason}
                disabled={disabled}
                onChange={(event) =>
                  setRecoveryReason(event.currentTarget.value)
                }
              />
            )}
            <Group justify="flex-end">
              <Button
                variant="primary"
                disabled={
                  disabled ||
                  !confirmed ||
                  (detail.kind === 'script' && !recoveryReason.trim())
                }
                onClick={() => {
                  const target = detail.target;
                  if (target.kind === 'script')
                    void perform(() =>
                      api.runs.script.mutate({
                        action: 'reconcile',
                        runId: target.runId,
                        executionId: target.executionId,
                        stopped: true,
                        reason: recoveryReason,
                      }),
                    );
                  else
                    void perform(() =>
                      api.work.resources.mutate({
                        action: 'release',
                        expectedAttempt: target.attempt,
                        confirmStopped: true,
                        actor: 'operator',
                        ...(target.workId
                          ? { workId: target.workId }
                          : {
                              runId: target.runId,
                              executionId: target.executionId,
                            }),
                      }),
                    );
                }}
              >
                Confirm stopped
              </Button>
            </Group>
          </>
        )}
      {detail.kind === 'scriptApproval' && detail.state === 'open' && (
        <Group justify="flex-end">
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => {
              const { runId, executionId } = detail.target;
              void perform(() =>
                api.scripts.approve.mutate({ runId, executionId }),
              );
            }}
          >
            Approve and run
          </Button>
        </Group>
      )}
      {detail.kind === 'stalled' && detail.state === 'open' && (
        <Text size="sm">
          This step crossed its configured stall threshold. Open the run to
          inspect the current blocker.
        </Text>
      )}
      {error?.state === detail.state && actionable && (
        <ActionError message={error.message} />
      )}
      {uncertain && actionable && (
        <Group>
          <Text size="sm">Check the request state before trying again.</Text>
          <Button onClick={() => void verify()}>Check request</Button>
        </Group>
      )}
    </>
  );
}

function decision(detail: Detail) {
  if (detail.kind === 'human' && typeof detail.value === 'string') {
    const value =
      detail.value.length > 100
        ? detail.value.slice(0, 100) + '…'
        : detail.value;
    return `Accepted “${value}”`;
  }
  if (
    detail.kind === 'human' &&
    detail.answer.kind === 'choice' &&
    detail.value &&
    typeof detail.value === 'object' &&
    'choice' in detail.value
  ) {
    const label = detail.answer.choices.find(
      (choice) => choice.value === (detail.value as { choice: Json }).choice,
    )?.label;
    if (label === 'Approve') return 'Approved';
    if (label === 'Request changes') return 'Changes requested';
    return label ? `Answer accepted: ${label}` : 'Answer accepted';
  }
  if (detail.kind === 'permission')
    return detail.request.answer?.allow ? 'Allowed once' : 'Denied';
  if (detail.kind === 'model') return 'Replacement model recorded';
  if (detail.kind === 'recovery') return 'Stop confirmed';
  if (detail.kind === 'scriptApproval') return approvedLabel(detail);
  return 'Answer accepted';
}

function HumanForm({
  detail,
  draft,
  change,
  disabled,
  respond,
}: {
  detail: HumanDetail;
  draft: Draft;
  change: (draft: Partial<Draft>) => void;
  disabled: boolean;
  respond: (value: Json) => void;
}) {
  const choices = detail.answer.kind === 'choice' ? detail.answer.choices : [];
  const review =
    choices.length === 2 &&
    choices.some(
      (choice) => choice.label === 'Approve' && !choice.requireComment,
    ) &&
    choices.some(
      (choice) => choice.label === 'Request changes' && choice.requireComment,
    );
  const selected = choices.find((choice) => choice.value === draft.choice);
  const choiceValue = (value: string) => ({
    choice: value,
    ...(draft.comment?.trim() ? { comment: draft.comment } : {}),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (detail.answer.kind === 'text' && draft.text?.trim())
          respond(draft.text);
        else if (
          selected &&
          (!selected.requireComment || draft.comment?.trim())
        )
          respond(choiceValue(selected.value));
      }}
    >
      <Stack gap="sm">
        {detail.answer.kind === 'text' && (
          <Textarea
            label="Answer"
            required
            autosize
            minRows={3}
            maxRows={12}
            disabled={disabled}
            maxLength={20000}
            value={draft.text ?? ''}
            onChange={(event) => change({ text: event.currentTarget.value })}
          />
        )}
        {detail.answer.kind === 'choice' && !review && (
          <NativeSelect
            label="Answer"
            required
            disabled={disabled}
            value={draft.choice ?? ''}
            onChange={(event) => change({ choice: event.currentTarget.value })}
            data={[
              { value: '', label: 'Choose an answer' },
              ...choices.map((choice) => ({
                value: choice.value,
                label: choice.label,
              })),
            ]}
          />
        )}
        {selected && (
          <Textarea
            label={review ? 'What needs to change?' : 'Comment'}
            required={selected.requireComment}
            disabled={disabled}
            autosize
            minRows={3}
            maxRows={12}
            maxLength={20000}
            value={draft.comment ?? ''}
            onChange={(event) => change({ comment: event.currentTarget.value })}
          />
        )}
        <Group justify="flex-end">
          {review && !selected ? (
            <>
              <Button
                type="button"
                disabled={disabled}
                onClick={() =>
                  change({
                    choice: choices.find((choice) => choice.requireComment)
                      ?.value,
                  })
                }
              >
                Request changes
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={disabled}
                onClick={() =>
                  respond({
                    choice: choices.find((choice) => !choice.requireComment)!
                      .value,
                  })
                }
              >
                Approve
              </Button>
            </>
          ) : (
            <>
              {review && (
                <Button
                  type="button"
                  disabled={disabled}
                  onClick={() => change({ choice: undefined })}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={
                  disabled ||
                  (detail.answer.kind === 'text'
                    ? !draft.text?.trim()
                    : !selected ||
                      Boolean(
                        selected.requireComment && !draft.comment?.trim(),
                      ))
                }
              >
                {review ? 'Request changes' : 'Submit answer'}
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </form>
  );
}
