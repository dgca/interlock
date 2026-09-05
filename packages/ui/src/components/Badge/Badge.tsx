import styles from './Badge.module.css';
export function Badge({ status }: { status: string }) {
  return (
    <span className={`${styles.badge} ${styles[status] ?? ''}`}>
      <i />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
