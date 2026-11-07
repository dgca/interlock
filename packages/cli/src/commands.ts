import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, TRPCClientError } from '@interlock/client';
import { parseArgs } from 'node:util';
import {
  externalInputRequestSchema,
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
    if (
      withBudget &&
      [
        '--budget',
        '--request-id',
        '--external-task',
        '--priority',
        '--after',
        '--on-active-external-task',
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
            budget: { type: 'string' as const },
            'request-id': { type: 'string' as const },
            'external-task': { type: 'string' as const },
            priority: { type: 'string' as const },
            after: { type: 'string' as const },
            'on-active-external-task': { type: 'string' as const },
          }
        : {}),
    },
  });
  return { values, positionals };
}
export async function runCommand(argv: string[]) {
  const client = createClient(process.env.INTERLOCK_URL);
  const [command, ...args] = argv;
  switch (command) {
    case 'triggers':
    case 'schedules': {
      if (args.length !== 2 || !['read', 'manage'].includes(args[0]))
        throw new Error(
          'Usage: triggers <read|manage> <json|@file> (read action:list|inspect|preview|attention; manage action:create|update|enable|disable|delete)',
        );
      const request = await parse(args[1]);
      return args[0] === 'read'
        ? client.triggers.read.query(request)
        : client.triggers.manage.mutate(request);
    }
    case 'variables': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { 'value-stdin': { type: 'boolean' } },
      });
      if (
        positionals.length !== 2 ||
        !['read', 'manage'].includes(positionals[0])
      )
        throw new Error(
          'Usage: variables <read|manage> <json|@file> [--value-stdin]. Secret values must use stdin.',
        );
      const request = await parse(positionals[1]);
      if (positionals[0] === 'read') {
        if (values['value-stdin'])
          throw new Error('--value-stdin requires manage');
        return client.variables.read.query(request);
      }
      if (Object.hasOwn(request, 'value'))
        throw new Error(
          'Supply variable values through --value-stdin, never command-line JSON.',
        );
      if (values['value-stdin']) {
        if (!['create', 'update'].includes(request.action))
          throw new Error('--value-stdin requires create or update');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of process.stdin) {
          const data = Buffer.from(chunk);
          if ((size += data.length) > 16 * 1024)
            throw new Error('Variable value must be at most 16 KiB');
          chunks.push(data);
        }
        request.value = Buffer.concat(chunks).toString('utf8');
      }
      return client.variables.manage.mutate(request);
    }
    case 'run-history': {
      if (args.length !== 1)
        throw new Error(
          'Usage: run-history <json|@file> (action: preview or delete; deletion requires reviewed root confirmations and acknowledgeHistoryLoss:true)',
        );
      const { historyRequestSchema } = await import('@interlock/core');
      const request = historyRequestSchema.parse({
        request: await parse(args[0]),
      }).request;
      if (request.action === 'preview') {
        const { action: _action, ...input } = request;
        return client.runs.previewHistoryDeletion.query(input);
      }
      const { action: _action, ...input } = request;
      return client.runs.deleteHistory.mutate(input);
    }
    case 'stalls':
      return client.stalls.manage.mutate(
        args.length ? await parse(args[0]) : { action: 'settings' },
      );
    case 'executors':
      return client.executors.manage.mutate(
        args.length ? await parse(args[0]) : { action: 'list' },
      );
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
    case 'starters':
      return client.workflows.starters.query();
    case 'import-starter': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          copy: { type: 'boolean' },
          'request-id': { type: 'string' },
        },
      });
      if (positionals.length !== 1)
        throw new Error(
          'Usage: import-starter <starter-id> [--copy] [--request-id key]',
        );
      return client.workflows.importStarter.mutate({
        starterId: positionals[0],
        copy: values.copy,
        requestId: values['request-id'] ?? randomUUID(),
      });
    }
    case 'import': {
      const input = await parse(args[0]);
      if (input.format === 'interlock-workflows') {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            force: { type: 'boolean' },
            revisions: { type: 'string' },
            'restore-deleted-versions': { type: 'boolean' },
            'variable-bindings': { type: 'string' },
            'dry-run': { type: 'boolean' },
            publish: { type: 'boolean' },
            cascade: { type: 'boolean' },
          },
        });
        return client.workflows.import.mutate({
          bundle: input,
          force: values.force,
          variableBindings: values['variable-bindings']
            ? await parse(values['variable-bindings'])
            : undefined,
          restoreDeletedVersions: values['restore-deleted-versions'],
          draftRevisions: values.revisions
            ? await parse(values.revisions)
            : undefined,
          dryRun: values['dry-run'],
          publish: values.publish,
          cascade: values.cascade,
        });
      }
      if (args.length !== 1)
        throw new Error('Import options require a workflow bundle');
      const { assertLegacyVariableFree } =
        await import('../../core/src/importDocument.js');
      assertLegacyVariableFree(input);
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
          'Usage: start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file] [--request-id key] [--external-task json|@file] [--priority N] [--after json|@file] [--on-active-external-task allow|reuse|reject|cancel_previous]',
        );
      const input = {
        priority:
          typeof values.priority === 'string'
            ? Number(values.priority)
            : undefined,
        after:
          typeof values.after === 'string'
            ? await parse(values.after)
            : undefined,
        onActiveExternalTask:
          typeof values['on-active-external-task'] === 'string'
            ? (values['on-active-external-task'] as
                'allow' | 'reuse' | 'reject' | 'cancel_previous')
            : undefined,
        requestId:
          typeof values['request-id'] === 'string'
            ? values['request-id']
            : undefined,
        externalTask:
          typeof values['external-task'] === 'string'
            ? await parse(values['external-task'])
            : undefined,
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
          'request-id': { type: 'string' },
          'external-task': { type: 'string' },
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
          requestId:
            typeof values['request-id'] === 'string'
              ? values['request-id']
              : undefined,
          externalTask:
            typeof values['external-task'] === 'string'
              ? await parse(values['external-task'])
              : undefined,
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
    case 'external-input': {
      if (args.length !== 1)
        throw new Error('Usage: external-input <json|@file>');
      const request = externalInputRequestSchema.parse(await parse(args[0]));
      return request.action === 'status'
        ? client.runs.externalInputStatus.query(request)
        : client.runs.externalInput.mutate(request);
    }
    case 'pause':
      if (args.length !== 1)
        throw new Error(
          'Usage: pause <json|@file> (target:{scope:library|workflow,workflowId?}, actor, reason)',
        );
      return client.pauses.pause.mutate(await parse(args[0]));
    case 'resume':
      if (args.length !== 1) throw new Error('Usage: resume <exact-hold-id>');
      return client.pauses.resume.mutate({ id: args[0] });
    case 'pause-holds':
      if (args.length > 1)
        throw new Error(
          'Usage: pause-holds [options-json|@file] (workflowId?, offset?, limit?)',
        );
      return client.pauses.list.query(args[0] ? await parse(args[0]) : {});
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
    case 'work-resources':
      return client.work.resources.mutate(await parse(args[0]));
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
    case 'script':
      return client.runs.script.mutate(await parse(args[0]));
    case 'retry':
      return client.runs.retry.mutate({ id: args[0] });
    default:
      return {
        usage: [
          'triggers <read|manage> <json|@file> (schedule/webhook configuration, paged fires/deliveries and attention; mutations use expectedRevision; create/import disabled; schedules alias retained)',
          'variables <read|manage> <json|@file> [--value-stdin] (metadata list/inspect, explicit config_value; write-only Secret creation/replacement through stdin)',
          'stalls [json|@file] (settings by default; configure with expectedRevision/policy, inspect with runId/offset/limit)',
          'executors [json|@file] (list by default; settings/save_settings for shared concurrency, save local profiles with optional concurrency, discover models/efforts, inspect work, respond, retry_model after a model refusal, stop or reconcile an interrupted execution)',
          'workflows [scope-json: {"ownerWorkflowId":null|"parent-id"}]',
          'workflow <id>',
          'update <workflow-id> <json|@file> (metadata or draft replacement; layout:"tidy" arranges with Dagre; draft/layout changes require draftRevision)',
          'edit <workflow-id> <json|@file> (draftRevision and edits required; optional layout:"tidy"; atomic stable-ID edits)',
          'archive <id>',
          'restore <id>',
          'delete <id> --yes',
          'import <json|@file> [--force | --revisions JSON] [--restore-deleted-versions] [--variable-bindings json|@file] [--dry-run] [--publish] [--cascade] (format 4 requires explicit local variable bindings/provisioning; force changes drafts only; restoration requires original definitions; dry-run previews semantic diff; publish/cascade publishes atomically)',
          'starters (list bundled choices and existing copies)',
          'import-starter <starter-id> [--copy] [--request-id key] (explicit published copy; never starts a run)',
          'export <id>',
          'publish <id> [--cascade]',
          'work-resources <json|@file> (inspect by workId or runId+executionId; release exact uncertain attempt after stop confirmation)',
          'start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file] [--request-id key] [--external-task json|@file] [--priority N] [--after json|@file] [--on-active-external-task allow|reuse|reject|cancel_previous]',
          'runs [--request-id KEY] [--external-task json|@file] [--workflow ID] [--chain ROOT_RUN_ID] [--status STATUS] [--root-only] [--limit N] [--input-path PATH --equals JSON] (no flags preserves the full history dump)',
          'run <id>',
          'run-history <json|@file> (action: preview with workflowId/before/rootRunIds and offset/limit; delete requires roots with preview confirmations and acknowledgeHistoryLoss:true; workflows and published versions remain)',
          'context-group <run-id> <group> [options-json|@file] (binding and history; offset, limit)',
          'handoff-context <json|@file> (runId, group, expectedRevision, session, actor, reason, checkpointRef)',
          'budget <run-id> (local revision/policy and governing budget status)',
          'set-budget <json|@file> (runId, expectedRevision, budget; null disables local policy)',
          'usage <run-id> [options-json|@file: {"includeDescendants":true,"includeChain":true,"groupBy":"attempt","includeReports":true,"limit":20,"offset":0}]',
          'report-usage <json|@file: {"workId":"...","attempt":1,"token":"...","snapshot":{"sequence":1,"final":true,"models":[{"provider":"...","model":"...","inputTokens":100,"outputTokens":20}]}}] (executor is default and requires token; source:observer omits token and requires an ended attempt; runId with source:observer reports run-level usage outside attempts; observer takes precedence in totals and budgets; cumulative per source/stream, missing values remain unknown)',
          'simulation <json|@file> (action: run/get/list/capture/cancel; fixture-only, no external effects)',
          'test-suite <json|@file> (action: create/update/get/list; saved cases with optional simulation fixtures)',
          'assignment-size <json|@file> (workId, or workflowId/nodeId with sample; optional warningBytes)',
          'work [run-id] [--summary]',
          'claim <work-id> [worker-id] [options-json: {"leaseSeconds":1800,"freshContext":false,"tools":[],"skills":[]}] [--fresh] [--lease seconds] (flags override options JSON; --fresh attests an isolated context; grouped work also requires session: {executorId,sessionId} in options; optional modelSelection: {tier,provider,model} declares a selection, not usage)',
          'external-input <json|@file> (action: status, submit, accept, hold or release)',
          'pause <json|@file> (create independent library/workflow hold with target, actor, reason)',
          'pause-holds [options-json|@file] (applicable records; workflowId?, offset?, limit?)',
          'resume <exact-hold-id> (release only one record; other holds remain)',
          'work-hold <json|@file> (action: hold, resume or read-only history; hold/resume require current attempt/revision)',
          'preflight <work-id> <token> <json|@file> (read-only result contract/rules, result routing/output mappings and claim check)',
          'submit <work-id> <token> <json|@file> [--summary]',
          'fail <work-id> <token> <error>',
          'renew <work-id> <token> [options-json: {"leaseSeconds":3600}]',
          'script <json|@file> (action: inspect/stop/reconcile; exact runId and executionId; reconciliation requires stopped:true and reason)',
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
