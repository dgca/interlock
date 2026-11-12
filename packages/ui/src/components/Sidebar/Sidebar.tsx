import { Badge, Button } from '../../design-system';

import {
  GitBranch,
  Activity,
  ArrowUpRight,
  FileText,
  Settings2,
  KeyRound,
  Stethoscope,
  BarChart2,
  Zap,
  Columns3,
  RefreshCw,
} from 'lucide-react';
import { VERSION } from '../../../../core/src/version';
import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import styles from './Sidebar.module.css';
export type AttentionFailure = {
  source: 'requests' | 'automations';
  retrying: boolean;
  retry: () => void;
};

export function Sidebar({
  page,
  attentionCount,
  attentionFailures,
  connected,
  connectionError,
  engineHost,
  onConnect,
  compactAt960,
}: {
  page:
    | 'workflows'
    | 'runs'
    | 'boards'
    | 'automations'
    | 'report'
    | 'prompts'
    | 'variables'
    | 'harnesses'
    | 'diagnostics';
  attentionCount?: number;
  attentionFailures: AttentionFailure[];
  connected: boolean;
  connectionError: boolean;
  engineHost?: string;
  onConnect?: () => void;
  compactAt960?: boolean;
}) {
  const failed = attentionFailures.length > 0;
  const badge = failed
    ? attentionCount === undefined
      ? '?'
      : `~${attentionCount}`
    : attentionCount || undefined;
  const runLabel = failed
    ? attentionCount === undefined
      ? 'Runs, attention count unavailable'
      : `Runs, attention count ${attentionCount}, includes stale data`
    : attentionCount === undefined
      ? 'Runs, loading attention count'
      : attentionCount
        ? `Runs, ${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention`
        : 'Runs';
  const retryLabel = `Retry attention count for ${attentionFailures.map(({ source }) => source).join(' and ')}`;
  return (
    <aside className={styles.sidebar} data-compact={compactAt960 || undefined}>
      <div className={styles.brand}>
        <img src="/interlock-logo.svg" width={32} height={32} alt="" />
        Interlock<span className={styles.version}>v{VERSION}</span>
      </div>
      <nav aria-label="Main navigation">
        {(
          [
            {
              id: 'workflows',
              label: 'Workflows',
              Icon: GitBranch,
              to: paths.workflows,
            },
            { id: 'runs', label: 'Runs', Icon: Activity, to: paths.runs() },
            { id: 'boards', label: 'Boards', Icon: Columns3, to: paths.boards },
            {
              id: 'automations',
              label: 'Automations',
              Icon: Zap,
              to: paths.automations,
            },
            {
              id: 'report',
              label: 'Report',
              Icon: BarChart2,
              to: paths.report,
            },
            {
              id: 'prompts',
              label: 'Prompts',
              Icon: FileText,
              to: paths.prompts,
            },
            {
              id: 'variables',
              label: 'Variables',
              Icon: KeyRound,
              to: paths.variables,
            },
            {
              id: 'harnesses',
              label: 'AI Settings',
              Icon: Settings2,
              to: paths.harnesses,
            },
          ] as const
        ).map(({ id, label, Icon, to }) => (
          <Link
            key={id}
            className={page === id ? styles.active : ''}
            to={to}
            title={
              id === 'runs' && failed
                ? runLabel
                : compactAt960
                  ? label
                  : undefined
            }
            aria-current={page === id ? 'page' : undefined}
            aria-label={id === 'runs' ? runLabel : label}
          >
            <Icon size={16} />
            <span className={styles.navLabel}>{label}</span>
            {id === 'runs' && badge !== undefined && (
              <Badge
                className={styles.attentionCount}
                color="yellow"
                variant="light"
                size="sm"
                aria-hidden="true"
              >
                {badge}
              </Badge>
            )}
          </Link>
        ))}
      </nav>
      {failed && (
        <Button
          variant="ghost"
          size="compact-sm"
          className={styles.retryAttention}
          aria-label={retryLabel}
          title={retryLabel}
          loading={attentionFailures.every(({ retrying }) => retrying)}
          onClick={() => {
            for (const failure of attentionFailures)
              if (!failure.retrying) failure.retry();
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          <span className={styles.retryAttentionLabel}>
            Retry attention count
          </span>
        </Button>
      )}
      <div className={styles.utilities}>
        <nav aria-label="Utilities" className={styles.utilityNavigation}>
          <Link
            to={paths.diagnostics}
            className={page === 'diagnostics' ? styles.active : ''}
            aria-current={page === 'diagnostics' ? 'page' : undefined}
            aria-label="Diagnostics"
          >
            <Stethoscope size={16} />
            <span className={styles.navLabel}>Diagnostics</span>
          </Link>
        </nav>
        {onConnect && (
          <button className={styles.connect} onClick={onConnect}>
            Connect with MCP <ArrowUpRight size={12} />
          </button>
        )}
        <footer role="status">
          <i className={connected ? styles.online : styles.offline} />
          <div>
            {connected
              ? 'Local engine connected'
              : connectionError
                ? 'Engine unavailable'
                : 'Connecting to engine'}
            {engineHost && <small>{engineHost}</small>}
          </div>
        </footer>
      </div>
    </aside>
  );
}
