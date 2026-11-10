import {
  Badge,
  Group,
  Stack,
  Text,
  Switch,
  Alert,
  Button,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { useState } from 'react';

import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Stethoscope,
  Info,
} from 'lucide-react';
import type {
  DoctorReport,
  DiagnosticCategory,
  DiagnosticCheck,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';

import { DiagnosticsLoadingContent } from './DiagnosticsSkeleton';
import styles from './Diagnostics.module.css';

const categoryLabels: Record<DiagnosticCategory, string> = {
  system: 'System & Storage',
  harnesses: 'Harness Profiles',
  triggers: 'Active Triggers & Schedules',
  blockers: 'Active Blockers & Stalls',
  workflows: 'Workflow Dependencies',
};

const categoryDescriptions: Record<DiagnosticCategory, string> = {
  system: 'Database integrity, schema version, disk space, and history size',
  harnesses:
    'Local harness binaries, permissions, working directories, and models',
  triggers: 'Schedule lag, consecutive trigger failures, and automatic pauses',
  blockers:
    'Human pauses, uncertain resource holds, work stalls, and model blockers',
  workflows:
    'Missing or disabled variables, model aliases, and unpublished draft diffs',
};

export function Diagnostics() {
  const [liveProbe, setLiveProbe] = useState(false);
  const [liveReport, setLiveReport] = useState<DoctorReport>();
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const query = useQuery({
    ...trpc.system.doctor.queryOptions({ live: false }),
    meta: { engineRefresh: false },
  });
  const report = liveProbe ? liveReport : query.data;
  const loading = liveProbe ? liveLoading : query.isFetching;
  const error = liveProbe
    ? liveError
    : query.error
      ? errorMessage(query.error)
      : '';
  const fetchDiagnostics = async (live: boolean) => {
    if (!live) return query.refetch({ cancelRefetch: false });
    // Live probes may invoke a model. They are explicit actions, never automatic
    // cache revalidation or engine-event work.
    setLiveLoading(true);
    setLiveError('');
    try {
      setLiveReport(await api.system.doctor.query({ live: true }));
    } catch (error) {
      setLiveError(errorMessage(error));
    } finally {
      setLiveLoading(false);
    }
  };

  const categories: DiagnosticCategory[] = [
    'system',
    'harnesses',
    'triggers',
    'blockers',
    'workflows',
  ];

  return (
    <section className={workspacePage.page} aria-busy={loading}>
      <PageHeader
        title="Diagnostics"
        controls={
          <Switch
            label="Live probe"
            checked={liveProbe}
            onChange={(e) => {
              const live = e.currentTarget.checked;
              setLiveProbe(live);
              void fetchDiagnostics(live);
            }}
            disabled={loading}
            size="xs"
            aria-label="Include live harness model verification"
          />
        }
        actions={
          <Button
            leftSection={<RefreshCw size={14} />}
            variant="secondary"
            onClick={() => void fetchDiagnostics(liveProbe)}
            disabled={loading}
          >
            Run checks
          </Button>
        }
      />
      <div className={workspacePage.content}>
        {error && (
          <Alert
            icon={<XCircle size={16} />}
            title="Diagnostics failed"
            color="red"
            mb="lg"
          >
            {error}
          </Alert>
        )}

        {loading && !report ? (
          <DiagnosticsLoadingContent />
        ) : report ? (
          <Stack gap="lg">
            {/* Top Status Banner */}
            <section className={workspacePage.card}>
              <Group justify="space-between" align="center">
                <Group gap="md">
                  <Stethoscope size={24} />
                  <div>
                    <Group gap="xs">
                      <Text fw={600} size="lg">
                        Readiness status
                      </Text>
                      <Badge
                        size="lg"
                        color={
                          report.status === 'ok'
                            ? 'green'
                            : report.status === 'warn'
                              ? 'yellow'
                              : 'red'
                        }
                        variant="light"
                      >
                        {report.status.toUpperCase()}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Last checked:{' '}
                      {new Date(report.checkedAt).toLocaleString()}
                    </Text>
                  </div>
                </Group>

                <Group gap="sm">
                  <Badge color="green" variant="outline">
                    {report.summary.ok} Passed
                  </Badge>
                  {report.summary.warn > 0 && (
                    <Badge color="yellow" variant="outline">
                      {report.summary.warn} Warning
                      {report.summary.warn > 1 ? 's' : ''}
                    </Badge>
                  )}
                  {report.summary.fail > 0 && (
                    <Badge color="red" variant="outline">
                      {report.summary.fail} Failing
                    </Badge>
                  )}
                  <Badge variant="default">
                    {report.summary.total} Total checks
                  </Badge>
                </Group>
              </Group>
            </section>

            {/* Grouped checks */}
            {categories.map((category) => {
              const checks = report.checks.filter(
                (c) => c.category === category,
              );
              if (checks.length === 0) return null;

              const categoryHasFail = checks.some((c) => c.status === 'fail');
              const categoryHasWarn = checks.some((c) => c.status === 'warn');
              const categoryStatus = categoryHasFail
                ? 'fail'
                : categoryHasWarn
                  ? 'warn'
                  : 'ok';

              return (
                <section key={category} className={workspacePage.card}>
                  <div className={styles.categoryHeader}>
                    <Group justify="space-between" align="center">
                      <div>
                        <Text component="h2" fw={600} size="md" m={0}>
                          {categoryLabels[category]}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {categoryDescriptions[category]}
                        </Text>
                      </div>
                      <Badge
                        size="sm"
                        color={
                          categoryStatus === 'ok'
                            ? 'green'
                            : categoryStatus === 'warn'
                              ? 'yellow'
                              : 'red'
                        }
                        variant="dot"
                      >
                        {categoryStatus === 'ok'
                          ? 'Healthy'
                          : categoryStatus === 'warn'
                            ? 'Warnings'
                            : 'Attention required'}
                      </Badge>
                    </Group>
                  </div>

                  <Stack gap="xs" mt="sm">
                    {checks.map((check, idx) => (
                      <CheckItem key={idx} check={check} />
                    ))}
                  </Stack>
                </section>
              );
            })}
          </Stack>
        ) : null}
      </div>
    </section>
  );
}

function CheckItem({ check }: { check: DiagnosticCheck }) {
  const Icon =
    check.status === 'ok'
      ? CheckCircle2
      : check.status === 'warn'
        ? AlertTriangle
        : XCircle;
  const color =
    check.status === 'ok'
      ? 'var(--mantine-color-green-6)'
      : check.status === 'warn'
        ? 'var(--mantine-color-yellow-6)'
        : 'var(--mantine-color-red-6)';

  return (
    <div className={styles.check}>
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <Icon size={18} color={color} className={styles.checkIcon} />
        <div className={styles.checkBody}>
          <Group justify="space-between" align="center">
            <Text size="sm" fw={500}>
              {check.name}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color={
                check.status === 'ok'
                  ? 'green'
                  : check.status === 'warn'
                    ? 'yellow'
                    : 'red'
              }
            >
              {check.status}
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {check.message}
          </Text>

          {check.remediation && check.status !== 'ok' && (
            <Alert
              icon={<Info size={14} />}
              title="Remediation"
              color={check.status === 'fail' ? 'red' : 'yellow'}
              variant="light"
              mt="xs"
              p="xs"
            >
              <Text size="xs">{check.remediation}</Text>
            </Alert>
          )}
        </div>
      </Group>
    </div>
  );
}
