import { Badge } from '@mantine/core';
import {
  GitBranch,
  Activity,
  ArrowUpRight,
  FileText,
  Settings2,
  KeyRound,
  Stethoscope,
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
            {
              id: 'diagnostics',
              label: 'Diagnostics',
              Icon: Stethoscope,
              to: paths.diagnostics,
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
