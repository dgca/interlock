import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Switch,
  Alert,
  Loader,
  Paper,
  Button,
} from '@mantine/core';
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
import layout from '../../components/PageLayout/PageLayout.module.css';

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
  triggers: 'Schedule lag, consecutive trigger failures, and webhook outcomes',
  blockers:
    'H3 human pauses, uncertain resource holds, H12 work stalls, and needs_model',
  workflows:
    'Missing or disabled variables, model aliases, and unpublished draft diffs',
};

export function Diagnostics() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveProbe, setLiveProbe] = useState(false);

  const fetchDiagnostics = useCallback(async (live: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.system.doctor.query({ live });
      setReport(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics(liveProbe);
  }, [fetchDiagnostics, liveProbe]);

  const categories: DiagnosticCategory[] = [
    'system',
    'harnesses',
    'triggers',
    'blockers',
    'workflows',
  ];

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div>
          <Title order={1}>Diagnostics</Title>
          <Text c="dimmed" size="sm">
            Read-only health and readiness check across storage, harnesses,
            triggers, blockers, and workflows
          </Text>
        </div>
        <Group gap="sm">
          <Switch
            label="Live Probe"
            checked={liveProbe}
            onChange={(e) => setLiveProbe(e.currentTarget.checked)}
            disabled={loading}
            size="sm"
            aria-label="Include live harness model verification"
          />
          <Button
            leftSection={
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            }
            variant="default"
            size="xs"
            onClick={() => void fetchDiagnostics(liveProbe)}
            disabled={loading}
          >
            Run Checks
          </Button>
        </Group>
      </header>

      {error && (
        <Alert
          icon={<XCircle size={16} />}
          title="Diagnostics Failed"
          color="red"
          mb="lg"
        >
          {error}
        </Alert>
      )}

      {loading && !report ? (
        <Group
          justify="center"
          p="xl"
          role="status"
          aria-label="Running system diagnostics"
        >
          <Loader size="md" />
          <Text size="sm">Running system diagnostics…</Text>
        </Group>
      ) : report ? (
        <Stack gap="lg">
          {/* Top Status Banner */}
          <Paper p="md" radius="md" withBorder>
            <Group justify="space-between" align="center">
              <Group gap="md">
                <Stethoscope size={24} />
                <div>
                  <Group gap="xs">
                    <Text fw={600} size="lg">
                      Readiness Status:
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
                    Last checked: {new Date(report.checkedAt).toLocaleString()}
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
                  {report.summary.total} Total Checks
                </Badge>
              </Group>
            </Group>
          </Paper>

          {/* Grouped Category Cards */}
          {categories.map((category) => {
            const checks = report.checks.filter((c) => c.category === category);
            if (checks.length === 0) return null;

            const categoryHasFail = checks.some((c) => c.status === 'fail');
            const categoryHasWarn = checks.some((c) => c.status === 'warn');
            const categoryStatus = categoryHasFail
              ? 'fail'
              : categoryHasWarn
                ? 'warn'
                : 'ok';

            return (
              <Card key={category} withBorder shadow="xs" radius="md" p="md">
                <Card.Section withBorder inheritPadding py="xs">
                  <Group justify="space-between" align="center">
                    <div>
                      <Text fw={600} size="md">
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
                          : 'Attention Required'}
                    </Badge>
                  </Group>
                </Card.Section>

                <Stack gap="xs" mt="sm">
                  {checks.map((check, idx) => (
                    <CheckItem key={idx} check={check} />
                  ))}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      ) : null}
    </div>
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
    <Paper
      p="xs"
      radius="sm"
      withBorder
      style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}
    >
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <Icon size={18} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
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
    </Paper>
  );
}
