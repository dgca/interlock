import { createServer, type ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { blankDefinition } from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { nativeAdapters } from '../packages/runtime/src/executors/native';
import { workflowCall } from './fixtures/detached';

const engines: Engine[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) {
    await e.executors.stop();
    e.stop();
    e.store.close();
  }
});

it.each(['pending', 'unclaimed', 'claimed'] as const)(
  'stops a real delegated HTTP launcher cancelled while %s and blocks teardown until exact stopped reconciliation',
  async (phase) => {
    let launchResponse: ServerResponse | undefined,
      stopResponse: ServerResponse | undefined;
    let payload:
      { workId: string; runId: string; claimTicket: string } | undefined;
    const stops: unknown[] = [];
    const remote = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        if (req.url === '/launch') {
          payload = JSON.parse(body);
          launchResponse = res;
          if (phase !== 'pending') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ sessionId: 'remote-session' }));
          }
        } else if (req.url === '/stop') {
          stops.push(JSON.parse(body));
          stopResponse = res;
        } else {
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) =>
      remote.listen(0, '127.0.0.1', resolve),
    );
    const address = remote.address();
    if (!address || typeof address === 'string') throw new Error('No listener');
    const url = `http://127.0.0.1:${address.port}`;
    const e = new Engine(new Store(':memory:'), process.cwd());
    engines.push(e);
    const publish = (definition = blankDefinition()) => {
      const w = e.create('Launcher tree', '', definition);
      e.publish(w.id);
      return w.id;
    };
    try {
      e.executors.saveProfile({
        id: 'launcher',
        harness: 'custom',
        name: 'Remote',
        enabled: true,
        expectedRevision: 0,
        mode: 'launcher',
        transport: 'http',
        launchUrl: url + '/launch',
        stopUrl: url + '/stop',
      });
      e.executors.start(nativeAdapters);
      const d = blankDefinition();
      d.executor = 'launcher';
      const root = e.start(
        publish(workflowCall(publish(d), 'detached')),
        null,
      ).run;
      await vi.waitFor(() => expect(payload).toBeDefined());
      let claim: ReturnType<Engine['claim']> | undefined;
      if (phase !== 'pending')
        await vi.waitFor(() =>
          expect(e.executors.inspect(payload!.workId).items[0]?.state).toBe(
            'running',
          ),
        );
      if (phase === 'claimed')
        claim = e.claim(payload!.workId, {
          workerId: 'remote',
          freshContext: false,
          tools: [],
          skills: [],
          claimTicket: payload!.claimTicket,
        });
      const count = e.store.runs().length;
      e.cancelRunTree({
        id: root.id,
        includeDetached: true,
        reason: 'Stop remote tree',
      });
      expect(e.quiescence(root.id).quiescent).toBe(false);
      if (phase === 'pending') {
        expect(
          e
            .quiescence(root.id)
            .blockers.items.some((x) => x.kind === 'managed_execution'),
        ).toBe(true);
        expect(stops).toHaveLength(0);
        launchResponse!.setHeader('Content-Type', 'application/json');
        launchResponse!.end(JSON.stringify({ sessionId: 'remote-session' }));
      }
      await vi.waitFor(() => expect(stops).toHaveLength(1));
      const record = e.executors
        .inspect(payload!.workId)
        .items.find((x) => x.state === 'interrupted')!;
      expect(record).toBeDefined();
      expect(() => e.executors.confirmStopped(record.id, true)).toThrow(
        'still stopping',
      );
      expect(() =>
        e.claim(payload!.workId, {
          workerId: 'late',
          freshContext: false,
          tools: [],
          skills: [],
          claimTicket: payload!.claimTicket,
        }),
      ).toThrow();
      if (claim)
        expect(() => e.submit(claim!.id, claim!.token!, null)).toThrow();
      stopResponse!.end('{}');
      await vi.waitFor(() =>
        expect(() => e.executors.confirmStopped(record.id, true)).not.toThrow(),
      );
      expect(e.quiescence(root.id).quiescent).toBe(true);
      e.pump();
      expect(e.store.runs()).toHaveLength(count);
      expect(e.run(payload!.runId).status).toBe('cancelled');
    } finally {
      launchResponse?.end('{}');
      stopResponse?.end('{}');
      remote.closeAllConnections();
      await new Promise<void>((resolve) => remote.close(() => resolve()));
    }
  },
);
