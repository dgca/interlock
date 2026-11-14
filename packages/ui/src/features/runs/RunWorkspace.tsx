import { CopyButton, Button } from '../../design-system';
import styles from './RunInspector.module.css';

const states: Record<string, string> = {
  preparing: 'being created',
  ready: 'in use',
  failed: 'failed',
  removing: 'being removed',
  removed: 'removed',
  retained: 'kept',
};

/** Where this run's managed Git worktree is, and why it was kept or failed. */
export function RunWorkspace({
  workspace,
}: {
  workspace?: { path: string; branch: string; state: string; error?: string };
}) {
  if (!workspace) return null;
  return (
    <details className={styles.tags}>
      <summary>
        Git worktree · {states[workspace.state] ?? workspace.state}
      </summary>
      <p>
        Branch <code>{workspace.branch}</code>
      </p>
      <p>
        <code>{workspace.path}</code>{' '}
        <CopyButton value={workspace.path}>
          {({ copied, copy }) => (
            <Button variant="secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy path'}
            </Button>
          )}
        </CopyButton>
      </p>
      {workspace.error && <p role="status">{workspace.error}</p>}
    </details>
  );
}
