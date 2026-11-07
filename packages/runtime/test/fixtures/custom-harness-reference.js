#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mode = process.argv[2] ?? '--turn';

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

switch (mode) {
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
