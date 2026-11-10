import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, TRPCClientError } from '@interlock/client';
import { parseArgs } from 'node:util';
import {
  externalInputRequestSchema,
  withNextCall,
  testSuiteSaveSchema,
  testSuiteReadSchema,
  runVersionReadSchema,
  setRunVersionPolicySchema,
  runVersionPreviewSchema,
  runVersionApplySchema,
  runVersionPolicySchema,
  runTagsSchema,
  type DoctorReport,
  type DiagnosticCategory,
  type WorkflowReport,
  type ReportFilter,
} from '@interlock/core';
const parse = async (value: string | undefined) => {
  if (value === undefined) throw new Error('Missing JSON argument');
  return JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
};
function parseTags(values: string[] | undefined) {
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
        '--tag',
        '--budget',
        '--request-id',
        '--external-task',
        '--priority',
        '--after',
        '--on-active-external-task',
        '--version-policy',
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
            priority: { type: 'string' as const },
            after: { type: 'string' as const },
            'on-active-external-task': { type: 'string' as const },
            'version-policy': { type: 'string' as const },
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
          'Usage: run-history <json|@file> (action: preview, delete, settings, configure or status; deletion requires reviewed root confirmations and acknowledgeHistoryLoss:true)',
        );
      const { historyRequestSchema } = await import('@interlock/core');
      const request = historyRequestSchema.parse({
        request: await parse(args[0]),
      }).request;
      if (request.action === 'status')
        return client.runs.retentionStatus.query();
      if (request.action === 'settings') {
        const { action: _action, ...input } = request;
        return client.runs.retentionSettings.query(input);
      }
      if (request.action === 'configure') {
        const { action: _action, ...input } = request;
        return client.runs.configureRetention.mutate(input);
      }
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
          'Usage: start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file] [--request-id key] [--external-task json|@file] [--tag KEY=VALUE ...] [--priority N] [--after json|@file] [--on-active-external-task allow|reuse|reject|cancel_previous] [--version-policy pinned|latest-compatible]',
        );
      const input = {
        tags: parseTags(Array.isArray(values.tag) ? values.tag : undefined),
        versionPolicy:
          values['version-policy'] === undefined
            ? undefined
            : runVersionPolicySchema.parse(values['version-policy']),
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
          tag: { type: 'string', multiple: true },
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
          tags: parseTags(Array.isArray(values.tag) ? values.tag : undefined),
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
    case 'run-version': {
      if (args.length !== 1)
        throw new Error(
          'Usage: run-version <json|@file> (action: read|policy|preview|apply)',
        );
      const { action, ...input } = await parse(args[0]);
      switch (action) {
        case 'read':
          return client.runs.versionPolicy.query(
            runVersionReadSchema.parse(input),
          );
        case 'policy':
          return client.runs.setVersionPolicy.mutate(
            setRunVersionPolicySchema.parse(input),
          );
        case 'preview':
          return client.runs.previewVersionMove.query(
            runVersionPreviewSchema.parse(input),
          );
        case 'apply':
          return client.runs.applyVersionMove.mutate(
            runVersionApplySchema.parse(input),
          );
        default:
          throw new Error(
            'run-version action must be read, policy, preview or apply',
          );
      }
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
    case 'cancel-tree': {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: {
          'include-detached': { type: 'boolean' },
          preview: { type: 'boolean' },
          reason: { type: 'string' },
          limit: { type: 'string' },
          offset: { type: 'string' },
        },
      });
      if (
        positionals.length !== 1 ||
        (!values.preview && (!values.reason || values.offset !== undefined))
      )
        throw new Error(
          'Usage: cancel-tree <run-id> [--include-detached] [--preview [--offset N] | --reason TEXT] [--limit N]',
        );
      const selection = {
        id: positionals[0],
        includeDetached: values['include-detached'] ?? false,
        ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
      };
      return values.preview
        ? client.runs.previewCancellation.query({
            ...selection,
            ...(values.offset !== undefined
              ? { offset: Number(values.offset) }
              : {}),
          })
        : client.runs.cancelTree.mutate({
            ...selection,
            reason: values.reason!,
          });
    }
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
    case 'doctor': {
      const { values } = parseArgs({
        args,
        options: {
          live: { type: 'boolean' },
          json: { type: 'boolean' },
        },
      });
      return client.system.doctor.query({ live: values.live });
    }
    case 'report': {
      const { filter } = parseReportArgs(args);
      return client.report.summary.query(filter);
    }
    default:
      return {
        usage: [
          'report [--workflow <id>] [--since <ISO datetime>] [--until <ISO datetime>] [--limit <n>] [--tag KEY=VALUE ...] [--json] (workflow performance and cost report over time window)',
          'doctor [--live] [--json] (read-only system health and readiness check; returns non-zero on failure)',
          'triggers <read|manage> <json|@file> (schedule/event configuration; paged search/status filters and scoped counts; mutations use expectedRevision; create defaults disabled, enabled:true opts in; imports disabled; schedules alias retained)',
          'variables <read|manage> <json|@file> [--value-stdin] (metadata list/inspect, explicit config_value; write-only Secret creation/replacement through stdin)',
          'stalls [json|@file] (settings by default; configure with expectedRevision/policy, inspect with runId/offset/limit)',
          'executors [json|@file] (list by default; settings/save_settings for shared concurrency, save local profiles with optional concurrency, discover models/efforts, inspect work, respond, retry_model after a model refusal, stop or reconcile an interrupted execution)',
          'workflows [scope-json: {"ownerWorkflowId":null|"parent-id"}]',
          'workflow <id>',
          'update <workflow-id> <json|@file> (metadata or draft replacement; layout:"tidy" arranges with Dagre, "preserve" keeps saved positions; draft/layout requests require draftRevision; layout-only changes preserve it)',
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
          'start <workflow-id> <json|@file> [version] [--summary] [--budget json|@file] [--request-id key] [--external-task json|@file] [--tag KEY=VALUE ...] [--priority N] [--after json|@file] [--on-active-external-task allow|reuse|reject|cancel_previous] [--version-policy pinned|latest-compatible]',
          'runs [--tag KEY=VALUE ...] [--request-id KEY] [--external-task json|@file] [--workflow ID] [--chain ROOT_RUN_ID] [--status STATUS] [--root-only] [--limit N] [--input-path PATH --equals JSON] (no flags preserves the full history dump)',
          'run <id>',
          'run-version <json|@file> (action: read with runId/offset/limit; policy with expectedRevision and pinned|latest-compatible; preview with newer version and optional recapturePrompts; apply requires the exact preview confirmation and reason)',
          'run-history <json|@file> (action: settings/configure/status for opt-in retention; configure requires expectedRevision, policy thresholds or null to disable or inherit for workflow overrides; preview with workflowId/before/rootRunIds and offset/limit; delete requires roots with preview confirmations and acknowledgeHistoryLoss:true; workflows and published versions remain)',
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
          'cancel-tree <run-id> [--include-detached] [--preview [--offset N] | --reason TEXT] [--limit N] (preview or atomically cancel descendant tree)',
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

export async function runDoctorCommand(options: { live?: boolean } = {}) {
  const client = createClient(process.env.INTERLOCK_URL);
  return await client.system.doctor.query({ live: options.live });
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    'Interlock Doctor',
    `Checked at: ${report.checkedAt}`,
    '',
  ];

  const categories: DiagnosticCategory[] = [
    'system',
    'harnesses',
    'triggers',
    'blockers',
    'workflows',
  ];

  for (const cat of categories) {
    const catChecks = report.checks.filter((c) => c.category === cat);
    if (catChecks.length === 0) continue;
    lines.push(`[${cat}]`);
    for (const check of catChecks) {
      const icon =
        check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      lines.push(`  ${icon} ${check.name}: ${check.message}`);
      if (check.status !== 'ok' && check.remediation) {
        lines.push(`    Remediation: ${check.remediation}`);
      }
    }
    lines.push('');
  }

  lines.push(
    `Summary: ${report.summary.ok} passing, ${report.summary.warn} warning(s), ${report.summary.fail} failing`,
  );
  lines.push(`Overall status: ${report.status.toUpperCase()}`);
  return lines.join('\n');
}

export function parseReportArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      workflow: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      limit: { type: 'string' },
      tag: { type: 'string', multiple: true },
      json: { type: 'boolean' },
    },
  });
  const filter: ReportFilter = {
    workflowId: values.workflow,
    since: values.since,
    until: values.until,
    limit: values.limit ? Number(values.limit) : undefined,
    ...(values.tag ? { tags: parseTags(values.tag) } : {}),
  };
  return { filter, json: values.json };
}

export async function runReportCommand(filter: ReportFilter) {
  const client = createClient(process.env.INTERLOCK_URL);
  return await client.report.summary.query(filter);
}

export function formatWorkflowReport(report: WorkflowReport): string {
  const lines: string[] = [
    '============================================================',
    'Interlock Performance & Cost Report',
    `Generated at: ${report.generatedAt}`,
    `Window: since=${report.window.since ?? 'all'} until=${report.window.until ?? 'all'}`,
    `Workflow filter: ${report.filter.workflowId ?? 'all'}`,
    '============================================================',
    '',
    'SUMMARY',
    `  Total Runs:                     ${report.summary.totalRuns}`,
    `  Run Duration:                   ${formatElapsedDist(report.summary.durationMs)}`,
    `  Admission Queue Wait:           ${formatElapsedDist(report.summary.admissionQueueWaitMs)}`,
    `  Human Wait Time:                ${formatElapsedDist(report.summary.humanWaitMs)}`,
    '',
  ];

  if (report.stages.length > 0) {
    lines.push('STAGES');
    lines.push(
      '  ' +
        'Stage'.padEnd(24) +
        'Runs'.padEnd(10) +
        'Wall median (ms)'.padEnd(18) +
        'Wall p90 (ms)'.padEnd(18) +
        'Active median (ms)'.padEnd(20) +
        'Paused median (ms)',
    );
    lines.push('  ' + '-'.repeat(60));
    for (const s of report.stages) {
      lines.push(
        '  ' +
          s.stage.padEnd(24) +
          String(s.runCount).padEnd(10) +
          String(s.durationMs.median ?? 0).padEnd(18) +
          String(s.durationMs.p90 ?? 0).padEnd(18) +
          String(s.durationMs.activeMs?.median ?? '—').padEnd(20) +
          String(s.durationMs.pausedMs?.median ?? '—'),
      );
    }
    lines.push('');
  }

  if (report.nodes.length > 0) {
    lines.push('NODES');
    lines.push(
      '  ' +
        'Node ID'.padEnd(20) +
        'Label'.padEnd(24) +
        'Kind'.padEnd(12) +
        'Execs'.padEnd(8) +
        'Wall median (ms)'.padEnd(18) +
        'Wall p90 (ms)'.padEnd(18) +
        'Active median (ms)'.padEnd(20) +
        'Paused median (ms)',
    );
    lines.push('  ' + '-'.repeat(88));
    for (const n of report.nodes.slice(0, 20)) {
      lines.push(
        '  ' +
          n.nodeId.padEnd(20) +
          n.label.slice(0, 22).padEnd(24) +
          n.kind.padEnd(12) +
          String(n.executionCount).padEnd(8) +
          String(n.durationMs.median ?? 0).padEnd(18) +
          String(n.durationMs.p90 ?? 0).padEnd(18) +
          String(n.durationMs.activeMs?.median ?? '—').padEnd(20) +
          String(n.durationMs.pausedMs?.median ?? '—'),
      );
    }
    lines.push('');
  }

  lines.push('CLAIMS');
  lines.push(
    `  Wait to Claim (New session):        ${formatElapsedDist(report.claims.newSession)}`,
  );
  lines.push(
    `  Wait to Claim (Continuing session): ${formatElapsedDist(report.claims.continuingSession)}`,
  );
  lines.push(
    `  Total Attempts:                     ${report.claims.totalAttempts}`,
  );
  lines.push(
    `  Lease Expiries:                     ${report.claims.leaseExpiries}`,
  );
  lines.push(`  Failures:                           ${report.claims.failures}`);
  lines.push(
    `  Transient Recoveries:               ${report.claims.transientRecoveries}`,
  );
  lines.push(`  Stalls:                             ${report.claims.stalls}`);
  lines.push('');

  lines.push('USAGE & ATTRIBUTED COST');
  lines.push(
    `  Tokens: input=${report.usage.tokens.inputTokens.toLocaleString()} output=${report.usage.tokens.outputTokens.toLocaleString()} cached=${report.usage.tokens.cachedInputTokens.toLocaleString()} reasoning=${report.usage.tokens.reasoningOutputTokens.toLocaleString()}`,
  );
  const costStr =
    report.usage.costs.map((c) => c.formatted).join(', ') || '0 USD';
  lines.push(`  Attributed Cost: ${costStr}`);
  lines.push(
    `  Coverage: ${report.usage.coverage.measuredPercentage}% measured (${report.usage.coverage.measuredAttempts}/${report.usage.coverage.totalAttempts} attempts), ${report.usage.coverage.unknownPercentage}% unknown (${report.usage.coverage.unknownAttempts}/${report.usage.coverage.totalAttempts} attempts)`,
  );

  if (report.usage.byProvider.length > 0) {
    lines.push('  By Provider:');
    for (const p of report.usage.byProvider) {
      const pCost =
        p.currency === 'mixed'
          ? 'Mixed currencies'
          : p.costMicros
            ? (p.costMicros / 1_000_000).toFixed(4) + ' ' + (p.currency ?? '')
            : 'none';
      lines.push(
        `    ${p.provider.padEnd(20)} count=${String(p.count).padEnd(6)} input=${p.inputTokens.toLocaleString().padEnd(12)} output=${p.outputTokens.toLocaleString().padEnd(12)} cost=${pCost}`,
      );
    }
  }

  if (report.usage.byModel.length > 0) {
    lines.push('  By Model:');
    for (const m of report.usage.byModel.slice(0, 10)) {
      const mCost =
        m.currency === 'mixed'
          ? 'Mixed currencies'
          : m.costMicros
            ? (m.costMicros / 1_000_000).toFixed(4) + ' ' + (m.currency ?? '')
            : 'none';
      lines.push(
        `    ${(m.provider + '/' + m.model).padEnd(30)} count=${String(m.count).padEnd(6)} input=${m.inputTokens.toLocaleString().padEnd(12)} output=${m.outputTokens.toLocaleString().padEnd(12)} cost=${mCost}`,
      );
    }
  }
  if (report.usage.byAlias?.length) {
    lines.push('  By Captured Alias:');
    for (const group of report.usage.byAlias) {
      const alias = group.alias
        ? `${group.alias.name}@${group.alias.revision}`
        : 'Unknown';
      const cost =
        group.costMicros !== null
          ? `${(group.costMicros / 1_000_000).toFixed(4)} ${group.currency ?? ''}`
          : 'unknown';
      lines.push(
        `    ${alias} (${group.scope}) candidate=${group.alias ? `${group.alias.candidateModel}#${group.alias.candidateIndex + 1}` : 'unknown'} profile=${group.alias?.candidateProfileId ?? 'inherited'} effort=${group.alias?.candidateEffort === null ? 'native' : (group.alias?.candidateEffort ?? 'inherited')} reported=${group.provider}/${group.model} count=${group.count} input=${group.inputTokens} output=${group.outputTokens} cost=${cost}`,
      );
    }
  }
  lines.push('');

  lines.push('TERMINAL OUTCOMES');
  lines.push(
    `  Completed: ${report.terminalOutcomes.completedRuns} | Failed: ${report.terminalOutcomes.failedRuns} | Cancelled: ${report.terminalOutcomes.cancelledRuns} | Active: ${report.terminalOutcomes.activeRuns}`,
  );
  lines.push(
    `  Unattended Completion Rate: ${report.terminalOutcomes.unattendedCompletionRate}%`,
  );
  lines.push(
    `  Human Escalation Rate:       ${report.terminalOutcomes.humanEscalationRate}%`,
  );

  if (report.terminalOutcomes.exitNodes.length > 0) {
    lines.push('  Exit Nodes:');
    lines.push(
      '    ' +
        'Node ID'.padEnd(20) +
        'Label'.padEnd(28) +
        'Runs'.padEnd(8) +
        '% of Completed',
    );
    lines.push('    ' + '-'.repeat(66));
    for (const e of report.terminalOutcomes.exitNodes) {
      lines.push(
        '    ' +
          e.nodeId.padEnd(20) +
          e.label.padEnd(28) +
          String(e.count).padEnd(8) +
          `${e.percentage}%`,
      );
    }
  }

  lines.push('============================================================');
  return lines.join('\n');
}

function formatElapsedDist(
  dist: Parameters<typeof formatDist>[0] & {
    activeMs?: Parameters<typeof formatDist>[0];
    pausedMs?: Parameters<typeof formatDist>[0];
  },
): string {
  const parts = [`wall: ${formatDist(dist)}`];
  if (dist.activeMs) parts.push(`active: ${formatDist(dist.activeMs)}`);
  if (dist.pausedMs) parts.push(`paused: ${formatDist(dist.pausedMs)}`);
  return parts.join('; ');
}

function formatDist(
  d: {
    count: number;
    min: number | null;
    median: number | null;
    p90: number | null;
    max: number | null;
  },
  unit = 'ms',
): string {
  if (d.count === 0 || d.median === null) return 'none';
  return `count=${d.count} min=${d.min} median=${d.median} p90=${d.p90} max=${d.max} ${unit}`.trim();
}
