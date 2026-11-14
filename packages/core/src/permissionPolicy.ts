import { z } from 'zod';

/**
 * Programs that run other programs or change how later words are read. A rule
 * naming one would allow anything, so no rule may start with one.
 */
export const unsafeCommandHeads = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'csh',
  'tcsh',
  'env',
  'sudo',
  'doas',
  'su',
  'eval',
  'exec',
  'source',
  '.',
  'command',
  'builtin',
  'xargs',
  'nohup',
  'time',
  'timeout',
  'nice',
  'watch',
  'cd',
  'pushd',
  'popd',
  'export',
  'alias',
  'set',
]);
const patternWord = /^[A-Za-z0-9_@%+=:,./^-]+$/;

/** Problem with a command pattern, or undefined when it is usable. */
export function commandPatternError(pattern: string) {
  const words = pattern.trim().split(/\s+/);
  if (!words[0] || words[0] === '*' || words[0].includes('='))
    return 'Start with a program name';
  if (unsafeCommandHeads.has(words[0].split('/').at(-1)!))
    return `A rule cannot start with ${words[0]}: it can run any command`;
  const bad = words.find(
    (word, index) =>
      !(word === '*' && index === words.length - 1) && !patternWord.test(word),
  );
  return bad
    ? `Use plain words, with * only as the last word, not ${bad}`
    : undefined;
}

const permissionRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read') }).strict(),
  z.object({ kind: z.literal('edit') }).strict(),
  z
    .object({
      kind: z.literal('command'),
      pattern: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .superRefine((pattern, context) => {
          const message = commandPatternError(pattern);
          if (message) context.addIssue({ code: 'custom', message });
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      name: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_.:-]+$/, 'Use the harness tool name'),
    })
    .strict(),
]);
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const permissionPolicySchema = z
  .object({ allow: z.array(permissionRuleSchema).max(200) })
  .strict()
  .describe(
    'Managed Agent actions to allow without asking, inside the run workspace only. Other actions still ask.',
  );
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

/** What a harness asks permission for, described the same way for every harness. */
export type PermissionAction =
  | { kind: 'read'; paths: string[] }
  | { kind: 'edit'; paths: string[] }
  | { kind: 'command'; command: string; cwd: string }
  | { kind: 'tool'; name: string };

/** Approval content for a policy. Its hash keys the approval record. */
export function policyApprovalContent(policy: PermissionPolicy | undefined) {
  return policy?.allow.length
    ? {
        language: 'permission-policy' as const,
        command: JSON.stringify(policy, null, 2),
      }
    : undefined;
}

/** One line per rule, as people read it in previews and approval requests. */
export function describeRule(rule: PermissionRule) {
  if (rule.kind === 'read') return 'Read files in the workspace';
  if (rule.kind === 'edit') return 'Create and edit files in the workspace';
  if (rule.kind === 'command') return `Run: ${rule.pattern}`;
  return `Use tool: ${rule.name}`;
}
