import { readFileSync } from 'node:fs';
import {
  assertContract,
  validateContractSchema,
  jsonSchema,
  type Json,
} from '@interlock/core';
import { batchDefinition } from './fixtures/batch';
import { switchDefinition } from './fixtures/switch';
import { workflowCall } from './fixtures/detached';
import { runCommand } from '../packages/cli/src/commands';
import { it, expect, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '@interlock/storage';
import { Engine } from '@interlock/runtime';
import { createClient } from '@interlock/client';
import { createApp } from '../packages/server/src/app';
import { nodeSchema, blankDefinition } from '@interlock/core';

function leaseDeadline(value: unknown): number {
  if (
    !value ||
    typeof value !== 'object' ||
    !('leaseUntil' in value) ||
    typeof value.leaseUntil !== 'string'
  )
    throw new Error('Expected a claim deadline');
  return Date.parse(value.leaseUntil);
}

let testbenchDiscovery: unknown;

it.each(['stdio', 'http'])(
  'completes a workflow through MCP %s and the shared HTTP and SQLite interfaces',
  async (mode) => {
    const store = new Store(':memory:'),
      engine = new Engine(store, process.cwd());
    const w = engine.create('Transport smoke', '', blankDefinition());
    engine.publish(w.id);
    const server = serve({
      fetch: createApp(engine).fetch,
      hostname: '127.0.0.1',
      port: 0,
    });
    await new Promise<void>((resolve) =>
      server.listening ? resolve() : server.once('listening', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const transport =
      mode === 'http'
        ? new StreamableHTTPClientTransport(new URL(`${url}/mcp`))
        : new StdioClientTransport({
            command: process.execPath,
            args: ['--import', 'tsx', 'packages/mcp/src/index.ts'],
            cwd: process.cwd(),
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(
                  (pair): pair is [string, string] => pair[1] !== undefined,
                ),
              ),
              INTERLOCK_URL: url,
            },
            stderr: 'pipe',
          });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).not.toBe(true);
      const content = response.content as { type: string; text: string }[];
      const parsed = JSON.parse(content[0].text);
      expect(response.structuredContent).toEqual(
        Array.isArray(parsed)
          ? { items: parsed }
          : parsed !== null && typeof parsed === 'object'
            ? parsed
            : { value: parsed },
      );
      return parsed;
    };
    try {
      await client.connect(transport);
      expect(
        (await call('list_workflows', {})).some(
          (item: { id: string }) => item.id === w.id,
        ),
      ).toBe(true);
      expect(await call('get_workflow', { id: w.id })).toMatchObject({
        draftMatchesLatest: true,
      });
      expect(
        (await call('list_workflows', {})).find(
          (item: any) => item.id === w.id,
        ),
      ).toMatchObject({ draftMatchesLatest: true });
      const draftOnly = await call('create_workflow', { name: 'Draft only' });
      expect(await call('get_workflow', { id: draftOnly.id })).toMatchObject({
        draftMatchesLatest: null,
      });
      const changed = engine.workflow(w.id).draft;
      changed.nodes[1].label = 'Edited';
      engine.update(w.id, { draft: changed, draftRevision: w.draftRevision });
      expect(await call('get_workflow', { id: w.id })).toMatchObject({
        draftMatchesLatest: false,
      });
      expect(
        (await call('list_workflows', {})).find(
          (item: any) => item.id === w.id,
        ),
      ).toMatchObject({ draftMatchesLatest: false });
      const compactBefore = await call('list_workflows', {});
      expect(compactBefore.every((item: any) => !('draft' in item))).toBe(true);
      expect(Object.keys(compactBefore[0]).sort()).toEqual(
        [
          'id',
          'name',
          'description',
          'ownerWorkflowId',
          'archived',
          'latestVersion',
          'draftRevision',
          'createdAt',
          'updatedAt',
          'draftMatchesLatest',
        ].sort(),
      );
      const compactLength = JSON.stringify(compactBefore).length;
      const smallDraft = engine.workflow(w.id).draft;
      const largeDraft = structuredClone(smallDraft);
      if (largeDraft.nodes[1].kind !== 'agent')
        throw new Error('Expected agent');
      largeDraft.nodes[1].prompt = 'Large prompt '.repeat(10000);
      largeDraft.nodes[1].outputSchema = {
        type: 'object',
        description: 'Large schema '.repeat(10000),
      };
      for (let i = 0; i < 100; i++)
        largeDraft.nodes.push(
          nodeSchema.parse({
            id: `extra-${i}`,
            kind: 'agent',
            label: 'Extra',
            prompt: 'Extra prompt',
          }),
        );
      engine.update(w.id, {
        draft: largeDraft,
        draftRevision: engine.workflow(w.id).draftRevision,
      });
      const compactAfter = await call('list_workflows', {
        includeDraft: false,
      });
      expect(JSON.stringify(compactAfter).length).toBe(compactLength);
      const legacyList = await call('list_workflows', { includeDraft: true });
      expect(legacyList.find((item: any) => item.id === w.id).draft).toEqual(
        largeDraft,
      );
      expect((await call('get_workflow', { id: w.id })).draft).toEqual(
        largeDraft,
      );
      const api = createClient(url);
      expect(
        (await api.workflows.list.query()).find((item) => item.id === w.id)
          ?.draft,
      ).toEqual(largeDraft);
      engine.update(w.id, {
        draft: smallDraft,
        draftRevision: engine.workflow(w.id).draftRevision,
      });
      const tools = (await client.listTools()).tools;
      const testbenchTools = [
        'read_test_suites',
        'save_test_suite',
        'preview_workflow_comparison',
        'start_workflow_comparison',
        'read_workflow_comparisons',
        'update_workflow_comparison',
      ];
      const discovered = tools.filter((t) =>
        /test_suite|workflow_comparison|comparison_case|comparison_quality/.test(
          t.name,
        ),
      );
      expect(discovered.map((t) => t.name).sort()).toEqual(
        [...testbenchTools].sort(),
      );
      const contracts = discovered.map(
        ({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        }),
      );
      if (testbenchDiscovery) expect(contracts).toEqual(testbenchDiscovery);
      else testbenchDiscovery = contracts;
      const protectedState = () =>
        Object.fromEntries(
          [
            'workflows',
            'versions',
            'deletedVersions',
            'runs',
            'work',
            'events',
            'prompts',
            'promptRevisions',
            'testSuites',
            'comparisons',
          ].map((collection) => [collection, store.list(collection)]),
        );
      const rejectAction = async (name: string, args: Record<string, Json>) => {
        const before = protectedState();
        const schema = tools.find((t) => t.name === name)!.inputSchema;
        expect(() => assertContract(schema, args, name)).toThrow();
        expect((await client.callTool({ name, arguments: args })).isError).toBe(
          true,
        );
        expect(protectedState()).toEqual(before);
      };
      const comparisonSchema = tools.find(
        (t) => t.name === 'start_workflow_comparison',
      )!.inputSchema;
      expect(comparisonSchema.required).toEqual(
        expect.arrayContaining([
          'suiteId',
          'suiteRevision',
          'baselineVersion',
          'candidateVersion',
          'confirmation',
          'requestId',
        ]),
      );
      expect(() =>
        assertContract(
          comparisonSchema,
          {
            suiteId: 'suite',
            suiteRevision: 1,
            baselineVersion: 1,
            candidateVersion: 2,
            confirmation: 'a'.repeat(64),
            requestId: 'control',
          },
          'comparison control',
        ),
      ).not.toThrow();
      expect(() =>
        assertContract(
          comparisonSchema,
          {
            suiteId: 'suite',
            suiteRevision: 1,
            baselineVersion: 1,
            candidateVersion: 2,
            confirmation: 'a'.repeat(64),
            requestId: 'invalid',
            concurrency: 11,
          },
          'comparison bound',
        ),
      ).toThrow();
      const comparisonWorkflow = await call('create_workflow', {
        name: 'Comparison transport',
      });
      await call('publish_workflow', { id: comparisonWorkflow.id });
      await call('publish_workflow', { id: comparisonWorkflow.id });
      const suiteContent = {
        name: 'Transport cases',
        cases: [
          {
            id: 'case',
            name: 'Case',
            input: { secretInput: 'private' },
            assertions: [
              {
                kind: 'output',
                operator: 'equals',
                path: 'ok',
                expected: true,
              },
            ],
          },
        ],
      };
      const example = JSON.parse(
        readFileSync('docs/workflow-testbench.md', 'utf8').match(
          /```json\n([\s\S]*?)\n```/,
        )![1],
      );
      expect(() =>
        assertContract(
          tools.find((t) => t.name === 'save_test_suite')!.inputSchema,
          example,
          'Documented suite example',
        ),
      ).not.toThrow();
      const suite = await call('save_test_suite', {
        request: {
          action: 'create',
          workflowId: comparisonWorkflow.id,
          content: suiteContent,
        },
      });
      const beforeReads = protectedState();
      const suiteList = await call('read_test_suites', {
        request: { action: 'list', workflowId: comparisonWorkflow.id },
      });
      expect(suiteList).toMatchObject({
        total: 1,
        items: [{ id: suite.id, caseCount: 1 }],
      });
      expect(suiteList.items[0]).not.toHaveProperty('cases');
      expect(
        await call('read_test_suites', {
          request: { action: 'get', id: suite.id },
        }),
      ).toMatchObject({
        revision: 1,
        cases: [{ id: 'case', input: { secretInput: 'private' } }],
      });
      expect(protectedState()).toEqual(beforeReads);
      expect(
        await call('save_test_suite', {
          request: {
            action: 'update',
            id: suite.id,
            revision: 1,
            content: suiteContent,
          },
        }),
      ).toMatchObject({ revision: 1 });
      expect(protectedState()).toEqual(beforeReads);
      for (const [name, args] of [
        ['read_test_suites', {}],
        [
          'read_test_suites',
          { request: { action: 'get', id: suite.id }, limit: 1 },
        ],
        [
          'save_test_suite',
          {
            request: {
              action: 'create',
              workflowId: comparisonWorkflow.id,
              content: suiteContent,
            },
            revision: 999,
          },
        ],
        ['read_test_suites', { request: { action: 'get' } }],
        ['read_test_suites', { request: { action: 'list', id: suite.id } }],
        [
          'read_test_suites',
          {
            request: {
              action: 'create',
              workflowId: comparisonWorkflow.id,
              content: suiteContent,
            },
          },
        ],
        ['read_test_suites', { request: { action: 'list', limit: 101 } }],
        [
          'save_test_suite',
          {
            request: {
              workflowId: comparisonWorkflow.id,
              content: suiteContent,
            },
          },
        ],
        [
          'save_test_suite',
          {
            request: { action: 'update', id: suite.id, content: suiteContent },
          },
        ],
        [
          'save_test_suite',
          { request: { action: 'update', revision: 1, content: suiteContent } },
        ],
        [
          'save_test_suite',
          {
            request: {
              action: 'create',
              workflowId: comparisonWorkflow.id,
              id: suite.id,
              revision: 1,
              content: suiteContent,
            },
          },
        ],
      ] as [string, Record<string, Json>][])
        await rejectAction(name, args);
      const comparisonSelection = {
        suiteId: suite.id,
        suiteRevision: 1,
        baselineVersion: 1,
        candidateVersion: 2,
      };
      const beforePreview = protectedState();
      await rejectAction('preview_workflow_comparison', {
        ...comparisonSelection,
        action: 'start',
      });
      const comparisonPlan = await call(
        'preview_workflow_comparison',
        comparisonSelection,
      );
      expect(comparisonPlan).toMatchObject({ canStart: true, rootRunCount: 2 });
      expect(protectedState()).toEqual(beforePreview);
      const comparisonRequest = {
        ...comparisonSelection,
        confirmation: comparisonPlan.confirmation,
        requestId: `transport-${mode}`,
      };
      await rejectAction('start_workflow_comparison', {
        ...comparisonRequest,
        requestId: `invalid-envelope-${mode}`,
        action: 'preview',
      });
      const comparison = await call(
        'start_workflow_comparison',
        comparisonRequest,
      );
      const beforeReplay = protectedState();
      expect(
        (await call('start_workflow_comparison', comparisonRequest)).id,
      ).toBe(comparison.id);
      expect(protectedState()).toEqual(beforeReplay);
      const conflicting = await client.callTool({
        name: 'start_workflow_comparison',
        arguments: { ...comparisonRequest, concurrency: 1 },
      });
      expect(conflicting.isError).toBe(true);
      expect(protectedState()).toEqual(beforeReplay);
      const sample = engine.testbench.report({ id: comparison.id }).samples[0];
      const qualityRequest = {
        action: 'record_quality',
        id: comparison.id,
        sampleId: sample.id,
        reviewer: 'Transport test',
        reviewerKind: 'agent',
        rubric: 'Useful result',
        score: 4,
        notes: 'Recorded separately',
      };
      for (const [name, args] of [
        [
          'read_workflow_comparisons',
          { request: { action: 'report', id: comparison.id }, caseId: 'case' },
        ],
        [
          'update_workflow_comparison',
          { request: { action: 'cancel', id: comparison.id }, score: 4 },
        ],

        [
          'read_workflow_comparisons',
          { request: { action: 'start', id: comparison.id } },
        ],
        [
          'read_workflow_comparisons',
          { request: { action: 'list', id: comparison.id } },
        ],
        [
          'read_workflow_comparisons',
          { request: { action: 'report', id: comparison.id, caseId: 'case' } },
        ],
        [
          'read_workflow_comparisons',
          { request: { action: 'case', id: comparison.id } },
        ],
        [
          'read_workflow_comparisons',
          {
            request: {
              action: 'case',
              id: comparison.id,
              caseId: 'case',
              limit: 1,
            },
          },
        ],
        [
          'read_workflow_comparisons',
          { request: { action: 'report', id: comparison.id, limit: 26 } },
        ],
        [
          'update_workflow_comparison',
          { request: { action: 'cancel', id: comparison.id, score: 4 } },
        ],
        [
          'update_workflow_comparison',
          { request: { ...qualityRequest, cancelDetached: true } },
        ],
        [
          'update_workflow_comparison',
          { request: { ...qualityRequest, score: 6 } },
        ],
        [
          'update_workflow_comparison',
          { request: { action: 'report', id: comparison.id } },
        ],
      ] as [string, Record<string, Json>][])
        await rejectAction(name, args);
      for (const run of engine.store
        .runs()
        .filter((r) => r.comparison?.comparisonId === comparison.id)) {
        const work = (
          await call('list_work', { fields: 'full', runId: run.id })
        )[0];
        const claim = await call('claim_work', {
          workId: work.id,
          workerId: 'comparison-transport',
        });
        await call('submit_result', {
          detail: 'full',
          workId: work.id,
          token: claim.token,
          output: { ok: true, secretOutput: 'private' },
        });
      }
      const beforeReport = protectedState();
      const comparisonReport = await call('read_workflow_comparisons', {
        request: { action: 'report', id: comparison.id, limit: 1 },
      });
      expect(comparisonReport).toMatchObject({
        status: 'completed',
        total: 2,
        checkCounts: { pass: 2, fail: 0, unknown: 0 },
      });
      expect(comparisonReport.samples).toHaveLength(1);
      expect(comparisonReport.samples[0].observation.checks[0]).toMatchObject({
        assertion: { path: 'ok', operator: 'equals', expected: true },
        assertionRef: { comparisonId: comparison.id, caseId: 'case', index: 0 },
      });
      expect(
        await call('read_workflow_comparisons', {
          request: { action: 'case', id: comparison.id, caseId: 'case' },
        }),
      ).toMatchObject({
        suiteRevision: 1,
        case: {
          input: { secretInput: 'private' },
          assertions: [{ expected: true }],
        },
      });
      expect(
        (
          await call('read_workflow_comparisons', {
            request: { action: 'list', workflowId: comparisonWorkflow.id },
          })
        ).items,
      ).toEqual([expect.objectContaining({ id: comparison.id })]);
      expect(protectedState()).toEqual(beforeReport);
      expect(JSON.stringify(comparisonReport)).not.toContain('secretInput');
      expect(JSON.stringify(comparisonReport)).not.toContain('secretOutput');
      const judgment = await call('update_workflow_comparison', {
        request: qualityRequest,
      });
      expect(judgment).toMatchObject({ reviewerKind: 'agent', score: 4 });
      const judged = await call('read_workflow_comparisons', {
        request: { action: 'report', id: comparison.id },
      });
      expect(judged).toMatchObject({
        judgmentCount: 1,
        judgments: [{ id: judgment.id, rubric: 'Useful result', score: 4 }],
        checkCounts: { pass: 2, fail: 0, unknown: 0 },
      });
      const editedContent = {
        ...suiteContent,
        name: 'Edited suite',
        cases: [
          {
            ...suiteContent.cases[0],
            assertions: [
              { ...suiteContent.cases[0].assertions[0], expected: false },
            ],
          },
        ],
      };
      expect(
        await call('save_test_suite', {
          request: {
            action: 'update',
            id: suite.id,
            revision: 1,
            content: editedContent,
          },
        }),
      ).toMatchObject({ revision: 2 });
      const beforeHistory = protectedState();
      expect(
        await call('read_test_suites', {
          request: { action: 'get', id: suite.id },
        }),
      ).toMatchObject({
        revision: 2,
        cases: [{ assertions: [{ expected: false }] }],
      });
      expect(
        await call('read_workflow_comparisons', {
          request: { action: 'case', id: comparison.id, caseId: 'case' },
        }),
      ).toMatchObject({
        suiteRevision: 1,
        case: { assertions: [{ expected: true }] },
      });
      expect(
        await call('read_workflow_comparisons', {
          request: { action: 'report', id: comparison.id },
        }),
      ).toMatchObject({
        suiteRevision: 1,
        checkCounts: { pass: 2, fail: 0, unknown: 0 },
      });
      expect(protectedState()).toEqual(beforeHistory);
      expect(
        (
          await client.callTool({
            name: 'save_test_suite',
            arguments: {
              request: {
                action: 'update',
                id: suite.id,
                revision: 1,
                content: suiteContent,
              },
            },
          })
        ).isError,
      ).toBe(true);
      expect(protectedState()).toEqual(beforeHistory);
      expect(
        (
          await client.callTool({
            name: 'preview_workflow_comparison',
            arguments: comparisonSelection,
          })
        ).isError,
      ).toBe(true);
      expect(protectedState()).toEqual(beforeHistory);
      const cancelSelection = { ...comparisonSelection, suiteRevision: 2 };
      const cancelPlan = await call(
        'preview_workflow_comparison',
        cancelSelection,
      );
      const cancelComparison = await call('start_workflow_comparison', {
        ...cancelSelection,
        confirmation: cancelPlan.confirmation,
        requestId: `cancel-${mode}`,
      });
      expect(
        await call('update_workflow_comparison', {
          request: { action: 'cancel', id: cancelComparison.id },
        }),
      ).toMatchObject({ status: 'cancelled', activeTrees: 0 });

      for (const name of ['preview_workflow_ownership', 'set_workflow_owner'])
        expect(tools.map((t) => t.name)).toContain(name);
      const ownershipSchema = tools.find(
        (t) => t.name === 'set_workflow_owner',
      )!.inputSchema;
      expect(ownershipSchema.required).toEqual(
        expect.arrayContaining([
          'id',
          'ownerWorkflowId',
          'expectedOwnerWorkflowId',
        ]),
      );
      expect(() =>
        assertContract(
          ownershipSchema,
          { id: w.id, ownerWorkflowId: null },
          'ownership change',
        ),
      ).toThrow();
      expect(() =>
        assertContract(
          ownershipSchema,
          {
            id: w.id,
            ownerWorkflowId: '',
            expectedOwnerWorkflowId: null,
          },
          'ownership change',
        ),
      ).toThrow();
      expect(() =>
        assertContract(
          ownershipSchema,
          { id: w.id, ownerWorkflowId: null, expectedOwnerWorkflowId: null },
          'ownership control',
        ),
      ).not.toThrow();
      expect(
        tools.find((t) => t.name === 'update_workflow')!.inputSchema.properties,
      ).not.toHaveProperty('ownerWorkflowId');
      const ownershipTarget = await call('create_workflow', {
        name: 'Ownership target',
      });
      const ownershipOwner = await call('create_workflow', {
        name: 'Ownership owner',
      });
      const ownershipPreview = await call('preview_workflow_ownership', {
        id: ownershipTarget.id,
        ownerWorkflowId: ownershipOwner.id,
      });
      expect(ownershipPreview).toMatchObject({
        canSetOwner: true,
        currentOwnerWorkflowId: null,
        blockers: [],
      });
      expect(
        (await call('get_workflow', { id: ownershipTarget.id }))
          .ownerWorkflowId,
      ).toBe(null);
      const moveArguments = {
        id: ownershipTarget.id,
        ownerWorkflowId: ownershipOwner.id,
        expectedOwnerWorkflowId: null,
      };
      expect(await call('set_workflow_owner', moveArguments)).toMatchObject({
        applied: true,
        workflow: {
          id: ownershipTarget.id,
          ownerWorkflowId: ownershipOwner.id,
          draftRevision: 1,
        },
      });
      const adopted = await call('get_workflow', { id: ownershipTarget.id });
      const staleMove = await client.callTool({
        name: 'set_workflow_owner',
        arguments: { ...moveArguments, ownerWorkflowId: null },
      });
      expect(staleMove.isError).toBe(true);
      expect(await call('get_workflow', { id: ownershipTarget.id })).toEqual(
        adopted,
      );
      expect(
        await call('set_workflow_owner', {
          ...moveArguments,
          expectedOwnerWorkflowId: ownershipOwner.id,
        }),
      ).toMatchObject({ applied: false });
      expect(
        await call('set_workflow_owner', {
          id: ownershipTarget.id,
          ownerWorkflowId: null,
          expectedOwnerWorkflowId: ownershipOwner.id,
        }),
      ).toMatchObject({ applied: true, workflow: { ownerWorkflowId: null } });
      for (const name of [
        'preview_version_deletion',
        'delete_workflow_versions',
        'list_workflow_versions',
      ])
        expect(tools.map((t) => t.name)).toContain(name);
      expect(
        tools.find((t) => t.name === 'delete_workflow_versions')!.inputSchema
          .required,
      ).toEqual(
        expect.arrayContaining([
          'versions',
          'confirmation',
          'acknowledgeHistoryLoss',
        ]),
      );
      expect(
        tools.find((t) => t.name === 'import_workflows')!.inputSchema
          .properties,
      ).toHaveProperty('restoreDeletedVersions');
      const cleanupWorkflow = await call('create_workflow', {
        name: 'Cleanup transport',
        definition: blankDefinition(),
      });
      await call('publish_workflow', { id: cleanupWorkflow.id });
      const oldRun = await call('start_run', {
        detail: 'full',
        workflowId: cleanupWorkflow.id,
        input: { saved: 'history' },
      });
      await call('cancel_run', { id: oldRun.run.id });
      await call('publish_workflow', { id: cleanupWorkflow.id });
      const cleanupBackup = await call('export_workflow', {
        id: cleanupWorkflow.id,
      });
      const selection = [{ workflowId: cleanupWorkflow.id, version: 1 }];
      const cleanupPreview = await call('preview_version_deletion', {
        versions: selection,
      });
      expect(cleanupPreview).toMatchObject({
        canDelete: true,
        affectedRuns: [{ runId: oldRun.run.id }],
      });
      const unacknowledged = await client.callTool({
        name: 'delete_workflow_versions',
        arguments: {
          versions: selection,
          confirmation: cleanupPreview.confirmation,
          acknowledgeHistoryLoss: false,
        },
      });
      expect(unacknowledged.isError).toBe(true);
      expect(store.getVersion(cleanupWorkflow.id, 1)).toBeDefined();
      await call('delete_workflow_versions', {
        versions: selection,
        confirmation: cleanupPreview.confirmation,
        acknowledgeHistoryLoss: true,
      });
      expect(await call('get_run', { id: oldRun.run.id })).toMatchObject({
        definitionAvailable: false,
        definition: null,
        run: { input: { saved: 'history' } },
      });
      expect(
        (await call('list_workflow_versions', { id: cleanupWorkflow.id })).map(
          (v: any) => v.version,
        ),
      ).toEqual([2]);
      expect(
        (await call('export_workflow', { id: cleanupWorkflow.id }))
          .formatVersion,
      ).toBe(3);
      expect(
        (await call('import_workflows', { bundle: cleanupBackup }))
          .skippedVersions,
      ).toEqual(selection);
      const cleanupUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        expect(
          await runCommand([
            'import',
            JSON.stringify(cleanupBackup),
            '--restore-deleted-versions',
          ]),
        ).toMatchObject({ restoredVersions: selection });
      } finally {
        if (cleanupUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = cleanupUrl;
      }
      expect(await call('get_run', { id: oldRun.run.id })).toMatchObject({
        definitionAvailable: true,
      });
      expect(
        tools.find((t) => t.name === 'list_workflows')!.inputSchema.properties!
          .includeDraft,
      ).toMatchObject({ default: false });
      for (const tool of tools) validateContractSchema(tool.inputSchema);
      expect(tools.map((t) => t.name)).toContain('claim_work');
      const deletionScope = tools.find(
        (t) => t.name === 'delete_workflow',
      )!.description;
      expect(deletionScope).toContain('Batch item runs and detached runs');
      expect(deletionScope).toContain(
        'ancestor runs and the entire run tree remain intact',
      );
      for (const name of [
        'list_prompts',
        'get_prompt',
        'create_prompt',
        'update_prompt',
        'delete_prompt',
      ])
        expect(tools.map((t) => t.name)).toContain(name);
      expect(
        tools.find((t) => t.name === 'update_prompt')!.inputSchema.required,
      ).toContain('revision');
      expect(
        tools.find((t) => t.name === 'create_prompt')!.inputSchema.properties!
          .description,
      ).toMatchObject({ default: '' });
      const savedPrompt = await call('create_prompt', {
        name: 'Transport guidance',
        content: 'Use original guidance',
      });
      expect(
        (await call('list_prompts', {})).find(
          (p: any) => p.id === savedPrompt.id,
        ),
      ).not.toHaveProperty('content');
      expect(await call('get_prompt', { id: savedPrompt.id })).toMatchObject({
        revision: 1,
        content: 'Use original guidance',
        usage: [],
      });
      const promptGraph = blankDefinition();
      if (promptGraph.nodes[1].kind !== 'agent')
        throw new Error('Expected Agent');
      promptGraph.nodes[1].promptIds = [savedPrompt.id];
      promptGraph.nodes[1].context.mode = 'fresh';
      const promptWorkflow = await call('create_workflow', {
        name: 'Transport prompt workflow',
        definition: promptGraph,
      });
      await call('publish_workflow', { id: promptWorkflow.id });
      const promptRun = await call('start_run', {
        detail: 'full',
        workflowId: promptWorkflow.id,
        input: null,
      });
      const promptWork = (
        await call('list_work', { fields: 'full', runId: promptRun.run.id })
      )[0];
      expect(promptWork.prompt).toContain('Use original guidance');
      expect(promptWork.executionInstructions).toContain('fresh');
      expect(promptWork.savedPrompts[0]).toMatchObject({
        revision: 1,
        id: savedPrompt.id,
      });
      await call('update_prompt', {
        id: savedPrompt.id,
        revision: 1,
        name: savedPrompt.name,
        content: 'Use revised guidance',
      });
      const stalePrompt = await client.callTool({
        name: 'update_prompt',
        arguments: {
          id: savedPrompt.id,
          revision: 1,
          name: savedPrompt.name,
          content: 'Stale instructions',
        },
      });
      expect(stalePrompt.isError).toBe(true);
      const deletion = await client.callTool({
        name: 'delete_prompt',
        arguments: { id: savedPrompt.id },
      });
      expect(deletion.isError).toBe(true);
      const promptClaim = await call('claim_work', {
        workId: promptWork.id,
        workerId: 'prompt-transport',
        freshContext: true,
      });
      expect(promptClaim.prompt).toContain('Use original guidance');
      await call('submit_result', {
        detail: 'full',
        workId: promptWork.id,
        token: promptClaim.token,
        output: null,
      });
      const latestRun = await call('start_run', {
        detail: 'full',
        workflowId: promptWorkflow.id,
        input: null,
      });
      expect(
        (
          await call('list_work', { fields: 'full', runId: latestRun.run.id })
        )[0].prompt,
      ).toContain('Use revised guidance');
      const captured = await call('get_run', { id: promptRun.run.id });
      expect(captured.run.promptSnapshots[0].content).toBe(
        'Use original guidance',
      );
      const compact = await call('get_run_briefing', { id: latestRun.run.id });
      expect(JSON.stringify(compact)).not.toContain('Use revised guidance');
      const promptBundle = await call('export_workflow', {
        id: promptWorkflow.id,
      });
      expect(promptBundle).toMatchObject({
        formatVersion: 2,
        prompts: [expect.objectContaining({ id: savedPrompt.id, revision: 2 })],
      });
      expect(
        (await call('import_workflows', { bundle: promptBundle })).changed,
      ).toEqual([]);
      await call('cancel_run', { id: latestRun.run.id });
      const unusedPrompt = await call('create_prompt', {
        name: 'Unused',
        content: 'Unused guidance',
      });
      expect(await call('delete_prompt', { id: unusedPrompt.id })).toEqual({
        id: unusedPrompt.id,
      });
      for (const name of [
        'get_run_briefing',
        'wait_for_run_change',
        'get_run_result',
      ])
        expect(tools.map((t) => t.name)).toContain(name);
      expect(
        tools.find((t) => t.name === 'wait_for_run_change')!.inputSchema
          .properties!.timeoutMs,
      ).toMatchObject({ default: 30000, maximum: 60000, minimum: 0 });
      expect(
        tools.find((t) => t.name === 'get_run_briefing')!.inputSchema
          .properties!.limit,
      ).toMatchObject({ default: 20, maximum: 100 });
      expect(
        tools.find((t) => t.name === 'get_run_result')!.inputSchema.properties!
          .maxBytes,
      ).toMatchObject({ default: 65536, maximum: 262144 });
      expect(client.getInstructions()).toContain('get_run_briefing');
      // Real transport cancellation must release the server wait, not just reject the client promise.
      const abortRun = engine.start(w.id, null).run;
      const abortSnapshot = await call('get_run_briefing', { id: abortRun.id });
      let subscribed = false,
        unsubscribed = false;
      const subscribe = engine.store.subscribe.bind(engine.store);
      const subscriptionSpy = vi
        .spyOn(engine.store, 'subscribe')
        .mockImplementation((listener) => {
          subscribed = true;
          const stop = subscribe(listener);
          return () => {
            unsubscribed = true;
            stop();
          };
        });
      const abortController = new AbortController();
      const abortArgs = {
        id: abortRun.id,
        cursor: abortSnapshot.cursor,
        timeoutMs: 60000,
      };
      const abortCall =
        mode === 'http'
          ? fetch(`${url}/mcp`, {
              method: 'POST',
              signal: abortController.signal,
              headers: {
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 'abort-wait',
                method: 'tools/call',
                params: { name: 'wait_for_run_change', arguments: abortArgs },
              }),
            })
          : client.callTool(
              { name: 'wait_for_run_change', arguments: abortArgs },
              undefined,
              { signal: abortController.signal, timeout: 65000 },
            );
      const abortRejected = expect(abortCall).rejects.toThrow();
      await vi.waitFor(() => expect(subscribed).toBe(true));
      abortController.abort();
      await abortRejected;
      await vi.waitFor(() => expect(unsubscribed).toBe(true));
      subscriptionSpy.mockRestore();
      engine.cancel(abortRun.id);
      const continuationRun = engine.start(w.id, {
        keep: [null, 'selected'],
      }).run;
      const continuation = await call('get_run_briefing', {
        id: continuationRun.id,
      });
      expect(continuation.available.total).toBe(1);
      expect(
        await call('get_run_result', {
          id: continuationRun.id,
          field: 'input',
          path: 'keep.0',
        }),
      ).toMatchObject({ value: null });
      expect(
        await call('wait_for_run_change', {
          id: continuationRun.id,
          cursor: continuation.cursor,
          timeoutMs: 5,
        }),
      ).toMatchObject({ changed: false, timedOut: true, reset: false });
      const changedWait = call('wait_for_run_change', {
        id: continuationRun.id,
        cursor: continuation.cursor,
        timeoutMs: 1000,
      });
      const continuationClaim = await call('claim_work', {
        workId: continuation.available.items[0].id,
        workerId: 'continuation-test',
      });
      const changedSnapshot = await changedWait;
      expect(changedSnapshot).toMatchObject({
        changed: true,
        reset: false,
        claimed: { total: 1 },
      });
      expect(JSON.stringify(changedSnapshot)).not.toContain(
        continuationClaim.token,
      );
      await call('submit_result', {
        detail: 'full',
        workId: continuationClaim.id,
        token: continuationClaim.token,
        output: { done: true },
      });
      expect(
        await call('get_run_result', {
          id: continuationRun.id,
          executionId: continuationClaim.executionId,
          path: 'done',
        }),
      ).toMatchObject({ value: true });
      expect(
        await call('wait_for_run_change', {
          id: continuationRun.id,
          cursor: 'stale',
          timeoutMs: 0,
        }),
      ).toMatchObject({
        changed: true,
        reset: true,
        run: { status: 'completed' },
      });
      for (const name of ['edit_workflow', 'validate_workflow'])
        expect(tools.map((t) => t.name)).toContain(name);
      const editSchema = tools.find(
        (t) => t.name === 'edit_workflow',
      )!.inputSchema;
      expect(editSchema.required).toEqual(
        expect.arrayContaining(['id', 'draftRevision', 'edits']),
      );
      expect(editSchema.properties!.edits).toMatchObject({
        type: 'array',
        maxItems: 100,
      });
      expect(
        tools.find((t) => t.name === 'edit_workflow')!.description,
      ).toContain('No-op');
      expect(
        tools.find((t) => t.name === 'edit_workflow')!.description,
      ).toContain('Batch descendants');
      expect(
        tools.find((t) => t.name === 'validate_workflow')!.description,
      ).toContain('unknown');
      expect(
        tools.find((t) => t.name === 'validate_workflow')!.description,
      ).toContain('2 MiB');
      expect(client.getInstructions()).toContain('edit_workflow');
      const editTarget = await call('create_workflow', {
        name: 'Atomic transport edit',
      });
      const edited = await call('edit_workflow', {
        id: editTarget.id,
        draftRevision: editTarget.draftRevision,
        edits: [
          {
            op: 'update_node',
            id: 'agent',
            set: { prompt: 'Updated through MCP' },
          },
          {
            op: 'add_node',
            node: {
              id: 'check',
              kind: 'script',
              label: 'Check',
              command: 'return input',
            },
          },
          { op: 'update_edge', id: 'e2', set: { target: 'check' } },
          {
            op: 'add_edge',
            edge: { id: 'check-out', source: 'check', target: 'exit' },
          },
        ],
      });
      expect(edited).toMatchObject({
        applied: true,
        draftRevision: editTarget.draftRevision + 1,
        changes: { nodes: { added: ['check'], updated: ['agent'] } },
      });
      const persisted = await call('get_workflow', { id: editTarget.id });
      expect(
        persisted.draft.nodes.find((n: { id: string }) => n.id === 'check'),
      ).toMatchObject({ language: 'javascript' });
      expect(
        await call('validate_workflow', { id: editTarget.id }),
      ).toMatchObject({ saveable: true, publishable: true });
      expect(
        await call('edit_workflow', {
          id: editTarget.id,
          draftRevision: editTarget.draftRevision,
          edits: [],
        }),
      ).toMatchObject({
        applied: false,
        diagnostics: [{ code: 'stale_revision' }],
      });
      expect(
        await call('edit_workflow', {
          id: editTarget.id,
          draftRevision: edited.draftRevision,
          edits: [
            { op: 'update_node', id: 'agent', set: { prompt: 'Rollback' } },
            { op: 'remove_node', id: 'missing' },
          ],
        }),
      ).toMatchObject({
        applied: false,
        diagnostics: [{ code: 'invalid_edit', operationIndex: 1 }],
      });
      expect(await call('get_workflow', { id: editTarget.id })).toEqual(
        persisted,
      );
      expect(
        await call('edit_workflow', {
          id: editTarget.id,
          draftRevision: edited.draftRevision,
          edits: [],
        }),
      ).toMatchObject({ applied: true, draftRevision: edited.draftRevision });
      const candidate = { ...persisted.draft, edges: [] };
      const largeCandidate = structuredClone(persisted.draft);
      largeCandidate.nodes.find(
        (node: { id: string }) => node.id === 'agent',
      ).prompt = 'Large candidate '.repeat(40_000);
      expect(
        await call('validate_workflow', {
          id: editTarget.id,
          definition: largeCandidate,
        }),
      ).toMatchObject({ saveable: true, publishable: true });
      expect(
        await call('validate_workflow', {
          id: editTarget.id,
          definition: { ...largeCandidate, edges: [] },
        }),
      ).toMatchObject({ saveable: true, publishable: false });
      expect(
        await call('validate_workflow', {
          id: editTarget.id,
          definition: { ...largeCandidate, unexpected: true },
        }),
      ).toMatchObject({ saveable: false });
      largeCandidate.nodes.find(
        (node: { id: string }) => node.id === 'agent',
      ).prompt = 'x'.repeat(2 * 1024 * 1024);
      const oversized = client.callTool({
        name: 'validate_workflow',
        arguments: {
          id: editTarget.id,
          definition: largeCandidate,
        },
      });
      if (mode === 'http') {
        await expect(oversized).rejects.toThrow('2 MiB limit');
      } else {
        expect(await oversized).toMatchObject({
          isError: true,
          content: [
            { type: 'text', text: expect.stringContaining('2 MiB limit') },
          ],
        });
      }
      expect(
        await call('validate_workflow', {
          id: editTarget.id,
          definition: candidate,
        }),
      ).toMatchObject({ saveable: true, publishable: false });
      expect(
        await call('validate_workflow', {
          id: editTarget.id,
          definition: { ...persisted.draft, unexpected: true },
        }),
      ).toMatchObject({
        saveable: false,
        diagnostics: [{ code: 'unknown_field' }],
      });
      expect(await call('get_workflow', { id: editTarget.id })).toEqual(
        persisted,
      );
      const incomplete = await call('edit_workflow', {
        id: editTarget.id,
        draftRevision: edited.draftRevision,
        edits: [{ op: 'remove_edge', id: 'check-out' }],
      });
      expect(incomplete.applied).toBe(true);
      expect(incomplete.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'incomplete_routes',
            category: 'publication',
          }),
        ]),
      );
      const claimSchema = tools.find(
        (t) => t.name === 'claim_work',
      )!.inputSchema;
      expect(claimSchema.required).not.toContain('leaseSeconds');
      expect(claimSchema.properties!.leaseSeconds).not.toHaveProperty(
        'default',
      );
      expect(claimSchema.properties!.leaseSeconds).toMatchObject({
        minimum: 10,
        maximum: 3600,
      });
      const leaseDefinition = blankDefinition();
      leaseDefinition.nodes[1] = nodeSchema.parse({
        ...leaseDefinition.nodes[1],
        leaseSeconds: 1800,
      });
      const leaseWorkflow = await call('create_workflow', {
        name: 'Node lease',
        definition: leaseDefinition,
      });
      expect(leaseWorkflow.draft.nodes[1].leaseSeconds).toBe(1800);
      await call('publish_workflow', { id: leaseWorkflow.id });
      const leaseRun = await call('start_run', {
        workflowId: leaseWorkflow.id,
        input: {},
      });
      expect(leaseRun.nextWork.items[0].leaseSeconds).toBe(1800);
      const [leaseWork] = await call('list_work', { runId: leaseRun.runId });
      expect(leaseWork.leaseSeconds).toBe(1800);
      for (const duration of [9, 3601, 10.5]) {
        expect(
          (
            await client.callTool({
              name: 'claim_work',
              arguments: {
                workId: leaseWork.id,
                workerId: 'invalid',
                leaseSeconds: duration,
              },
            })
          ).isError,
        ).toBe(true);
      }
      const configuredClaim = await call('claim_work', {
        workId: leaseWork.id,
        workerId: 'configured',
      });
      expect(configuredClaim.claimLeaseSeconds).toBe(1800);
      expect(leaseDeadline(configuredClaim) - Date.now()).toBeGreaterThan(
        1790000,
      );
      const configuredRenewal = await call('renew_claim', {
        workId: leaseWork.id,
        token: configuredClaim.token,
      });
      expect(leaseDeadline(configuredRenewal)).toBeGreaterThanOrEqual(
        leaseDeadline(configuredClaim),
      );
      await call('submit_result', {
        workId: leaseWork.id,
        token: configuredClaim.token,
        output: {},
      });
      const overrideRun = await call('start_run', {
        workflowId: leaseWorkflow.id,
        input: {},
      });
      const overrideClaim = await call('claim_work', {
        workId: overrideRun.nextWork.items[0].id,
        workerId: 'override',
        leaseSeconds: 60,
      });
      expect(overrideClaim.claimLeaseSeconds).toBe(60);
      await call('submit_result', {
        workId: overrideClaim.id,
        token: overrideClaim.token,
        output: {},
      });
      const renewalSchema = tools.find(
        (t) => t.name === 'renew_claim',
      )!.inputSchema;
      expect(renewalSchema.properties!.leaseSeconds).not.toHaveProperty(
        'default',
      );
      expect(renewalSchema.required).not.toContain('leaseSeconds');
      expect(renewalSchema.properties!.leaseSeconds).toMatchObject({
        minimum: 10,
        maximum: 3600,
      });
      const createDefinition = tools.find((t) => t.name === 'create_workflow')!
        .inputSchema.properties!.definition as { description: string };
      const updateDefinition = tools.find((t) => t.name === 'update_workflow')!
        .inputSchema.properties!.draft as { description: string };
      expect(createDefinition.description).toContain('leaseSeconds');
      expect(client.getInstructions()).toContain('work.lease_expired');
      expect(createDefinition.description).toContain('unclaimedTimeoutMs');
      expect(createDefinition.description).toContain('31536000000');
      expect(createDefinition.description).toContain('maxItems');
      expect(createDefinition.description).toContain('10000');
      expect(updateDefinition.description).toBe(createDefinition.description);
      expect(createDefinition.description).toContain('Fetch binding error');
      expect(createDefinition.description).toContain(
        'Late results cannot override Timeout',
      );
      expect(client.getInstructions()).toContain('poll_timeout');
      for (const name of ['get_run_briefing', 'wait_for_run_change'])
        expect(tools.find((tool) => tool.name === name)!.description).toContain(
          'poll_timeout',
        );
      expect(createDefinition.description).toContain('Switch nodes');
      expect(createDefinition.description).toContain('Missing paths fail');
      expect(client.getInstructions()).toContain('Switch executions record');
      expect(createDefinition.description).toContain('Omit default to fail');
      for (const withFallback of [true, false]) {
        const switchDraft = switchDefinition(withFallback);
        for (const [toolName, parameter] of [
          ['create_workflow', 'definition'],
          ['update_workflow', 'draft'],
        ]) {
          expect(() =>
            assertContract(
              tools.find((tool) => tool.name === toolName)!.inputSchema,
              jsonSchema.parse(
                toolName === 'create_workflow'
                  ? { name: 'Switch', [parameter]: switchDraft }
                  : { id: w.id, [parameter]: switchDraft },
              ),
              'Switch definition',
            ),
          ).not.toThrow();
        }
        const switchWorkflow = await call('create_workflow', {
          name: 'Switch',
          definition: switchDraft,
        });
        await call('update_workflow', {
          id: switchWorkflow.id,
          draftRevision: switchWorkflow.draftRevision,
          draft: switchDraft,
        });
        await call('publish_workflow', { id: switchWorkflow.id });
        const switchRun = await call('start_run', {
          detail: 'full',
          workflowId: switchWorkflow.id,
          input: { next: { workflow: 'ticket' } },
        });
        const inspectedSwitch = await call('get_run', { id: switchRun.run.id });
        expect(inspectedSwitch.run.status).toBe('completed');
        expect(inspectedSwitch.run.executions[1]).toMatchObject({
          kind: 'switch',
          port: 'ticket',
          output: { next: { workflow: 'ticket' } },
        });
        const unmatched = await call('start_run', {
          detail: 'full',
          workflowId: switchWorkflow.id,
          input: { next: { workflow: 'unknown' } },
        });
        expect(unmatched.run.status).toBe(
          withFallback ? 'completed' : 'failed',
        );
        if (!withFallback)
          expect(unmatched.run.error).toContain('no case matched "unknown"');
        const switchBundle = await call('export_workflow', {
          id: switchWorkflow.id,
        });
        expect(() =>
          assertContract(
            tools.find((tool) => tool.name === 'import_workflows')!.inputSchema,
            jsonSchema.parse({ bundle: switchBundle }),
            'Switch bundle',
          ),
        ).not.toThrow();
        expect(
          (await call('import_workflows', { bundle: switchBundle })).changed,
        ).toEqual([]);
      }
      expect(createDefinition.description).toContain('mode: "wait"');
      expect(client.getInstructions()).toContain(
        'Detached descendants can remain active',
      );
      expect(tools.find((t) => t.name === 'cancel_run')!.description).toContain(
        'stops at detached',
      );
      expect(tools.find((t) => t.name === 'retry_run')!.description).toContain(
        'failed detached child',
      );
      const targetDefinition = blankDefinition();
      if (targetDefinition.nodes[1].kind === 'agent')
        targetDefinition.nodes[1].maxAttempts = 1;
      const targetWorkflow = await call('create_workflow', {
        name: 'Independent work',
        definition: targetDefinition,
      });
      await call('publish_workflow', { id: targetWorkflow.id });
      for (const executionMode of ['wait', 'detached'] as const) {
        const draft = workflowCall(targetWorkflow.id, executionMode);
        const parent = await call('create_workflow', {
          name: `Dispatch ${executionMode}`,
          definition: draft,
        });
        await call('update_workflow', {
          id: parent.id,
          draftRevision: parent.draftRevision,
          draft,
        });
        await call('publish_workflow', { id: parent.id });
        const started = await call('start_run', {
          detail: 'full',
          workflowId: parent.id,
          input: { hello: 'world' },
        });
        const childId = started.children[0].id;
        expect(started.run.status).toBe(
          executionMode === 'detached' ? 'completed' : 'waiting',
        );
        const summary = (await call('list_runs', {})).find(
          (r: any) => r.id === childId,
        );
        expect(summary.parentMode).toBe(
          executionMode === 'detached' ? 'detached' : undefined,
        );
        const assignments = await call('list_work', {
          runId: started.run.id,
          fields: 'summary',
        });
        expect(assignments[0].parentMode).toBe(summary.parentMode);
        const assignment = assignments[0];
        const claim = await call('claim_work', {
          workId: assignment.id,
          workerId: 'transport',
        });
        if (executionMode === 'detached') {
          await call('fail_work', {
            workId: assignment.id,
            token: claim.token,
            error: 'Try again',
          });
          expect((await call('get_run', { id: childId })).run.status).toBe(
            'failed',
          );
          await call('retry_run', { id: childId });
          const retryWork = (
            await call('list_work', { fields: 'full', runId: childId })
          )[0];
          const retryClaim = await call('claim_work', {
            workId: retryWork.id,
            workerId: 'retry',
          });
          await call('submit_result', {
            detail: 'full',
            workId: retryWork.id,
            token: retryClaim.token,
            output: 'done',
          });
        } else {
          await call('submit_result', {
            detail: 'full',
            workId: assignment.id,
            token: claim.token,
            output: 'done',
          });
        }
        expect((await call('get_run', { id: started.run.id })).run.status).toBe(
          'completed',
        );
        const bundle = await call('export_workflow', { id: parent.id });
        expect((await call('import_workflows', { bundle })).changed).toEqual(
          [],
        );
        expect(
          (await call('get_workflow', { id: parent.id })).draft.nodes[1].mode,
        ).toBe(executionMode);
        const active = await call('start_run', {
          detail: 'full',
          workflowId: parent.id,
          input: null,
        });
        await call('cancel_run', { id: active.run.id });
        expect(
          (await call('get_run', { id: active.children[0].id })).run.status,
        ).toBe(executionMode === 'detached' ? 'waiting' : 'cancelled');
        await call('cancel_run', { id: active.children[0].id });
      }
      expect(createDefinition.description).toContain(
        'Source node requires nodeId',
      );
      const boundDefinition = blankDefinition();
      boundDefinition.nodes.splice(
        2,
        0,
        nodeSchema.parse({
          id: 'consumer',
          kind: 'agent',
          label: 'Consumer',
          prompt: 'Use the earlier output',
          inputBindings: {
            previous: { source: 'node', nodeId: 'agent', path: '' },
          },
        }),
      );
      boundDefinition.edges.find((edge) => edge.source === 'agent')!.target =
        'consumer';
      boundDefinition.edges.push({
        id: 'consumer-exit',
        source: 'consumer',
        target: 'exit',
        port: 'default',
      });
      for (const [toolName, parameter] of [
        ['create_workflow', 'definition'],
        ['update_workflow', 'draft'],
      ]) {
        const schema = tools.find(
          (tool) => tool.name === toolName,
        )!.inputSchema;
        const args =
          toolName === 'create_workflow'
            ? { name: 'Node binding', [parameter]: boundDefinition }
            : { id: w.id, [parameter]: boundDefinition };
        expect(() =>
          assertContract(schema, jsonSchema.parse(args), 'binding definition'),
        ).not.toThrow();
        const invalid = structuredClone(args);
        Reflect.deleteProperty(
          (invalid[parameter] as typeof boundDefinition).nodes[2].inputBindings!
            .previous,
          'nodeId',
        );
        expect(() =>
          assertContract(
            schema,
            jsonSchema.parse(invalid),
            'binding definition',
          ),
        ).toThrow();
      }
      const boundWorkflow = await call('create_workflow', {
        name: 'Node binding',
        definition: boundDefinition,
      });
      await call('update_workflow', {
        id: boundWorkflow.id,
        draft: boundDefinition,
        draftRevision: boundWorkflow.draftRevision,
      });
      await call('publish_workflow', { id: boundWorkflow.id });
      const boundRun = await call('start_run', {
        detail: 'full',
        workflowId: boundWorkflow.id,
        input: {},
      });
      const [firstWork] = await call('list_work', {
        fields: 'full',
        runId: boundRun.run.id,
      });
      const firstClaim = await call('claim_work', {
        workId: firstWork.id,
        workerId: 'bindings',
      });
      await call('submit_result', {
        detail: 'full',
        workId: firstWork.id,
        token: firstClaim.token,
        output: { retained: 42 },
      });
      const [nextWork] = await call('list_work', {
        fields: 'full',
        runId: boundRun.run.id,
      });
      expect(nextWork.input).toEqual({ previous: { retained: 42 } });
      expect(
        (await call('get_run', { id: boundRun.run.id })).run.executions.at(-1)
          .input,
      ).toEqual(nextWork.input);
      await call('cancel_run', { id: boundRun.run.id });
      for (const value of [
        null,
        false,
        3,
        'text',
        '{"literal":true}',
        [1, { nested: [false, null] }],
        { nested: { array: [1] } },
      ]) {
        expect(() =>
          assertContract(
            tools.find((t) => t.name === 'start_run')!.inputSchema,
            { workflowId: w.id, input: value },
            'tool input',
          ),
        ).not.toThrow();
        const roundTrip = await call('start_run', {
          detail: 'full',
          workflowId: w.id,
          input: value,
        });
        const [assignment] = await call('list_work', {
          fields: 'full',
          runId: roundTrip.run.id,
        });
        const claim = await call('claim_work', {
          workId: assignment.id,
          workerId: 'json-values',
        });
        const completed = await call('submit_result', {
          detail: 'full',
          workId: assignment.id,
          token: claim.token,
          output: value,
        });
        expect(completed.run.output).toEqual(value);
      }
      const disposable = await call('create_workflow', { name: 'Disposable' });
      await call('update_workflow', { id: disposable.id, archived: true });
      expect(
        (await call('list_workflows', { includeArchived: false })).some(
          (w: { id: string }) => w.id === disposable.id,
        ),
      ).toBe(false);
      await call('update_workflow', { id: disposable.id, archived: false });
      const bundle = await call('export_workflow', { id: disposable.id });
      expect((await call('import_workflows', { bundle })).changed).toEqual([]);
      const referencedTarget = engine.create('Referenced target');
      engine.publish(referencedTarget.id);
      const referenceOwner = engine.create(
        'Reference owner',
        '',
        workflowCall(referencedTarget.id),
      );
      engine.publish(referenceOwner.id);
      engine.update(referenceOwner.id, {
        draft: blankDefinition(),
        draftRevision: referenceOwner.draftRevision,
      });
      engine.publish(referenceOwner.id);
      const blockedDeletion = await client.callTool({
        name: 'delete_workflow',
        arguments: { id: referencedTarget.id },
      });
      expect(blockedDeletion.isError).toBe(true);
      const blockedContent = blockedDeletion.content as {
        type: string;
        text: string;
      }[];
      expect(blockedContent[0].text).toContain(
        `"Reference owner" (${referenceOwner.id})`,
      );
      expect(blockedContent[0].text).toContain(
        'published versions v1; latest v2 does not reference it',
      );
      expect(blockedContent[0].text).toContain('archive');
      expect(
        tools.find((t) => t.name === 'delete_workflow')!.description,
      ).toContain('External draft or retained published references');
      await call('delete_workflow', { id: disposable.id });
      expect(
        (await call('list_workflows', {})).some(
          (w: { id: string }) => w.id === disposable.id,
        ),
      ).toBe(false);
      expect(createDefinition).toMatchObject({ type: 'object' });
      expect(updateDefinition).toMatchObject({ type: 'object' });
      const recoveryDefinition = blankDefinition();
      recoveryDefinition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'script',
        label: 'Unavailable',
        language: 'javascript',
        command: 'throw new Error("offline");',
        onFailure: 'route',
      });
      recoveryDefinition.edges.push({
        id: 'failed',
        source: 'agent',
        target: 'exit',
        port: 'failed',
      });
      for (const [toolName, parameter] of [
        ['create_workflow', 'definition'],
        ['update_workflow', 'draft'],
        ['validate_workflow', 'definition'],
      ]) {
        const schema = tools.find((t) => t.name === toolName)!.inputSchema;
        const args =
          toolName === 'create_workflow'
            ? { name: 'Recovery', [parameter]: recoveryDefinition }
            : { id: w.id, [parameter]: recoveryDefinition };
        expect(JSON.stringify(schema)).toContain('onFailure');
        expect(JSON.stringify(schema)).toContain('executionId');
        expect(() =>
          assertContract(schema, jsonSchema.parse(args), 'recovery definition'),
        ).not.toThrow();
        const invalid = structuredClone(args);
        (invalid[parameter] as typeof recoveryDefinition).nodes[1] = {
          ...recoveryDefinition.nodes[1],
          onFailure: 'retry',
        } as any;
        if (toolName !== 'validate_workflow')
          expect(() =>
            assertContract(
              schema,
              jsonSchema.parse(invalid),
              'invalid recovery',
            ),
          ).toThrow();
        else expect((await call(toolName, invalid)).saveable).toBe(false);
      }
      const recoveryWorkflow = await call('create_workflow', {
        name: 'Recovery',
        definition: recoveryDefinition,
      });
      expect(
        (await call('validate_workflow', { id: recoveryWorkflow.id }))
          .publishable,
      ).toBe(true);
      await call('publish_workflow', { id: recoveryWorkflow.id });
      const recoveryRun = await call('start_run', {
        detail: 'full',
        workflowId: recoveryWorkflow.id,
        input: { topic: 'demo' },
      });
      await vi.waitFor(() =>
        expect(engine.run(recoveryRun.run.id).status).toBe('completed'),
      );
      const recoveryHistory = await call('get_run', { id: recoveryRun.run.id });
      expect(recoveryHistory.run.executions[1]).toMatchObject({
        status: 'failed',
        port: 'failed',
        error: expect.stringContaining('offline'),
      });
      expect(recoveryHistory.run.output).toMatchObject({
        input: { topic: 'demo' },
        error: { category: 'execution', kind: 'script' },
      });
      for (const [name, parameter] of [
        ['start_run', 'input'],
        ['submit_result', 'output'],
      ]) {
        const schema = tools.find((tool) => tool.name === name)!.inputSchema;
        expect(schema.required).toContain(parameter);
        expect(schema.properties![parameter]).not.toEqual({});
      }
      expect(tools.find((t) => t.name === 'list_work')!.description).toContain(
        'availableUntil',
      );

      // Exercise the published JSON examples through both MCP transports.
      const examples = [
        ...readFileSync('docs/timers.md', 'utf8').matchAll(
          /```json\n([\s\S]*?)\n```/g,
        ),
      ].map((match) => JSON.parse(match[1]));
      for (const example of examples.filter((value) => !Array.isArray(value))) {
        const timerDefinition = blankDefinition();
        timerDefinition.nodes[1] = nodeSchema.parse(example);
        timerDefinition.edges = [
          { id: 'in', source: 'entry', target: example.id, port: 'default' },
          { id: 'out', source: example.id, target: 'exit', port: 'default' },
          ...(example.kind === 'agent' ||
          example.timing?.timeoutMs !== undefined
            ? [
                {
                  id: 'timeout',
                  source: example.id,
                  target: 'exit',
                  port: 'timeout' as const,
                },
              ]
            : []),
        ];
        const timerWorkflow = await call('create_workflow', {
          name: 'Documented timer',
          definition: timerDefinition,
        });
        await call('publish_workflow', { id: timerWorkflow.id });
        const input = { dueAt: '2000-01-01T00:00:00Z' };
        const timerRun = await call('start_run', {
          detail: 'full',
          workflowId: timerWorkflow.id,
          input,
        });
        const timerState = await call('get_run', { id: timerRun.run.id });
        if (example.kind === 'agent') {
          const assignments = await call('list_work', {
            fields: 'full',
            runId: timerRun.run.id,
          });
          expect(assignments[0].availableUntil).toBeDefined();
          await call('cancel_run', { id: timerRun.run.id });
        } else if (['duration', 'poll'].includes(example.timing.kind)) {
          expect(timerState.run.status).toBe('waiting');
          expect(timerState.run.executions.at(-1).resumeAt).toBeDefined();
          if (example.timing.kind === 'poll') {
            const execution = timerState.run.executions.at(-1);
            expect(execution.nextCheckAt).toBeDefined();
            const briefing = await call('get_run_briefing', {
              id: timerRun.run.id,
            });
            expect(briefing.deadlines.items).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ kind: 'poll_check' }),
                expect.objectContaining({
                  kind: 'poll_timeout',
                  at: execution.timeoutAt,
                }),
              ]),
            );
            expect(briefing.blockers.items[0]).toMatchObject({
              nextCheckAt: expect.any(String),
              timeoutAt: execution.timeoutAt,
            });
            expect(briefing.blockers.items[0].check ?? {}).not.toHaveProperty(
              'output',
            );
            const resumed = await call('wait_for_run_change', {
              id: timerRun.run.id,
              cursor: briefing.cursor,
              timeoutMs: 0,
            });
            expect(
              resumed.deadlines.items.some(
                (deadline: any) => deadline.kind === 'poll_timeout',
              ),
            ).toBe(true);
          }
          expect(
            await call('list_work', { fields: 'full', runId: timerRun.run.id }),
          ).toEqual([]);
          expect(
            (await call('cancel_run', { id: timerRun.run.id })).run.status,
          ).toBe('cancelled');
        } else {
          expect(timerState.run.status).toBe('completed');
          expect(timerState.run.output).toEqual(input);
        }
      }
      const batchDraft = await call('create_workflow', {
        name: 'Larger backlog',
        definition: batchDefinition(),
      });
      const raisedLimit = batchDefinition(undefined, {
        maxItems: 250,
        concurrency: 3,
      });
      const updatedBatch = await call('update_workflow', {
        id: batchDraft.id,
        draft: raisedLimit,
        draftRevision: batchDraft.draftRevision,
      });
      expect(
        updatedBatch.draft.nodes.find(
          (n: { kind: string }) => n.kind === 'batch',
        ).maxItems,
      ).toBe(250);
      await call('publish_workflow', { id: batchDraft.id });
      const backlog = await call('start_run', {
        detail: 'full',
        workflowId: batchDraft.id,
        input: Array.from({ length: 207 }, (_, i) => i),
      });
      expect(backlog.run.status).toBe('waiting');
      expect(
        await call('list_work', { fields: 'full', runId: backlog.run.id }),
      ).toHaveLength(3);
      await call('cancel_run', { id: backlog.run.id });
      const started = await call('start_run', {
        detail: 'full',
        workflowId: w.id,
        input: { number: 21 },
      });
      const work = await call('list_work', {
        fields: 'full',
        runId: started.run.id,
      });
      expect(
        await call('list_runs', {
          workflowId: w.id,
          status: 'waiting',
          rootOnly: true,
          limit: 1,
          inputMatch: { path: 'number', equals: 21 },
        }),
      ).toMatchObject([
        {
          id: started.run.id,
          workflowId: w.id,
          rootRunId: started.run.id,
          rootWorkflowId: w.id,
        },
      ]);
      const summary = await call('list_work', {
        runId: started.run.id,
        fields: 'summary',
      });
      expect(summary).toHaveLength(work.length);
      expect(summary[0]).not.toHaveProperty('parentRunId');
      expect(summary[0]).toMatchObject({
        id: work[0].id,
        context: work[0].context,
        workflowId: w.id,
        rootRunId: started.run.id,
        rootWorkflowId: w.id,
      });
      for (const field of [
        'prompt',
        'input',
        'outputSchema',
        'executionInstructions',
      ])
        expect(summary[0]).not.toHaveProperty(field);
      const claim = await call('claim_work', {
        workId: work[0].id,
        workerId: 'mcp-test',
        leaseSeconds: 3600,
      });
      for (const name of ['report_usage', 'get_run_usage'])
        expect(tools.map((tool) => tool.name)).toContain(name);
      expect(
        tools.find((tool) => tool.name === 'report_usage')!.inputSchema
          .required,
      ).toEqual(
        expect.arrayContaining(['workId', 'attempt', 'token', 'snapshot']),
      );
      expect(
        tools.find((tool) => tool.name === 'get_run_usage')!.description,
      ).toContain('detached');
      expect(client.getInstructions()).toContain('report_usage');
      const usageInput = {
        workId: claim.id,
        attempt: claim.attempt,
        token: claim.token,
        snapshot: {
          sequence: 1,
          models: [
            {
              provider: 'test',
              model: 'transport',
              inputTokens: 100,
              outputTokens: 20,
            },
          ],
        },
      };
      const usageResponses = await Promise.all([
        call('report_usage', usageInput),
        call('report_usage', usageInput),
      ]);
      expect(
        usageResponses.filter((response) => response.applied),
      ).toHaveLength(1);
      const usage = await call('get_run_usage', {
        runId: claim.runId,
        groupBy: 'attempt',
      });
      expect(usage.totals).toMatchObject({
        reportedAttempts: 1,
        tokens: { inputTokens: { value: 100, coverage: 'partial' } },
      });
      expect(JSON.stringify(usage)).not.toContain(claim.token);
      expect(JSON.stringify(usage)).not.toContain('tokenHash');
      expect(await call('get_run_usage', { runId: claim.runId })).toEqual(
        await createClient(url).runs.usage.query({ runId: claim.runId }),
      );
      expect(
        (
          await client.callTool({
            name: 'report_usage',
            arguments: { ...usageInput, token: 'wrong' },
          })
        ).isError,
      ).toBe(true);
      const usageUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        expect(
          await runCommand([
            'report-usage',
            JSON.stringify({
              ...usageInput,
              snapshot: { ...usageInput.snapshot, sequence: 2, final: true },
            }),
          ]),
        ).toMatchObject({ applied: true });
        expect(
          await runCommand(['usage', claim.runId, '{"groupBy":"worker"}']),
        ).toMatchObject({
          groupBy: 'worker',
          totals: {
            tokens: { inputTokens: { value: 100, coverage: 'complete' } },
          },
        });
      } finally {
        if (usageUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = usageUrl;
      }
      const renewed = await call('renew_claim', {
        workId: claim.id,
        token: claim.token,
      });
      expect(Date.parse(renewed.leaseUntil)).toBeGreaterThanOrEqual(
        Date.parse(claim.leaseUntil),
      );
      const renewalUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        const overridden = await runCommand([
          'renew',
          claim.id,
          claim.token,
          '{"leaseSeconds":60}',
        ]);
        expect(leaseDeadline(overridden) - Date.now()).toBeGreaterThan(55000);
        expect(leaseDeadline(overridden) - Date.now()).toBeLessThanOrEqual(
          60000,
        );
        await expect(
          runCommand(['renew', claim.id, claim.token, '{"leaseSeconds":3601}']),
        ).rejects.toThrow();
        const cliRenewed = await runCommand(['renew', claim.id, claim.token]);
        expect(leaseDeadline(cliRenewed)).toBeGreaterThanOrEqual(
          Date.parse(renewed.leaseUntil),
        );
      } finally {
        if (renewalUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = renewalUrl;
      }
      for (const duration of [9, 3601, 10.5]) {
        expect(
          (
            await client.callTool({
              name: 'renew_claim',
              arguments: {
                workId: claim.id,
                token: claim.token,
                leaseSeconds: duration,
              },
            })
          ).isError,
        ).toBe(true);
      }
      const result = await call('submit_result', {
        detail: 'full',
        workId: claim.id,
        token: claim.token,
        output: { number: 42 },
      });
      expect(result.run.status).toBe('completed');
      expect(
        (
          await client.callTool({
            name: 'renew_claim',
            arguments: { workId: claim.id, token: claim.token },
          })
        ).isError,
      ).toBe(true);
      const rpc = createClient(url);
      expect(
        (await rpc.runs.get.query({ id: started.run.id })).run.output,
      ).toEqual({ number: 42 });
      const dependentDefinition = blankDefinition();
      dependentDefinition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'workflow',
        label: 'Shared',
        workflowId: w.id,
        version: 1,
      });
      const dependent = engine.create('Dependent', '', dependentDefinition);
      engine.publish(dependent.id);
      await call('publish_workflow', { id: w.id, cascade: true });
      expect(engine.workflow(dependent.id).latestVersion).toBe(2);
      const dependentRun = await call('start_run', {
        detail: 'full',
        workflowId: dependent.id,
        input: {},
      });
      const [nested] = await call('list_work', {
        runId: dependentRun.run.id,
        fields: 'summary',
      });
      expect(nested).toMatchObject({
        workflowId: w.id,
        parentRunId: dependentRun.run.id,
        rootRunId: dependentRun.run.id,
        rootWorkflowId: dependent.id,
      });
      expect(
        await call('list_runs', { workflowId: w.id, limit: 1 }),
      ).toMatchObject([
        {
          id: nested.runId,
          parentRunId: dependentRun.run.id,
          rootRunId: dependentRun.run.id,
          rootWorkflowId: dependent.id,
        },
      ]);
      await call('cancel_run', { id: dependentRun.run.id });
      const definition = batchDefinition();
      const workflow = await call('create_workflow', {
        name: 'Batch transport',
        definition,
      });
      await call('publish_workflow', { id: workflow.id });
      const root = await call('start_run', {
        detail: 'full',
        workflowId: workflow.id,
        input: [3, 4],
      });
      const items = await call('list_work', {
        fields: 'full',
        runId: root.run.id,
      });
      expect(items.map((item: any) => item.input)).toEqual([3, 4]);
      const previousUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        await runCommand(['publish', w.id, '--cascade']);
        expect(engine.workflow(dependent.id).latestVersion).toBe(3);
        expect(await runCommand(['work', root.run.id])).toMatchObject(items);
        const summaries = await call('list_work', {
          runId: root.run.id,
          fields: 'summary',
        });
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
          workflowId: workflow.id,
          parentRunId: root.run.id,
          rootRunId: root.run.id,
          rootWorkflowId: workflow.id,
        });
        expect(await runCommand(['work', root.run.id, '--summary'])).toEqual(
          summaries,
        );
        expect(
          await runCommand(['runs', '--workflow', workflow.id, '--limit', '1']),
        ).toMatchObject([
          {
            rootRunId: root.run.id,
            rootWorkflowId: workflow.id,
            parentRunId: root.run.id,
          },
        ]);
        const detail = await runCommand(['run', items[0].runId]);
        expect(detail).toMatchObject({
          definition,
          run: { batchNodeId: 'batch' },
        });
      } finally {
        if (previousUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = previousUrl;
      }
      for (const item of items.reverse()) {
        const claimed = await call('claim_work', {
          workId: item.id,
          workerId: 'batch-mcp',
        });
        await call('submit_result', {
          detail: 'full',
          workId: item.id,
          token: claimed.token,
          output: item.input * 2,
        });
      }
      expect((await call('get_run', { id: root.run.id })).run.output).toEqual([
        6, 8,
      ]);
      const failed = await call('start_run', {
        detail: 'full',
        workflowId: workflow.id,
        input: [5],
      });
      const [assignment] = await call('list_work', {
        fields: 'full',
        runId: failed.run.id,
      });
      const failedClaim = await call('claim_work', {
        workId: assignment.id,
        workerId: 'retry-test',
      });
      await call('fail_work', {
        workId: assignment.id,
        token: failedClaim.token,
        error: 'Temporary executor failure',
      });
      expect((await call('get_run', { id: failed.run.id })).run.status).toBe(
        'failed',
      );
      await call('retry_run', { id: failed.run.id });
      const [retried] = await call('list_work', {
        fields: 'full',
        runId: failed.run.id,
      });
      const retriedClaim = await call('claim_work', {
        workId: retried.id,
        workerId: 'retry-test',
      });
      await call('submit_result', {
        detail: 'full',
        workId: retried.id,
        token: retriedClaim.token,
        output: 10,
      });
      expect((await call('get_run', { id: failed.run.id })).run.output).toEqual(
        [10],
      );
      // Budgets use the same discovery and operations over HTTP and stdio.
      for (const name of ['get_run_budget', 'set_run_budget'])
        expect(tools.map((t) => t.name)).toContain(name);
      expect(
        tools.find((t) => t.name === 'set_run_budget')!.inputSchema.required,
      ).toEqual(
        expect.arrayContaining(['runId', 'expectedRevision', 'budget']),
      );
      expect(
        tools.find((t) => t.name === 'start_run')!.inputSchema.properties,
      ).toHaveProperty('budget');
      const budgetWorkflow = engine.create(
        'Budget transport',
        '',
        batchDefinition(),
      );
      engine.publish(budgetWorkflow.id);
      const budgetPolicy = {
        scope: 'tree',
        unknownUsage: 'allow',
        limits: { claims: { max: 0 } },
      };
      const budgetStart = await call('start_run', {
        workflowId: budgetWorkflow.id,
        input: [1, 2],
        budget: budgetPolicy,
      });
      expect(budgetStart).toMatchObject({
        next: 'adjust_budget',
        nextWork: { total: 0 },
        budgetBlocked: { total: 2 },
        nextCall: { tool: 'get_run_briefing' },
      });
      expect(
        await call('get_run_budget', { runId: budgetStart.runId }),
      ).toEqual(
        await createClient(url).runs.budget.query({ runId: budgetStart.runId }),
      );
      expect(
        await call('list_work', { runId: budgetStart.runId }),
      ).toHaveLength(0);
      const blockedWork = (await call('get_run', { id: budgetStart.runId }))
        .descendantWork;
      expect(
        (
          await client.callTool({
            name: 'claim_work',
            arguments: { workId: blockedWork[0].id, workerId: 'budget' },
          })
        ).isError,
      ).toBe(true);
      await call('set_run_budget', {
        runId: budgetStart.runId,
        expectedRevision: 1,
        budget: { ...budgetPolicy, limits: { claims: { max: 1 } } },
      });
      const admissions = await Promise.all(
        blockedWork.map((w: any) =>
          client.callTool({
            name: 'claim_work',
            arguments: { workId: w.id, workerId: 'budget' },
          }),
        ),
      );
      expect(admissions.filter((r: any) => !r.isError)).toHaveLength(1);
      expect(
        (await call('get_run_budget', { runId: budgetStart.runId }))
          .governing[0],
      ).toMatchObject({ state: 'blocked', attempts: 1 });
      const budgetUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        expect(await runCommand(['budget', budgetStart.runId])).toMatchObject({
          revision: 2,
        });
        await runCommand([
          'set-budget',
          JSON.stringify({
            runId: budgetStart.runId,
            expectedRevision: 2,
            budget: null,
          }),
        ]);
        expect(
          await call('list_work', { runId: budgetStart.runId }),
        ).toHaveLength(1);
        expect(
          (
            await client.callTool({
              name: 'set_run_budget',
              arguments: {
                runId: budgetStart.runId,
                expectedRevision: 2,
                budget: budgetPolicy,
              },
            })
          ).isError,
        ).toBe(true);
        const cliWorkflow = engine.create('Budget CLI', '', blankDefinition());
        engine.publish(cliWorkflow.id);
        const cliStart: any = await runCommand([
          'start',
          cliWorkflow.id,
          '-1',
          '--summary',
          '--budget',
          JSON.stringify(budgetPolicy),
        ]);
        expect(cliStart).toMatchObject({
          next: 'adjust_budget',
          nextWork: { total: 0 },
        });
        expect(engine.run(cliStart.runId).input).toBe(-1);
        await call('cancel_run', { id: cliStart.runId });
      } finally {
        if (budgetUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = budgetUrl;
      }
      await call('cancel_run', { id: budgetStart.runId });
      const groupedDefinition = blankDefinition();
      const groupedNode = groupedDefinition.nodes[1];
      if (groupedNode.kind !== 'agent') throw new Error('Expected Agent');
      groupedNode.context.continuityGroup = 'author';
      const grouped = await call('create_workflow', {
        name: 'Grouped author',
        definition: groupedDefinition,
      });
      await call('publish_workflow', { id: grouped.id });
      const groupedRun = await call('start_run', {
        workflowId: grouped.id,
        input: {},
      });
      const groupedWork = groupedRun.nextWork.items[0];
      expect(groupedWork.context.continuityGroup).toBe('author');
      expect(groupedWork.continuity).toMatchObject({
        revision: 0,
        session: null,
      });
      const session = { executorId: 'transport', sessionId: 'author' };
      const replacement = { ...session, sessionId: 'replacement' };
      const claimWithoutSession = await client.callTool({
        name: 'claim_work',
        arguments: { workId: groupedWork.id, workerId: 'test' },
      });
      expect(claimWithoutSession.isError).toBe(true);
      const groupedClaim = await call('claim_work', {
        workId: groupedWork.id,
        workerId: 'test',
        session,
      });
      expect(groupedClaim.continuity).toMatchObject({ revision: 1, session });
      const handoff = {
        runId: groupedRun.runId,
        group: 'author',
        expectedRevision: 1,
        session: replacement,
        actor: 'test',
        reason: 'Session lost',
        checkpointRef: 'checkpoint.md',
      };
      expect(
        (
          await client.callTool({
            name: 'handoff_context_group',
            arguments: handoff,
          })
        ).isError,
      ).toBe(true);
      await call('fail_work', {
        workId: groupedWork.id,
        token: groupedClaim.token,
        error: 'Session lost',
      });
      expect(await call('handoff_context_group', handoff)).toMatchObject({
        revision: 2,
        applied: true,
      });
      expect(await call('handoff_context_group', handoff)).toMatchObject({
        revision: 2,
        applied: false,
      });
      const discovery = await call('list_work', { runId: groupedRun.runId });
      expect(discovery[0].continuity).toMatchObject({
        session: replacement,
        checkpointRef: 'checkpoint.md',
      });
      expect(
        (await call('get_run_briefing', { id: groupedRun.runId })).available
          .items[0].continuity.session,
      ).toEqual(replacement);
      const history = await call('get_context_group', {
        runId: groupedRun.runId,
        group: 'author',
        limit: 1,
      });
      expect(history).toMatchObject({ total: 2, nextOffset: 1 });
      expect(history.history[0].kind).toBe('claim');
      const priorUrl = process.env.INTERLOCK_URL;
      process.env.INTERLOCK_URL = url;
      try {
        expect(
          await runCommand([
            'context-group',
            groupedRun.runId,
            'author',
            '{"offset":1,"limit":1}',
          ]),
        ).toMatchObject({
          total: 2,
          history: [expect.objectContaining({ kind: 'handoff' })],
        });
        expect(
          await runCommand(['handoff-context', JSON.stringify(handoff)]),
        ).toMatchObject({ applied: false });
        const claimed = (await runCommand([
          'claim',
          groupedWork.id,
          'cli',
          JSON.stringify({ session: replacement }),
        ])) as any;
        expect(claimed.continuity.session).toEqual(replacement);
        await call('submit_result', {
          workId: claimed.id,
          token: claimed.token,
          output: {},
        });
      } finally {
        if (priorUrl === undefined) delete process.env.INTERLOCK_URL;
        else process.env.INTERLOCK_URL = priorUrl;
      }
      for (const name of ['get_context_group', 'handoff_context_group'])
        expect(tools.some((t) => t.name === name)).toBe(true);
      expect(
        tools.find((t) => t.name === 'claim_work')?.inputSchema.properties,
      ).toHaveProperty('session');
      console.log(
        `${mode}: ${tools.length} MCP tools, ${Buffer.byteLength(JSON.stringify(tools))} B definitions`,
      );
      const invalidRetry = await client.callTool({
        name: 'retry_run',
        arguments: { id: failed.run.id },
      });
      expect(invalidRetry.isError).toBe(true);
      expect(
        (
          await fetch(`${url}/health`, {
            headers: { origin: 'https://untrusted.example' },
          })
        ).status,
      ).toBe(403);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      engine.stop();
      store.close();
    }
  },
);

it('validates HTTP MCP requests and preserves local-access and body limits', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  const app = createApp(engine);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  const message = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'http-validation', version: '1.0.0' },
    },
  };
  const request = (body: unknown, extra: Record<string, string> = {}) =>
    app.request('http://127.0.0.1:4310/mcp', {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  try {
    const initialized = await request(message);
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('content-type')).toContain(
      'application/json',
    );
    expect(initialized.headers.has('mcp-session-id')).toBe(false);
    expect(await initialized.json()).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'interlock' } },
    });
    expect(
      (await request({ jsonrpc: '2.0', method: 'notifications/initialized' }))
        .status,
    ).toBe(202);
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const response = await app.request('http://127.0.0.1:4310/mcp', {
        method,
      });
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    }
    expect(
      (await request(message, { origin: 'https://untrusted.example' })).status,
    ).toBe(403);
    expect(
      (
        await app.request('http://untrusted.example/mcp', {
          method: 'POST',
          headers,
          body: JSON.stringify(message),
        })
      ).status,
    ).toBe(403);
    expect(
      (await request(message, { origin: 'http://127.0.0.1:4310' })).status,
    ).toBe(200);
    expect((await request(message, { accept: 'text/html' })).status).toBe(406);
    expect(
      (await request(message, { 'content-type': 'text/plain' })).status,
    ).toBe(415);
    expect(
      (
        await app.request('http://127.0.0.1:4310/mcp', {
          method: 'POST',
          headers,
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          {
            'mcp-protocol-version': 'unsupported',
          },
        )
      ).status,
    ).toBe(400);
    expect((await request('x'.repeat(2 * 1024 * 1024))).status).toBe(413);
    // Independent clients can reuse JSON-RPC IDs without sharing a transport.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        id: 1,
        result: { tools: expect.any(Array) },
      });
    }
  } finally {
    engine.stop();
    store.close();
  }
});
