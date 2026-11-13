import type { api } from '../../lib/api';
import styles from './ImportWorkflowDialog.module.css';

type DocumentPreview = Awaited<
  ReturnType<typeof api.workflows.previewImport.query>
>;

const languages = { javascript: 'JavaScript', bash: 'Bash' };

/** Every Script an import contains, so a person can read the code before importing. */
function ImportedScripts({
  scripts,
}: {
  scripts: {
    workflowName: string;
    label: string;
    language: 'javascript' | 'bash';
    command: string;
  }[];
}) {
  return (
    <details className={styles.details}>
      <summary>
        {scripts.length} Script{scripts.length === 1 ? '' : 's'} to review ·
        imported Scripts wait for approval before their first run
      </summary>
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
  if (!included && !filename && !commit && !scripts.length) return null;
  return (
    <>
      {scripts.length > 0 && <ImportedScripts scripts={scripts} />}
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
