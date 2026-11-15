import type { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { harnessLabel } from '../executors/harnessProfiles';
import {
  knownPermissions,
  permissionLabels,
  permissionSourceLabel,
} from '../executors/permissions';
import styles from './ImportWorkflowDialog.module.css';

type DocumentPreview = Awaited<
  ReturnType<typeof api.workflows.previewImport.query>
>;

const languages = { javascript: 'JavaScript', bash: 'Bash' };
type AgentLevel = DocumentPreview['agentPermissions'][number];

/**
 * The level an imported workflow's managed Agents would run with here, worded
 * as in Workflow settings. Unknown until local harnesses and settings load.
 */
function useAgentLevel() {
  const profiles = useQuery(trpc.executors.profiles.queryOptions()).data;
  const settings = useQuery(trpc.executors.settings.queryOptions()).data;
  return (entry: AgentLevel) => {
    if (entry.agentPermissions)
      return `${permissionLabels[entry.agentPermissions]} · set in this workflow`;
    if (entry.harness === null)
      return 'No harness selected · a connected agent uses its own permissions';
    const profile = profiles?.find((p) => p.id === entry.harness);
    const known = profiles && knownPermissions(profile, settings);
    return known
      ? `${permissionLabels[known.permissions]} · ${permissionSourceLabel(known.source, profile && harnessLabel(profile))}`
      : 'Not known yet · the harness level, else the default from AI Settings';
  };
}

/**
 * Every Script an import contains, so a person can read the code before
 * importing, each Git worktree setting with its repository path, and each
 * permission policy with the actions it allows.
 */
function ImportedScripts({
  scripts,
  workspaces,
  policies,
  agents,
}: {
  scripts: {
    workflowName: string;
    label: string;
    language: 'javascript' | 'bash';
    command: string;
  }[];
  workspaces: DocumentPreview['workspaces'];
  policies: DocumentPreview['policies'];
  agents: AgentLevel[];
}) {
  const level = useAgentLevel();
  return (
    <details className={styles.details}>
      <summary>
        {scripts.length
          ? `${scripts.length} Script${scripts.length === 1 ? '' : 's'} to review · imported Scripts wait for approval before their first run`
          : policies.length
            ? 'Permission policy to review · it waits for approval before it applies'
            : workspaces.length
              ? 'Git worktree settings to review'
              : 'Agent permissions to review'}
      </summary>
      {policies.map((policy, index) => (
        <div key={`policy-${index}`}>
          <p>Permission policy · {policy.workflowName}</p>
          <pre tabIndex={0} aria-label="Permission policy">
            {policy.rules.join('\n')}
          </pre>
        </div>
      ))}
      {agents.map((entry, index) => (
        <p key={`agents-${index}`}>
          Agent permissions · {entry.workflowName}: {level(entry)}
        </p>
      ))}
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
    policies?: DocumentPreview['policies'];
    agentPermissions?: DocumentPreview['agentPermissions'];
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
  const policies = item.policies ?? [];
  const agents = item.agentPermissions ?? [];
  const review =
    scripts.length + workspaces.length + policies.length + agents.length > 0;
  if (!included && !filename && !commit && !review) return null;
  return (
    <>
      {review && (
        <ImportedScripts
          scripts={scripts}
          workspaces={workspaces}
          policies={policies}
          agents={agents}
        />
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
