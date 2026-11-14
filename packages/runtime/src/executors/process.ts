import { spawn, execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { HarnessRequestError } from './contracts.js';

/** Own the process group, including children that outlive its original leader. */
export function spawnManagedProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: 'pipe',
  });
  const exited = new Promise<void>((resolve) =>
    child.once('close', () => resolve()),
  );
  let closing: Promise<void> | undefined;
  const membersCanAct = async () => {
    const { stdout } = await promisify(execFile)(
      'ps',
      ['-A', '-o', 'pid=,pgid=,stat='],
      { timeout: 1000, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.split('\n').some((line) => {
      const [, group, state] = line.trim().split(/\s+/);
      return Number(group) === child.pid && !state?.startsWith('Z');
    });
  };
  const groupAlive = async (inspectMembers = false) => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return inspectMembers ? membersCanAct() : true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        // Darwin may report EPERM for a departed group. Zombie members cannot act.
        return membersCanAct();
      }
      throw error;
    }
  };
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  return {
    child,
    close: () =>
      (closing ??= (async () => {
        if (await groupAlive()) kill('SIGTERM');
        const deadline = Date.now() + 2000;
        while ((await groupAlive()) && Date.now() < deadline) await delay(25);
        if (await groupAlive()) kill('SIGKILL');
        const finalDeadline = Date.now() + 1000;
        while ((await groupAlive(true)) && Date.now() < finalDeadline)
          await delay(25);
        if (await groupAlive(true))
          throw new Error(
            'Harness subprocess termination could not be confirmed',
          );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            exited,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error('Harness process streams did not close')),
                1000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })()),
  };
}

export function findExecutable(name: string, override?: string) {
  const candidates = override
    ? [override]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((p) => join(p, name));
  for (const p of candidates) {
    try {
      accessSync(p, constants.X_OK);
      if (statSync(p).isFile()) return p;
    } catch {}
  }
}

export async function detectExecutable(name: string, override?: string) {
  const command = findExecutable(name, override);
  if (!command)
    return {
      status: 'missing' as const,
      message: `${name} was not found. Install it or choose an absolute executable path.`,
    };
  try {
    const managed = spawnManagedProcess(command, ['--version']);
    let version: string;
    try {
      version = await new Promise<string>((resolve, reject) => {
        const child = managed.child;
        child.stdin.end();
        child.stderr.resume();
        let text = '';
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Version check timed out'));
        }, 5000);
        child.stdout.on('data', (c) => {
          text = (text + c.toString()).slice(0, 4096);
        });
        child.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve(text.trim().split('\n')[0].slice(0, 200))
            : reject(new Error('Executable did not pass its version check'));
        });
      });
    } finally {
      await managed.close();
    }
    return { status: 'detected' as const, command, version };
  } catch (error) {
    return {
      status: 'unavailable' as const,
      command,
      message:
        error instanceof Error ? error.message : 'Executable check failed',
    };
  }
}

/** Bounded JSON-lines transport. It never interprets terminal prompts or uses a shell. */
export class JsonLinesProcess {
  private child;
  private process;
  private sequence = 0;
  private pending = new Map<
    number | string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private exitPromise: Promise<void>;
  private failed?: Error;
  onMessage: (message: any) => void = () => {};
  constructor(
    command: string,
    args: string[],
    cwd: string,
    private protocol: 'json-rpc' | 'pi' = 'json-rpc',
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.process = spawnManagedProcess(command, args, { cwd, env });
    this.child = this.process.child;
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        this.fail(new Error('Harness protocol message exceeded 2 MiB'));
        void this.close().catch(() => {});
        return;
      }
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (
            (this.protocol === 'pi' ? msg.type === 'response' : !msg.method) &&
            this.pending.has(msg.id)
          ) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            msg.error || msg.success === false
              ? p.reject(
                  new HarnessRequestError(
                    String(
                      msg.error?.message ??
                        msg.error ??
                        'Harness request failed',
                    ).slice(0, 2000),
                  ),
                )
              : p.resolve(this.protocol === 'pi' ? msg.data : msg.result);
          } else this.onMessage(msg);
        } catch (error) {
          this.fail(
            error instanceof Error
              ? error
              : new Error('Invalid harness protocol'),
          );
          void this.close().catch(() => {});
        }
      }
    });
    // Drain diagnostics without retaining arbitrary environment values or credentials.
    this.child.stderr.resume();
    this.child.on('error', (error) => this.fail(error));
    this.exitPromise = new Promise((resolve) => {
      this.child.once('exit', (code) => {
        this.closed = true;
        this.fail(new Error(`Harness process ended (${code ?? 'signal'})`));
        resolve();
      });
      this.child.once('error', () => resolve());
    });
    this.child.stdin.on('error', (error) => this.fail(error));
  }
  private fail(error: Error) {
    this.failed ??= error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  send(message: unknown) {
    if (this.failed || this.closed)
      throw this.failed ?? new Error('Harness process closed');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
    const sequence = ++this.sequence;
    const id = this.protocol === 'pi' ? String(sequence) : sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Harness did not answer ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(
          this.protocol === 'pi'
            ? { ...(params as object), id, type: method }
            : { id, method, params },
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  ended() {
    return this.exitPromise.then(() => {
      throw this.failed ?? new Error('Harness process ended');
    });
  }
  async close() {
    await this.process.close();
  }
}
