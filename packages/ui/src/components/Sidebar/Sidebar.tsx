import {
  GitBranch,
  Activity,
  ArrowUpRight,
  FileText,
  Settings2,
} from 'lucide-react';
import { VERSION } from '../../../../core/src/version';
import styles from './Sidebar.module.css';
export function Sidebar({
  page,
  onNavigate,
  connected,
  engineHost,
  onConnect,
}: {
  page: 'workflows' | 'runs' | 'prompts' | 'harnesses';
  onNavigate: (page: 'workflows' | 'runs' | 'prompts' | 'harnesses') => void;
  connected: boolean;
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
            { id: 'workflows', label: 'Workflows', Icon: GitBranch },
            { id: 'runs', label: 'Runs', Icon: Activity },
            { id: 'prompts', label: 'Prompts', Icon: FileText },
            { id: 'harnesses', label: 'Harnesses', Icon: Settings2 },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={page === id ? styles.active : ''}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      {onConnect && (
        <div className={styles.note}>
          <button className={styles.connect} onClick={onConnect}>
            Connect with MCP <ArrowUpRight size={12} />
          </button>
        </div>
      )}
      <footer>
        <i className={connected ? styles.online : styles.offline} />
        <div>
          {connected ? 'Local engine connected' : 'Connecting to engine'}
          {engineHost && <small>{engineHost}</small>}
        </div>
      </footer>
    </aside>
  );
}
