import { Boxes, GitBranch, Activity, ArrowUpRight } from 'lucide-react';
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
        <span className={styles.logo}>
          <Boxes size={21} />
        </span>
        interlock<span className={styles.version}>v0.1</span>
      </div>
      <div className={styles.workspace}>
        <span className={styles.avatar}>L</span>
        <div>
          Local workspace<small>Personal</small>
        </div>
      </div>
      <div className={styles.group}>WORKSPACE</div>
      <nav>
        {(
          [
            { id: 'workflows', label: 'Workflows', Icon: GitBranch },
            { id: 'runs', label: 'Run history', Icon: Activity },
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
        <span>Built for your agents.</span>
        <p>
          Define the procedure.
          <br />
          Give judgment a place.
        </p>
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
