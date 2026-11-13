import { spawn, execFileSync } from 'node:child_process';
import {
  BackgroundFiles,
  type BackgroundJob,
  type Store,
  type SupervisorReceipt,
} from '@interlock/storage';
import {
  jsonSchema,
  type NodeExecution,
  type Run,
  type Json,
} from '@interlock/core';
import { secretRedaction } from './secretRedaction.js';
import { scriptSupervisorSource } from './scriptSupervisor.js';
import { javascriptRunner } from './scripts.js';
function boundedProgress(text: string) {
  return Buffer.from(text).subarray(-8189).toString('utf8');
}

export class UncertainScript extends Error {}
export class BackgroundScripts {
  readonly files: BackgroundFiles;
  constructor(private store: Store) {
    this.files = new BackgroundFiles(store);
  }
  prepare(run: Run, execution: NodeExecution, timeoutMs: number) {
    this.files.create(run.id, execution.id);
    execution.background = {
      state: 'launching',
      deadline: new Date(Date.now() + timeoutMs).toISOString(),
    };
    this.store.put('runs', run);
  }
  private job(runId: string, executionId: string) {
    const job = this.store.get<BackgroundJob>('backgroundJobs', executionId);
    if (!job || job.runId !== runId)
      throw new UncertainScript(
        'Background launch record is missing or mismatched',
      );
    return job;
  }
  private identity(job: BackgroundJob, receipt: SupervisorReceipt) {
    if (
      !Number.isSafeInteger(receipt.pid) ||
      receipt.pid <= 0 ||
      !receipt.start
    )
      return false;
    try {
      const start = execFileSync(
        '/bin/ps',
        ['-p', String(receipt.pid), '-o', 'lstart='],
        {
          encoding: 'utf8',
          env: { ...process.env, LC_ALL: 'C' },
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      const command = execFileSync(
        '/bin/ps',
        ['-p', String(receipt.pid), '-ww', '-o', 'command='],
        {
          encoding: 'utf8',
          env: { ...process.env, LC_ALL: 'C' },
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      return (
        start === receipt.start &&
        command.includes(`interlock-script-supervisor ${job.token}`)
      );
    } catch {
      return false;
    }
  }
  private receipt(job: BackgroundJob, name: string) {
    try {
      const value = this.files.read(job, name);
      if (
        value &&
        (!Number.isSafeInteger(value.pid) ||
          value.pid <= 0 ||
          typeof value.start !== 'string' ||
          !value.start ||
          (value.progress !== undefined &&
            typeof value.progress !== 'string') ||
          (name === 'result' &&
            (!value.outcome ||
              typeof value.outcome !== 'object' ||
              (typeof value.outcome.error !== 'string' &&
                !Object.hasOwn(value.outcome, 'output')))))
      )
        throw new Error('Invalid supervisor receipt');
      return value;
    } catch {
      throw new UncertainScript(
        'Background receipt unavailable or unauthenticated. Inspect processes and effects, then explicitly reconcile stopped before retrying.',
      );
    }
  }
  launch(
    run: Run,
    execution: NodeExecution,
    command: string,
    input: Json,
    cwd: string,
    language: 'bash' | 'javascript' | undefined,
    env: NodeJS.ProcessEnv,
    hasSecrets: boolean,
    /** Removed by the supervisor when the Script ends. */
    provenanceFile?: string,
  ) {
    const job = this.job(run.id, execution.id);
    const key = this.files.key(job);
    const child = spawn(
      process.execPath,
      [
        '--input-type=commonjs',
        '-e',
        scriptSupervisorSource,
        '--',
        'interlock-script-supervisor',
        job.token,
      ],
      { detached: true, stdio: ['pipe', 'ignore', 'ignore'], cwd },
    );
    child.stdin.on('error', () => {});
    // Errors leave the launch intent uncertain, never eligible for an automatic second launch.
    child.on('error', () => {});
    child.stdin.end(
      JSON.stringify({
        ...job,
        directory: this.files.directory(job.id),
        key,
        deadline: Date.parse(execution.background!.deadline),
        cwd,
        executable: language === 'javascript' ? process.execPath : '/bin/bash',
        args:
          language === 'javascript'
            ? ['--input-type=commonjs', '-e', javascriptRunner(command)]
            : ['-c', command],
        input,
        env,
        hasSecrets,
        provenanceFile,
      }),
    );
    child.unref();
  }
  async monitor(
    run: Run,
    execution: NodeExecution,
    secrets: string[],
    signal: AbortSignal,
    onProgress: (receipt: SupervisorReceipt) => void,
  ): Promise<Json> {
    const job = this.job(run.id, execution.id);
    const redact = secretRedaction(secrets);
    let verifiedAt = 0;
    while (!signal.aborted) {
      const result = this.receipt(job, 'result');
      if (result) {
        if (
          !result.outcome ||
          !Number.isSafeInteger(result.pid) ||
          !result.start ||
          (execution.background?.supervisorPid !== undefined &&
            (execution.background.supervisorPid !== result.pid ||
              execution.background.supervisorStart !== result.start))
        )
          throw new UncertainScript('Background result identity is invalid');
        onProgress({
          ...result,
          progress: boundedProgress(redact.text(result.progress ?? '')),
        });
        if (result.outcome.error)
          throw new Error(
            boundedProgress(
              redact.text(
                result.outcome.error +
                  (result.outcome.error.startsWith('Script exited ')
                    ? ': ' + (result.progress ?? '')
                    : ''),
              ),
            ),
          );
        if (!Object.hasOwn(result.outcome, 'output'))
          throw new UncertainScript('Background result is incomplete');
        try {
          return redact.json(jsonSchema.parse(result.outcome.output));
        } catch {
          throw new Error('Script stdout must contain one JSON value');
        }
      }
      const identity = this.receipt(job, 'identity');
      if (identity) {
        if (
          (execution.background?.supervisorPid !== undefined &&
            (execution.background.supervisorPid !== identity.pid ||
              execution.background.supervisorStart !== identity.start)) ||
          (Date.now() - verifiedAt >= 1000 && !this.identity(job, identity))
        ) {
          // Final receipt may have been renamed between the first read and process exit.
          if (this.receipt(job, 'result')) continue;
          throw new UncertainScript(
            'Background supervisor identity cannot be verified. Inspect processes and effects, then reconcile stopped before retrying.',
          );
        }
        if (Date.now() - verifiedAt >= 1000) verifiedAt = Date.now();
        const progress = this.receipt(job, 'progress') ?? identity;
        onProgress({
          ...identity,
          progress: boundedProgress(redact.text(progress.progress ?? '')),
        });
      } else if (Date.now() - Date.parse(job.createdAt) > 5000) {
        throw new UncertainScript(
          'Background supervisor launch is uncertain. Inspect processes and effects, then reconcile stopped before retrying.',
        );
      }
      await new Promise<void>((resolve) => {
        const abort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, 100);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    throw new Error('Background monitor disconnected');
  }
  snapshot(run: Run, execution: NodeExecution, secrets: string[]) {
    const job = this.job(run.id, execution.id);
    let result = this.receipt(job, 'result');
    let receipt = result ?? this.receipt(job, 'identity');
    if (receipt && !result && !this.identity(job, receipt)) {
      result = this.receipt(job, 'result');
      if (!result)
        throw new UncertainScript(
          'Background supervisor identity cannot be verified',
        );
      receipt = result;
    }
    if (
      receipt &&
      execution.background?.supervisorPid !== undefined &&
      (receipt.pid !== execution.background.supervisorPid ||
        receipt.start !== execution.background.supervisorStart)
    )
      throw new UncertainScript('Background supervisor identity changed');
    if (!receipt) {
      if (Date.now() - Date.parse(job.createdAt) > 5000)
        throw new UncertainScript('Background supervisor launch is uncertain');
      return;
    }
    const progress = result ?? this.receipt(job, 'progress') ?? receipt;
    return {
      ...execution.background!,
      state: result ? ('completed' as const) : ('running' as const),
      supervisorPid: receipt.pid,
      supervisorStart: receipt.start,
      progress: boundedProgress(
        secretRedaction(secrets).text(progress.progress ?? ''),
      ),
    };
  }
  stop(runId: string, executionId: string) {
    const job = this.job(runId, executionId);
    if (this.receipt(job, 'result')) return;
    const identity = this.receipt(job, 'identity');
    if (!identity && Date.now() - Date.parse(job.createdAt) <= 5000) {
      this.files.stop(job);
      return;
    }
    if (!identity || !this.identity(job, identity)) {
      if (this.receipt(job, 'result')) return;
      throw new UncertainScript(
        'Cannot stop an unverified background supervisor. Inspect processes and explicitly reconcile stopped.',
      );
    }
    this.files.stop(job);
  }
}
