import { Badge } from '@mantine/core';
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
} from 'lucide-react';
import { VERSION } from '../../../../core/src/version';
import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import styles from './Sidebar.module.css';
export function Sidebar({
  page,
  attentionCount = 0,
  connected,
  connectionError,
  engineHost,
  onConnect,
}: {
  page:
    | 'workflows'
    | 'runs'
    | 'automations'
    | 'report'
    | 'prompts'
    | 'variables'
    | 'harnesses'
    | 'diagnostics';
  attentionCount?: number;
  connected: boolean;
  connectionError: boolean;
  engineHost?: string;
  onConnect?: () => void;
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        Interlock<span className={styles.version}>v{VERSION}</span>
      </div>
      <div className={styles.group}>WORKSPACE</div>
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
              label: 'Harnesses',
              Icon: Settings2,
              to: paths.harnesses,
            },
          ] as const
        ).map(({ id, label, Icon, to }) => (
          <Link
            key={id}
            className={page === id ? styles.active : ''}
            to={to}
            aria-current={page === id ? 'page' : undefined}
            aria-label={
              id === 'runs' && attentionCount
                ? `Runs, ${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention`
                : label
            }
          >
            <Icon size={16} />
            <span className={styles.navLabel}>{label}</span>
            {id === 'runs' && attentionCount > 0 && (
              <Badge
                className={styles.attentionCount}
                color="yellow"
                variant="light"
                size="sm"
                aria-hidden="true"
              >
                {attentionCount}
              </Badge>
            )}
          </Link>
        ))}
      </nav>
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
