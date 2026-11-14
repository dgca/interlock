import type { api } from '../../lib/api';
import styles from './ImportWorkflowDialog.module.css';

type DocumentPreview = Awaited<
  ReturnType<typeof api.workflows.previewImport.query>
>;

const languages = { javascript: 'JavaScript', bash: 'Bash' };

/**
 * Every Script an import contains, so a person can read the code before
 * importing, and each Git worktree setting with its repository path.
 */
function ImportedScripts({
  scripts,
  workspaces,
}: {
  scripts: {
    workflowName: string;
    label: string;
    language: 'javascript' | 'bash';
    command: string;
  }[];
  workspaces: DocumentPreview['workspaces'];
}) {
  return (
    <details className={styles.details}>
      <summary>
        {scripts.length
          ? `${scripts.length} Script${scripts.length === 1 ? '' : 's'} to review · imported Scripts wait for approval before their first run`
          : 'Git worktree settings to review'}
      </summary>
      {workspaces.map((workspace, index) => (
        <div key={`workspace-${index}`}>
          <p>Git worktree · {workspace.workflowName}</p>
          <pre tabIndex={0} aria-label="Git worktree setting">
            {`repository: ${workspace.repository}\nstart from: ${workspace.baseRef}\nbranch: ${workspace.branch}`}
          </pre>
        </div>
      ))}
      {scripts.map((script, index) => (
        <div key={index}>
          <p>
            {script.label} · {script.workflowName} ·{' '}
            {languages[script.language]}
          </p>
          <pre tabIndex={0} aria-label={`${script.label} code`}>
            {script.command}
          </pre>
        </div>
      ))}
    </details>
  );
}

/** Included workflows, prompts, Scripts and source of one import. */
export function Details({
  item,
  filename,
  commit,
}: {
  item: Pick<DocumentPreview, 'workflows' | 'prompts'> & {
    scripts?: DocumentPreview['scripts'];
    workspaces?: DocumentPreview['workspaces'];
  };
  filename?: string;
  commit?: string;
}) {
  const included = [
    item.workflows.length
      ? `${item.workflows.length} included workflow${item.workflows.length === 1 ? '' : 's'}`
      : '',
    item.prompts.length
      ? `${item.prompts.length} saved prompt${item.prompts.length === 1 ? '' : 's'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const scripts = item.scripts ?? [];
  const workspaces = item.workspaces ?? [];
  if (
    !included &&
    !filename &&
    !commit &&
    !scripts.length &&
    !workspaces.length
  )
    return null;
  return (
    <>
      {(scripts.length > 0 || workspaces.length > 0) && (
        <ImportedScripts scripts={scripts} workspaces={workspaces} />
      )}
      {(included || filename || commit) && (
        <details className={styles.details}>
          <summary>{included || 'File details'}</summary>
          {item.workflows.map((w) => (
            <p key={w.id}>
              {w.name}
              {w.owned ? ' · owned child' : ''}
              <code>{w.id}</code>
            </p>
          ))}
          {item.prompts.map((p) => (
            <p key={p.id}>
              {p.name}
              <code>{p.id}</code>
            </p>
          ))}
          {filename && <p>{filename}</p>}
          {commit && (
            <p>
              Source revision <code>{commit}</code>
            </p>
          )}
        </details>
      )}
    </>
  );
}
