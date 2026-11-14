#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

function sessionFilePath(workId) {
  return join(tmpdir(), `custom-harness-session-${workId}.json`);
}

function readSession(workId) {
  try {
    return JSON.parse(readFileSync(sessionFilePath(workId), 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Pull transport: perform one operation Interlock queued and return the
 * result to report. A redelivered launch (same idempotencyKey) returns the
 * session it already created instead of starting a second one.
 */
function handlePullOperation(kind, payload) {
  const workId = payload.workId;
  const session = readSession(workId);
  switch (kind) {
    case 'launch': {
      if (session?.idempotencyKey !== payload.idempotencyKey)
        writeFileSync(
          sessionFilePath(workId),
          JSON.stringify({
            workId,
            runId: payload.runId,
            idempotencyKey: payload.idempotencyKey,
            claimTicket: payload.claimTicket,
            status: 'working',
            launchedAt: new Date().toISOString(),
          }),
        );
      return { sessionHandle: `launcher-sess-${workId}` };
    }
    case 'status':
      return { state: session?.status ?? 'ended' };
    case 'message':
      return { delivered: Boolean(session) };
    case 'stop':
      if (session)
        writeFileSync(
          sessionFilePath(workId),
          JSON.stringify({ ...session, status: 'ended' }),
        );
      return { stopped: true };
    case 'archive':
      if (session) unlinkSync(sessionFilePath(workId));
      return { archived: true };
    default:
      throw new Error(`Unknown operation: ${kind}`);
  }
}

/**
 * One poll cycle against Interlock's HTTP API: lease operations, perform
 * them, and report each result. `report: false` simulates a client that dies
 * after acting but before reporting. The contract tests import it.
 * @public
 */
export async function pullOnce({
  baseUrl,
  profileId,
  credential,
  clientId,
  apiToken,
  waitMs = 20000,
  report = true,
  fetch = globalThis.fetch,
}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Interlock-Launcher-Credential': credential,
    ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
  };
  const base = `${baseUrl}/api/launchers/${encodeURIComponent(profileId)}`;
  const response = await fetch(`${base}/poll`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId, waitMs, limit: 5 }),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), body);
  for (const op of body.operations) {
    let outcome;
    try {
      outcome = {
        action: 'complete',
        body: { result: handlePullOperation(op.kind, op.payload) },
      };
    } catch (error) {
      outcome = {
        action: 'fail',
        body: { error: String(error.message ?? error), retryable: false },
      };
    }
    if (!report) continue;
    await fetch(`${base}/operations/${op.operationId}/${outcome.action}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ leaseToken: op.leaseToken, ...outcome.body }),
    });
  }
  return body.operations;
}

const main =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const mode = main ? (process.argv[2] ?? '--turn') : undefined;

switch (mode) {
  case undefined:
    break;

  case 'pull': {
    // Poll until stopped: node custom-harness-reference.js pull
    const options = {
      baseUrl: process.env.INTERLOCK_URL ?? 'http://127.0.0.1:4310',
      profileId: process.env.INTERLOCK_LAUNCHER_PROFILE,
      credential: process.env.INTERLOCK_LAUNCHER_CREDENTIAL,
      clientId: process.env.INTERLOCK_LAUNCHER_CLIENT_ID ?? 'reference',
      apiToken: process.env.INTERLOCK_API_TOKEN,
    };
    for (;;) {
      try {
        await pullOnce(options);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  case '--turn': {
    const raw = readStdin();
    let payload = {};
    try {
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {}

    const result = {
      output: {
        handled: true,
        echo: payload.input ?? null,
        workId: payload.workId ?? process.env.INTERLOCK_WORK_ID ?? '',
      },
      sessionId: payload.sessionId || 'session-ref-turn-001',
      model: payload.model || 'custom-reference-model',
      provider: 'custom-ref',
      usage: [
        {
          provider: 'custom-ref',
          model: 'custom-reference-model',
          inputTokens: 12,
          outputTokens: 34,
        },
      ],
    };

    process.stdout.write(JSON.stringify(result));
    process.exit(0);
    break;
  }

  case 'launch': {
    const raw = readStdin();
    let payload = {};
    try {
      if (raw.trim()) payload = JSON.parse(raw);
    } catch {}

    const workId = payload.workId || process.env.INTERLOCK_WORK_ID || 'default';
    const state = {
      workId,
      runId: payload.runId || process.env.INTERLOCK_RUN_ID,
      claimTicket: payload.claimTicket || process.env.INTERLOCK_CLAIM_TICKET,
      status: 'working',
      launchedAt: new Date().toISOString(),
    };
    writeFileSync(sessionFilePath(workId), JSON.stringify(state));

    const result = {
      sessionId: `launcher-sess-${workId}`,
      handle: `proc-${process.pid}`,
    };
    process.stdout.write(JSON.stringify(result));
    process.exit(0);
    break;
  }

  case 'status': {
    const workId =
      process.argv[3] || process.env.INTERLOCK_WORK_ID || 'default';
    const file = sessionFilePath(workId);
    let status = 'working';
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf-8'));
        status = data.status || 'working';
      } catch {}
    }
    process.stdout.write(JSON.stringify({ status }));
    process.exit(0);
    break;
  }

  case 'set-status': {
    const workId =
      process.argv[3] || process.env.INTERLOCK_WORK_ID || 'default';
    const newStatus = process.argv[4] || 'idle';
    const file = sessionFilePath(workId);
    let data = { workId };
    if (existsSync(file)) {
      try {
        data = JSON.parse(readFileSync(file, 'utf-8'));
      } catch {}
    }
    data.status = newStatus;
    writeFileSync(file, JSON.stringify(data));
    process.stdout.write(JSON.stringify({ ok: true, status: newStatus }));
    process.exit(0);
    break;
  }

  case 'message': {
    const raw = readStdin();
    process.stdout.write(JSON.stringify({ delivered: true, input: raw }));
    process.exit(0);
    break;
  }

  case 'stop': {
    const workId =
      process.argv[3] || process.env.INTERLOCK_WORK_ID || 'default';
    const file = sessionFilePath(workId);
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf-8'));
        data.status = 'ended';
        writeFileSync(file, JSON.stringify(data));
      } catch {}
    }
    process.stdout.write(JSON.stringify({ stopped: true }));
    process.exit(0);
    break;
  }

  case 'archive': {
    const workId =
      process.argv[3] || process.env.INTERLOCK_WORK_ID || 'default';
    const file = sessionFilePath(workId);
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {}
    }
    process.stdout.write(JSON.stringify({ archived: true }));
    process.exit(0);
    break;
  }

  default: {
    process.stderr.write(`Unknown mode: ${mode}\n`);
    process.exit(1);
  }
}
