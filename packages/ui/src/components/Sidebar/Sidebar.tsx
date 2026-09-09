import { GitBranch, Activity, ArrowUpRight } from 'lucide-react';
import { VERSION } from '../../../../core/src/version';
import styles from './Sidebar.module.css';
export function Sidebar({
  page,
  onNavigate,
  connected,
  onConnect,
}: {
  page: 'workflows' | 'runs';
  onNavigate: (page: 'workflows' | 'runs') => void;
  connected: boolean;
  onConnect: () => void;
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        Interlock<span className={styles.version}>v{VERSION}</span>
      </div>
      <div className={styles.group}>WORKSPACE</div>
      <nav>
        {(
          [
            { id: 'workflows', label: 'Workflows', Icon: GitBranch },
            { id: 'runs', label: 'Runs', Icon: Activity },
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
      <div className={styles.note}>
        <button className={styles.connect} onClick={onConnect}>
          Connect with MCP <ArrowUpRight size={12} />
        </button>
      </div>
      <footer>
        <i className={connected ? styles.online : styles.offline} />
        <div>
          {connected ? 'Local engine connected' : 'Connecting to engine'}
          <small>127.0.0.1:4310</small>
        </div>
      </footer>
    </aside>
  );
}
