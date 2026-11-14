import {
  Anchor,
  Button,
  Group,
  LoadingSkeleton,
  PageHeader,
  Placeholder,
  Stack,
  Text,
  workspacePage,
} from '../../design-system';
import { Fragment, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CircleHelp, CircleX } from 'lucide-react';
import type { Workflow } from '@interlock/core';
import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import {
  availabilityText,
  checkLabels,
  costText,
  counts,
  executionLabels,
  formatMs,
  type ComparisonReport,
} from './comparisonText';
import { describeCheck } from './suiteDraft';
import styles from './Testing.module.css';

const sampleLimit = 10;
const caseLimit = 5;
const judgmentLimit = 10;

function Pager({
  label,
  offset,
  shown,
  total,
  limit,
  onChange,
}: {
  label: string;
  offset: number;
  shown: number;
  total: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return null;
  const next = offset + shown < total ? offset + shown : null;
  return (
    <Group justify="space-between" mt="sm" role="navigation" aria-label={label}>
      <Text size="sm" c="dimmed" aria-live="polite">
        {shown > 0 && `${offset + 1} to ${offset + shown} of ${total}`}
      </Text>
      <Group gap="xs">
        <Button
          variant="ghost"
          aria-disabled={offset === 0}
          data-disabled={offset === 0 || undefined}
          onClick={() => offset > 0 && onChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          aria-disabled={next === null}
          data-disabled={next === null || undefined}
          onClick={() => next !== null && onChange(next)}
        >
          Next
        </Button>
      </Group>
    </Group>
  );
}

const sideTable = {
  columns: [
    { label: 'Measure', width: '28%' },
    { label: 'Baseline', width: '36%' },
    { label: 'Candidate', width: '36%' },
  ],
  minWidth: 520,
} as const;
const caseTable = {
  columns: [
    { label: 'Case', width: '28%' },
    { label: 'Baseline checks', width: '20%' },
    { label: 'Candidate checks', width: '20%' },
    { label: 'Median time change', width: '16%' },
    { label: 'Judged pairs', width: '16%' },
  ],
  minWidth: 680,
} as const;
const sampleTable = {
  columns: [
    { label: 'Case', width: '26%' },
    { label: 'Side', width: '14%' },
    { label: 'Result', width: '14%' },
    { label: 'Checks', width: '20%' },
    { label: 'Time', width: '12%' },
    { label: 'Run', width: '14%', fitContent: true },
  ],
  minWidth: 720,
} as const;

function SideSummary({ report }: { report: ComparisonReport }) {
  const { baseline, candidate } = report.metrics.sides;
  const rows: [string, (side: typeof baseline) => string][] = [
    ['Runs', (s) => counts(s.execution, executionLabels)],
    ['Checks', (s) => counts(s.checks, checkLabels)],
    ['Median run time', (s) => formatMs(s.timing.rootElapsedMs.median)],
    [
      'Median time with descendants',
      (s) => formatMs(s.timing.treeElapsedMs.median),
    ],
    ['Reported cost', (s) => costText(s.usage)],
    [
      'Quality',
      (s) =>
        `${s.quality.judgedSamples} of ${s.samples} judged · ${s.quality.judgments} ${s.quality.judgments === 1 ? 'judgment' : 'judgments'}`,
    ],
  ];
  return (
    <div className={styles.compact}>
      <ListTable {...sideTable} label="Comparison by side">
        <ListTableRow>
          <span>Version</span>
          <span>Version {report.baselineVersion}</span>
          <span>Version {report.candidateVersion}</span>
        </ListTableRow>
        {rows.map(([label, value]) => (
          <ListTableRow key={label}>
            <span>{label}</span>
            <span>{value(baseline)}</span>
            <span>{value(candidate)}</span>
          </ListTableRow>
        ))}
      </ListTable>
    </div>
  );
}

export function ComparisonView({
  workflow,
  comparisonId,
}: {
  workflow: Workflow;
  comparisonId: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [offset, setOffset] = useState(0);
  const [caseOffset, setCaseOffset] = useState(0);
  const [judgmentOffset, setJudgmentOffset] = useState(0);
  const query = useQuery(
    trpc.testbench.report.queryOptions({
      id: comparisonId,
      offset,
      limit: sampleLimit,
      checkLimit: 10,
      caseOffset,
      caseLimit,
      judgmentOffset,
      judgmentLimit,
      metricsDetail: 'full',
    }),
  );
  const report = query.data;
  const back = () => void navigate(paths.workflowTests(workflow.id));
  const sampleNames = new Map(
    report?.samples.map((s) => [
      s.id,
      `${s.caseName} · ${s.side === 'baseline' ? 'Baseline' : 'Candidate'} ${s.repetition}`,
    ]),
  );
  const returnTo = location.pathname + location.search;
  if (
    (query.error && errorMessage(query.error) === 'Comparison not found') ||
    (report && report.workflowId !== workflow.id)
  )
    return (
      <div className="content-page">
        <h1>Comparison not found</h1>
        <Link to={paths.workflowTests(workflow.id)}>Back to tests</Link>
      </div>
    );
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={report?.suiteName ?? 'Comparison'}
        subtitle={
          report
            ? `${workflow.name} · Comparison ${report.id.slice(0, 8)} · Version ${report.baselineVersion} and ${report.candidateVersion} · ${report.repetitions} ${report.repetitions === 1 ? 'repetition' : 'repetitions'}`
            : workflow.name
        }
        status={report && <StatusBadge status={report.status} />}
        onBack={back}
        backLabel="Back to tests"
      />
      <div className={workspacePage.content}>
        <div className={styles.suiteContent}>
          <WorkspaceReadWarning
            inline
            reads={[workspaceRead('comparison report', query)]}
          />
          {!report ? (
            !query.error && <ComparisonSkeleton />
          ) : (
            <>
              <p className={styles.description}>
                {availabilityText(report.metrics.availability)}
              </p>
              <section aria-labelledby="comparison-sides">
                <h2 id="comparison-sides" className={styles.sectionTitle}>
                  Sides
                </h2>
                <SideSummary report={report} />
              </section>
              <section aria-labelledby="comparison-cases">
                <h2 id="comparison-cases" className={styles.sectionTitle}>
                  Cases
                </h2>
                <div className={styles.compact}>
                  <ListTable {...caseTable} label="Cases">
                    {report.metrics.cases.items.map((c) => (
                      <ListTableRow key={c.caseId}>
                        <span className={styles.identity}>
                          <strong>{c.name}</strong>
                          <small className={styles.mono}>{c.caseId}</small>
                        </span>
                        <span>{counts(c.baseline.checks, checkLabels)}</span>
                        <span>{counts(c.candidate.checks, checkLabels)}</span>
                        <span>
                          {formatMs(c.paired.timing.rootElapsedMs.median, true)}
                        </span>
                        <span>
                          {c.paired.bothJudged} of {c.repetitions}
                        </span>
                      </ListTableRow>
                    ))}
                  </ListTable>
                </div>
                <Pager
                  label="Case pages"
                  offset={caseOffset}
                  shown={report.metrics.cases.items.length}
                  total={report.metrics.cases.total}
                  limit={caseLimit}
                  onChange={setCaseOffset}
                />
                <p className={`${styles.hint} ${styles.tableNote}`}>
                  Time change is candidate minus baseline, per repetition pair.
                  Lower is not necessarily better.
                </p>
              </section>
              <section aria-labelledby="comparison-samples">
                <h2 id="comparison-samples" className={styles.sectionTitle}>
                  Samples
                </h2>
                <ListTable {...sampleTable} label="Samples">
                  {report.samples.map((s) => {
                    const observation = s.observation;
                    const open = observation?.checks.filter(
                      (c) => c.status !== 'pass',
                    );
                    const detail =
                      Boolean(open?.length) || Boolean(observation?.error);
                    return (
                      <Fragment key={s.id}>
                        <ListTableRow
                          className={detail ? styles.sampleRow : undefined}
                        >
                          <span className={styles.identity}>
                            <strong>{s.caseName}</strong>
                            <small>Repetition {s.repetition}</small>
                          </span>
                          <span>
                            {s.side === 'baseline' ? 'Baseline' : 'Candidate'} ·
                            v{s.version}
                          </span>
                          <span>
                            <StatusBadge
                              status={observation?.status ?? s.currentStatus}
                            />
                          </span>
                          <span>
                            {observation
                              ? counts(observation.checkCounts, checkLabels)
                              : 'Not observed'}
                          </span>
                          <span>
                            {formatMs(s.metrics.timing?.rootElapsedMs)}
                          </span>
                          <span>
                            {s.runId && s.historyAvailable ? (
                              <Anchor
                                component={Link}
                                to={paths.run(s.runId, { returnTo })}
                                underline="hover"
                              >
                                Open run
                              </Anchor>
                            ) : (
                              <Text size="sm" c="dimmed">
                                {s.runId ? 'History removed' : 'Not started'}
                              </Text>
                            )}
                          </span>
                        </ListTableRow>
                        {detail && (
                          <ListTableRow colSpan={6}>
                            <div className={styles.sampleDetail}>
                              {observation?.error && (
                                <p
                                  className={`${styles.resultError} ${styles.clamp}`}
                                  title={observation.error}
                                >
                                  {observation.error}
                                </p>
                              )}
                              {!!open?.length && (
                                <ul
                                  className={styles.checkResults}
                                  aria-label={`Checks not passed for ${sampleNames.get(s.id)}`}
                                >
                                  {open.map((c) => (
                                    <li key={c.index} data-status={c.status}>
                                      {c.status === 'fail' ? (
                                        <CircleX size={16} aria-hidden="true" />
                                      ) : (
                                        <CircleHelp
                                          size={16}
                                          aria-hidden="true"
                                        />
                                      )}
                                      <span>
                                        <span className={styles.checkText}>
                                          {c.status === 'fail'
                                            ? 'Failed: '
                                            : 'Unknown: '}
                                          {describeCheck(
                                            c.assertion,
                                            c.expectedOmitted,
                                          )}
                                        </span>
                                        <small>{c.reason}</small>
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </ListTableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </ListTable>
                <Pager
                  label="Sample pages"
                  offset={offset}
                  shown={report.samples.length}
                  total={report.total}
                  limit={sampleLimit}
                  onChange={setOffset}
                />
              </section>
              <section aria-labelledby="comparison-judgments">
                <h2 id="comparison-judgments" className={styles.sectionTitle}>
                  Quality judgments{' '}
                  <span className={styles.count}>{report.judgmentCount}</span>
                </h2>
                {report.judgments.length ? (
                  <ul className={styles.results}>
                    {report.judgments.map((j) => (
                      <li key={j.id} className={styles.result}>
                        <div className={styles.resultHeading}>
                          <h3>
                            {j.score} of 5 · {j.reviewer}
                          </h3>
                          <StatusBadge status={j.reviewerKind} />
                        </div>
                        <p className={styles.meta}>
                          <span>
                            {sampleNames.get(j.sampleId) ??
                              `Sample ${j.sampleId.slice(0, 8)}`}
                          </span>
                          <time dateTime={j.createdAt}>
                            {new Date(j.createdAt).toLocaleString()}
                          </time>
                        </p>
                        <p className={styles.description}>{j.rubric}</p>
                        {j.notes && (
                          <p className={styles.description}>{j.notes}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text size="sm" c="dimmed">
                    No quality judgments yet. Reviewers record them with
                    update_workflow_comparison or the evaluation starter.
                  </Text>
                )}
                <Pager
                  label="Judgment pages"
                  offset={judgmentOffset}
                  shown={report.judgments.length}
                  total={report.judgmentCount}
                  limit={judgmentLimit}
                  onChange={setJudgmentOffset}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ComparisonSkeleton() {
  return (
    <LoadingSkeleton label="Loading comparison report…">
      <Stack gap="lg">
        <Placeholder h={14} w="60%" />
        <Placeholder h={260} radius="md" />
        <Placeholder h={180} radius="md" />
      </Stack>
    </LoadingSkeleton>
  );
}
