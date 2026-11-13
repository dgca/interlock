import { z } from 'zod';

/** The only template token; it makes every branch name unique to its run. */
const workspaceBranchToken = '{runId}';
const safeBranch =
  /^(?!.*\/\/)(?!.*\.\.)(?!.*\/\.)(?!.*@\{)[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** Branch name for a run. Throws when the template cannot give a safe name. */
export function workspaceBranch(template: string, runId: string) {
  const name = template.split(workspaceBranchToken).join(runId);
  if (
    !template.includes(workspaceBranchToken) ||
    !safeBranch.test(name) ||
    /(?:\.lock|\/|\.)$/.test(name) ||
    name.length > 200
  )
    throw new Error(
      `Branch template must contain ${workspaceBranchToken} and give a branch name of letters, digits, ".", "_", "-" and "/"`,
    );
  return name;
}

const hookSchema = z
  .object({
    // Omitted language runs as Bash, like Script nodes.
    language: z.enum(['javascript', 'bash']).optional(),
    command: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(600000).default(60000),
  })
  .strict();
export const workspaceSettingsSchema = z
  .object({
    repository: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((path) => path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path), {
        message: 'Use an absolute repository path',
      })
      .describe('Absolute path of a local Git repository.'),
    baseRef: z
      .string()
      .trim()
      .min(1)
      .max(250)
      .regex(/^[^-\s][^\s]*$/, 'Use a branch, tag or commit name')
      .default('HEAD')
      .describe('Commit, branch or tag the new branch starts from.'),
    branch: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .default(`interlock/${workspaceBranchToken}`)
      .superRefine((template, context) => {
        try {
          workspaceBranch(template, '00000000-0000-0000-0000-000000000000');
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: (error as Error).message,
          });
        }
      })
      .describe(`New branch name; must contain ${workspaceBranchToken}.`),
    retention: z
      .enum(['remove', 'keep_on_failure', 'keep'])
      .default('remove')
      .describe(
        'When the run tree is quiescent: remove the checkout, keep it if the run failed, or always keep it. The branch is always kept.',
      ),
    hooks: z
      .object({ afterCreate: hookSchema, beforeRemove: hookSchema })
      .partial()
      .strict()
      .optional()
      .describe(
        'Scripts run in the checkout after it is created and before it is removed.',
      ),
  })
  .strict()
  .describe(
    'Give each run its own Git worktree on a new branch. Agent and Script nodes without their own cwd work there.',
  );

/** Stored lifecycle of a run's worktree, keyed by the run that owns it. */
export interface ManagedWorkspace {
  id: string;
  runId: string;
  workflowId: string;
  repository: string;
  path: string;
  branch: string;
  ownerToken: string;
  state:
    | 'preparing'
    | 'ready'
    | 'failed'
    | 'removing'
    | 'removed'
    /** Kept by the retention setting after the run tree became quiescent. */
    | 'retained';
  /** Set before `git worktree add -b`; the branch is then Interlock's own. */
  branchClaimed?: boolean;
  baseCommit?: string;
  error?: string;
  /** The owning run has been failed for this preparation error. */
  reported?: boolean;
  createdAt: string;
  updatedAt: string;
}
