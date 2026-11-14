import { NativeSelect, Stack, Switch, TextInput } from '../../design-system';
import type { WorkflowDefinition } from '@interlock/core';
import { ScriptCode } from './ScriptCode';

type Workspace = NonNullable<WorkflowDefinition['workspace']>;
const hooks = [
  ['afterCreate', 'After create', 'Run a command after creating the worktree'],
  [
    'beforeRemove',
    'Before remove',
    'Run a command before removing the worktree',
  ],
] as const;

/** The workflow's managed Git worktree setting. */
export function WorkspaceSettings({
  value,
  onChange,
}: {
  value?: Workspace;
  onChange: (workspace: Workspace | undefined) => void;
}) {
  const patch = (next: Partial<Workspace>) =>
    value && onChange({ ...value, ...next });
  return (
    <Stack gap="sm" mb="md">
      <Switch
        label="Give each run its own Git worktree"
        description="Agent and Script nodes without their own working directory run in a new worktree on a new branch. Batch items, Parallel branches and invoked workflows without this setting share it."
        checked={Boolean(value)}
        onChange={(event) =>
          onChange(
            event.currentTarget.checked
              ? {
                  repository: '',
                  baseRef: 'HEAD',
                  branch: 'interlock/{runId}',
                  retention: 'remove',
                }
              : undefined,
          )
        }
      />
      {value && (
        <>
          <TextInput
            label="Repository"
            description="Absolute path of the repository root."
            required
            pattern="(/|[A-Za-z]:[\\/]).*"
            value={value.repository}
            onChange={(e) => patch({ repository: e.target.value })}
          />
          <TextInput
            label="Start from"
            description="Branch, tag or commit for the new branch."
            required
            value={value.baseRef}
            onChange={(e) => patch({ baseRef: e.target.value })}
          />
          <TextInput
            label="Branch name"
            description="Must contain {runId}. Interlock only creates new branches and keeps them after removing the worktree."
            required
            pattern=".*\{runId\}.*"
            value={value.branch}
            onChange={(e) => patch({ branch: e.target.value })}
          />
          <NativeSelect
            label="When the run tree finishes"
            description="A worktree with uncommitted or untracked changes is always kept. Commits stay on the branch, which is never deleted."
            value={value.retention}
            data={[
              { value: 'remove', label: 'Remove the worktree' },
              { value: 'keep_on_failure', label: 'Keep it if the run failed' },
              { value: 'keep', label: 'Keep the worktree' },
            ]}
            onChange={(e) =>
              patch({
                retention: e.currentTarget.value as Workspace['retention'],
              })
            }
          />
          {hooks.map(([name, title, label]) => {
            const hook = value.hooks?.[name];
            return (
              <div key={name}>
                <Switch
                  label={label}
                  mb={hook ? 'sm' : undefined}
                  checked={Boolean(hook)}
                  onChange={(event) =>
                    patch({
                      hooks: {
                        ...value.hooks,
                        [name]: event.currentTarget.checked
                          ? {
                              language: 'bash',
                              command: '# Runs in the worktree\n',
                              timeoutMs: 60000,
                            }
                          : undefined,
                      },
                    })
                  }
                />
                {hook && (
                  <ScriptCode
                    title={title}
                    value={hook}
                    onChange={(code) =>
                      patch({
                        hooks: { ...value.hooks, [name]: { ...hook, ...code } },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </>
      )}
    </Stack>
  );
}
