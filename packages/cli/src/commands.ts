import { readFile } from 'node:fs/promises';
import { createClient, TRPCClientError } from '@interlock/client';
import { parseArgs } from 'node:util';
import {
  withNextCall,
  testSuiteSaveSchema,
  testSuiteReadSchema,
} from '@interlock/core';
const parse = async (value: string | undefined) => {
  if (value === undefined) throw new Error('Missing JSON argument');
  return JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
};
function parseSummaryArgs(args: string[], withBudget = false) {
  const optionArgs: string[] = [];
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (withBudget && arg === '--budget') {
      optionArgs.push(arg);
      if (i + 1 < args.length) optionArgs.push(args[++i]);
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
      ...(withBudget ? { budget: { type: 'string' as const } } : {}),
    },
  });
  return { values, positionals };
}
export async function runCommand(argv: string[]) {
  const client = createClient(process.env.INTERLOCK_URL);
  const [command, ...args] = argv;
  switch (command) {
    case 'simulation':
      if (args.length !== 1) throw new Error('Usage: simulation <json|@file>');
      return client.testbench.simulation.mutate(await parse(args[0]));
    case 'test-suite': {
      if (args.length !== 1) throw new Error('Usage: test-suite <json|@file>');
      const request = await parse(args[0]);
      if (request.action === 'create' || request.action === 'update') {
        const q = testSuiteSaveSchema.parse({ request }).request;
        return q.action === 'create'
          ? client.testbench.createSuite.mutate({
              workflowId: q.workflowId,
              content: q.content,
            })
          : client.testbench.updateSuite.mutate({
              id: q.id,
              revision: q.revision,
              content: q.content,
            });
      }
      const q = testSuiteReadSchema.parse({ request }).request;
      return q.action === 'get'
        ? client.testbench.suite.query({ id: q.id })
        : client.testbench.suites.query({
            workflowId: q.workflowId,
            limit: q.limit,
          });
    }
    case 'workflows':
      return client.workflows.list.query(
        args[0] ? await parse(args[0]) : undefined,
      );
    case 'workflow':
      return client.workflows.get.query({ id: args[0] });
    case 'update':
      if (args.length !== 2)
        throw new Error('Usage: update <workflow-id> <json|@file>');
      return client.workflows.update.mutate({
        ...(await parse(args[1])),
        id: args[0],
      });
    case 'edit':
      if (args.length !== 2)
        throw new Error('Usage: edit <workflow-id> <json|@file>');
      return client.workflows.edit.mutate({
        ...(await parse(args[1])),
        id: args[0],
      });
    case 'archive':
      return client.workflows.update.mutate({ id: args[0], archived: true });
    case 'restore':
      return client.workflows.update.mutate({ id: args[0], archived: false });
    case 'delete':
      if (args.length !== 2 || args[1] !== '--yes')
        throw new Error(
          'Usage: delete <id> --yes. Permanently removes the workflow, its history and local test suites/comparisons/simulations. Managed trial cleanup must finish first; retained trial files are not deleted. Use archive to preserve history.',
        );
      return client.workflows.delete.mutate({ id: args[0] });
    case 'import': {
      const input = await parse(args[0]);
      if (input.format === 'interlock-workflows') {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            force: { type: 'boolean' },
            revisions: { type: 'string' },
            'restore-deleted-versions': { type: 'boolean' },
          },
        });
        return client.workflows.import.mutate({
          bundle: input,
          force: values.force,
          restoreDeletedVersions: values['restore-deleted-versions'],
          draftRevisions: values.revisions
            ? await parse(values.revisions)
            : undefined,
        });
      }
      if (args.length !== 1)
        throw new Error('Import options require a workflow bundle');
      return client.workflows.create.mutate(input);
    }
    case 'export':
      return client.workflows.export.query({ id: args[0] });
    case 'publish':
      if (!args[0] || args.slice(1).some((arg) => arg !== '--cascade'))
        throw new Error('Usage: publish <id> [--cascade]');
      return client.workflows.publish.mutate({
        id: args[0],
        cascade: args.includes('--cascade'),
      });
    case 'start': {
      const { values, positionals } = parseSummaryArgs(args, true);
      if (positionals.length < 2 || positionals.length > 3)
        throw new Error(
          'Usage: start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file]',
        );
      const input = {
        budget:
          typeof values.budget === 'string'
            ? await parse(values.budget)
            : undefined,
        workflowId: positionals[0],
        input: await parse(positionals[1]),
        version:
          positionals[2] === undefined ? undefined : Number(positionals[2]),
      };
      return values.summary
        ? withNextCall(await client.runs.startSummary.mutate(input))
        : client.runs.start.mutate(input);
    }
    case 'runs': {
      if (!args.length) return client.runs.list.query();
      const { values } = parseArgs({
        args,
        options: {
          workflow: { type: 'string' },
          status: { type: 'string' },
          'root-only': { type: 'boolean' },
          chain: { type: 'string' },
          limit: { type: 'string' },
          'input-path': { type: 'string' },
          equals: { type: 'string' },
        },
      });
      if (
        (values['input-path'] === undefined) !==
        (values.equals === undefined)
      )
        throw new Error('--input-path and --equals must be supplied together');
      const { runQuerySchema } = await import('@interlock/core');
      return client.runs.find.query(
        runQuerySchema.parse({
          workflowId: values.workflow,
          chainRootRunId: values.chain,
          status: values.status,
          rootOnly: values['root-only'],
          limit: values.limit === undefined ? undefined : Number(values.limit),
          inputMatch:
            values['input-path'] === undefined
              ? undefined
              : {
                  path: values['input-path'],
                  equals: await parse(values.equals),
                },
        }),
      );
    }
    case 'run':
      return client.runs.get.query({ id: args[0] });
    case 'context-group':
      if (args.length < 2 || args.length > 3)
        throw new Error(
          'Usage: context-group <run-id> <group> [options-json|@file]',
        );
      return client.runs.contextGroup.query({
        ...(args[2] ? await parse(args[2]) : {}),
        runId: args[0],
        group: args[1],
      });
    case 'handoff-context':
      if (args.length !== 1)
        throw new Error('Usage: handoff-context <json|@file>');
      return client.runs.handoffContext.mutate(await parse(args[0]));
    case 'budget':
      if (args.length !== 1) throw new Error('Usage: budget <run-id>');
      return client.runs.budget.query({ runId: args[0] });
    case 'set-budget':
      if (args.length !== 1) throw new Error('Usage: set-budget <json|@file>');
      return client.runs.setBudget.mutate(await parse(args[0]));
    case 'usage': {
      if (!args[0])
        throw new Error('Usage: usage <run-id> [options-json|@file]');
      return client.runs.usage.query({
        ...(args[1] ? await parse(args[1]) : {}),
        runId: args[0],
      });
    }
    case 'report-usage':
      if (args.length !== 1)
        throw new Error('Usage: report-usage <json|@file>');
      return client.work.reportUsage.mutate(await parse(args[0]));
    case 'assignment-size':
      if (args.length !== 1)
        throw new Error('Usage: assignment-size <json|@file>');
      return client.work.size.query(await parse(args[0]));
    case 'work-hold':
      if (args.length !== 1) throw new Error('Usage: work-hold <json|@file>');
      return client.work.hold.mutate(await parse(args[0]));
    case 'work':
      return args.includes('--summary')
        ? client.work.summaries.query({
            runId: args.find((arg) => arg !== '--summary'),
          })
        : client.work.list.query({ runId: args[0] });
    case 'claim': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { fresh: { type: 'boolean' }, lease: { type: 'string' } },
      });
      if (positionals.length < 1 || positionals.length > 3)
        throw new Error(
          'Usage: claim <work-id> [worker-id] [options-json|@file] [--fresh] [--lease seconds]',
        );
      return client.work.claim.mutate({
        workId: positionals[0],
        workerId: positionals[1] ?? 'cli',
        ...(positionals[2] ? await parse(positionals[2]) : {}),
        ...(values.fresh === undefined ? {} : { freshContext: values.fresh }),
        ...(values.lease === undefined
          ? {}
          : { leaseSeconds: Number(values.lease) }),
      });
    }
    case 'preflight':
      if (args.length !== 3)
        throw new Error('Usage: preflight <work-id> <token> <json|@file>');
      return client.work.preflight.query({
        workId: args[0],
        token: args[1],
        output: await parse(args[2]),
      });
    case 'submit': {
      const { values, positionals } = parseSummaryArgs(args);
      if (positionals.length !== 3)
        throw new Error(
          'Usage: submit <work-id> <token> <json|@file> [--summary]',
        );
      const input = {
        workId: positionals[0],
        token: positionals[1],
        output: await parse(positionals[2]),
      };
      return values.summary
        ? withNextCall(await client.work.submitSummary.mutate(input))
        : client.work.submit.mutate(input);
    }
    case 'fail':
      return client.work.fail.mutate({
        workId: args[0],
        token: args[1],
        error: args[2],
      });
    case 'renew':
      return client.work.renew.mutate({
        ...(args[2] ? await parse(args[2]) : {}),
        workId: args[0],
        token: args[1],
      });
    case 'cancel': {
      if (
        args.length < 1 ||
        args.length > 2 ||
        (args[1] !== undefined && args[1] !== '--chain')
      )
        throw new Error('Usage: cancel <run-id> [--chain]');
      return client.runs.cancel.mutate({
        id: args[0],
        scope: args[1] === '--chain' ? 'chain' : 'run',
      });
    }
    case 'retry':
      return client.runs.retry.mutate({ id: args[0] });
    default:
      return {
        usage: [
          'workflows [scope-json: {"ownerWorkflowId":null|"parent-id"}]',
          'workflow <id>',
          'update <workflow-id> <json|@file> (metadata or draft replacement; layout:"tidy" arranges with Dagre; draft/layout changes require draftRevision)',
          'edit <workflow-id> <json|@file> (draftRevision and edits required; optional layout:"tidy"; atomic stable-ID edits)',
          'archive <id>',
          'restore <id>',
          'delete <id> --yes',
          'import <json|@file> [--force | --revisions JSON] [--restore-deleted-versions] (force changes drafts only; explicit restoration requires original definitions and valid dependencies/ownership)',
          'export <id>',
          'publish <id> [--cascade]',
          'start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file]',
          'runs [--workflow ID] [--chain ROOT_RUN_ID] [--status STATUS] [--root-only] [--limit N] [--input-path PATH --equals JSON] (no flags preserves the full history dump)',
          'run <id>',
          'context-group <run-id> <group> [options-json|@file] (binding and history; offset, limit)',
          'handoff-context <json|@file> (runId, group, expectedRevision, session, actor, reason, checkpointRef)',
          'budget <run-id> (local revision/policy and governing budget status)',
          'set-budget <json|@file> (runId, expectedRevision, budget; null disables local policy)',
          'usage <run-id> [options-json|@file: {"includeDescendants":true,"includeChain":true,"groupBy":"attempt","includeReports":true,"limit":20,"offset":0}]',
          'report-usage <json|@file: {"workId":"...","attempt":1,"token":"...","snapshot":{"sequence":1,"final":true,"models":[{"provider":"...","model":"...","inputTokens":100,"outputTokens":20}]}}] (executor is default and requires token; source:observer omits token and requires an ended attempt; observer takes precedence in totals and budgets; cumulative per source, missing values remain unknown)',
          'simulation <json|@file> (action: run/get/list/capture/cancel; fixture-only, no external effects)',
          'test-suite <json|@file> (action: create/update/get/list; saved cases with optional simulation fixtures)',
          'assignment-size <json|@file> (workId, or workflowId/nodeId with sample; optional warningBytes)',
          'work [run-id] [--summary]',
          'claim <work-id> [worker-id] [options-json: {"leaseSeconds":1800,"freshContext":false,"tools":[],"skills":[]}] [--fresh] [--lease seconds] (flags override options JSON; --fresh attests an isolated context; grouped work also requires session: {executorId,sessionId} in options; optional modelSelection: {tier,provider,model} declares a selection, not usage)',
          'work-hold <json|@file> (action: hold, resume or read-only history; hold/resume require current attempt/revision)',
          'preflight <work-id> <token> <json|@file> (read-only result contract/rules, result routing/output mappings and claim check)',
          'submit <work-id> <token> <json|@file> [--summary]',
          'fail <work-id> <token> <error>',
          'renew <work-id> <token> [options-json: {"leaseSeconds":3600}]',
          'cancel <run-id> [--chain] (stop the latest successor from any chain member; detached descendants remain independent)',
          'retry <run-id>',
        ],
      };
  }
}

export function commandError(error: unknown) {
  return error instanceof TRPCClientError && error.data?.resultCheck
    ? JSON.stringify(
        { message: error.message, resultCheck: error.data.resultCheck },
        null,
        2,
      )
    : error instanceof Error
      ? error.message
      : String(error);
}
