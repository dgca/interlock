import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';

export async function detectExecutable(name: string, override?: string) {
  const candidates = override
    ? [override]
    : (process.env.PATH ?? '')
        .split(delimiter)
        .filter(Boolean)
        .map((p) => join(p, name));
  let command: string | undefined;
  for (const p of candidates) {
    try {
      await access(p, constants.X_OK);
      command = p;
      break;
    } catch {}
  }
  if (!command)
    return {
      status: 'missing' as const,
      message: `${name} was not found. Install it or choose an absolute executable path.`,
    };
  try {
    const version = await new Promise<string>((resolve, reject) => {
      const child = spawn(command!, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });
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
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private closePromise: Promise<void>;
  private failed?: Error;
  onMessage: (message: any) => void = () => {};
  constructor(command: string, args: string[], cwd: string) {
    this.child = spawn(command, args, {
      cwd,
      env: process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) {
        this.fail(new Error('Harness protocol message exceeded 2 MiB'));
        void this.close();
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
            typeof msg.id === 'number' &&
            !msg.method &&
            this.pending.has(msg.id)
          ) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            msg.error
              ? p.reject(
                  new Error(
                    String(msg.error.message ?? 'Harness request failed').slice(
                      0,
                      2000,
                    ),
                  ),
                )
              : p.resolve(msg.result);
          } else this.onMessage(msg);
        } catch (error) {
          this.fail(
            error instanceof Error
              ? error
              : new Error('Invalid harness protocol'),
          );
          void this.close();
        }
      }
    });
    // Drain diagnostics without retaining arbitrary environment values or credentials.
    this.child.stderr.resume();
    this.child.on('error', (error) => this.fail(error));
    this.closePromise = new Promise((resolve) =>
      this.child.on('close', (code) => {
        this.closed = true;
        this.fail(new Error(`Harness process ended (${code ?? 'signal'})`));
        resolve();
      }),
    );
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
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Harness did not answer ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  ended() {
    return this.closePromise.then(() => {
      throw this.failed ?? new Error('Harness process ended');
    });
  }
  async close() {
    if (this.closed) return;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (this.child.pid) process.kill(-this.child.pid, signal);
      } catch {
        this.child.kill(signal);
      }
    };
    kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 2000);
    await this.closePromise;
    clearTimeout(timer);
  }
}
