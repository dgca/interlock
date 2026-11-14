import { parseArgs } from 'node:util';
import { runTagsSchema } from '@interlock/core';

export function parseTags(values: string[] | undefined) {
  if (!values) return undefined;
  const entries = values.map((value) => {
    const equals = value.indexOf('=');
    if (equals < 1) throw new Error('Use --tag KEY=VALUE with a nonempty key');
    return [value.slice(0, equals), value.slice(equals + 1)] as const;
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error('Supply each --tag key once');
  return runTagsSchema.parse(Object.fromEntries(entries));
}
export function parseSummaryArgs(args: string[], withBudget = false) {
  const optionArgs: string[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (
      withBudget &&
      [
        '--tag',
        '--budget',
        '--request-id',
        '--external-task',
        '--title',
        '--priority',
        '--after',
        '--on-active-external-task',
        '--version-policy',
        '--hold',
      ].includes(arg)
    ) {
      if (i + 1 < args.length) optionArgs.push(`${arg}=${args[++i]}`);
      else optionArgs.push(arg);
      continue;
    }
    // Negative JSON numbers are positional values, not short options.
    if (
      arg.startsWith('-') &&
      !/^-(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(arg.trim())
    )
      optionArgs.push(arg);
    else positionals.push(arg);
  }
  const { values } = parseArgs({
    args: optionArgs,
    options: {
      summary: { type: 'boolean' },
      ...(withBudget
        ? {
            tag: { type: 'string' as const, multiple: true as const },
            budget: { type: 'string' as const },
            'request-id': { type: 'string' as const },
            'external-task': { type: 'string' as const },
            title: { type: 'string' as const },
            priority: { type: 'string' as const },
            after: { type: 'string' as const },
            'on-active-external-task': { type: 'string' as const },
            'version-policy': { type: 'string' as const },
            hold: { type: 'string' as const },
          }
        : {}),
    },
  });
  return { values, positionals };
}
