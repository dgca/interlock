import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  mkdirSync,
  lstatSync,
  statSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import type { Store } from './index.js';

export interface BackgroundJob {
  id: string;
  runId: string;
  token: string;
  createdAt: string;
}
export interface SupervisorReceipt {
  pid: number;
  start: string;
  progress?: string;
  outcome?: { output?: unknown; error?: string };
}
/** Local spool persistence. Raw process data is always encrypted before touching disk. */
export class BackgroundFiles {
  constructor(private store: Store) {}
  directory(id: string) {
    if (this.store.path === ':memory:')
      throw new Error('Background Scripts require a file-backed database');
    if (!/^[a-zA-Z0-9-]+$/.test(id))
      throw new Error('Invalid background execution ID');
    return join(resolve(this.store.path) + '.scripts', id);
  }
  private secureDirectory(path: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      stat.uid !== process.getuid?.()
    )
      throw new Error(
        'Background Script directory must be owned by this user with mode 0700',
      );
  }
  create(runId: string, id: string): BackgroundJob {
    const directory = this.directory(id);
    this.secureDirectory(resolve(this.store.path) + '.scripts');
    this.secureDirectory(directory);
    const job = {
      id,
      runId,
      token: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.store.protectedValues.write(
      `script:${id}`,
      'secret',
      1,
      randomBytes(32).toString('base64'),
    );
    this.store.put('backgroundJobs', job);
    return job;
  }
  key(job: BackgroundJob) {
    return this.store.protectedValues.read(`script:${job.id}`, 'secret', 1);
  }
  aad(job: BackgroundJob, file: string) {
    return JSON.stringify([job.runId, job.id, job.token, file]);
  }
  read(job: BackgroundJob, file: string): SupervisorReceipt | undefined {
    const path = join(this.directory(job.id), file);
    let data: string;
    try {
      if (statSync(path).size > 16 * 1024 * 1024) throw new Error();
      data = readFileSync(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('Background receipt unavailable');
    }
    try {
      if (Buffer.byteLength(data) > 16 * 1024 * 1024) throw new Error();
      const value = JSON.parse(data);
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.key(job), 'base64'),
        Buffer.from(value.nonce, 'base64'),
      );
      decipher.setAAD(Buffer.from(this.aad(job, file)));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(value.data, 'base64')),
          decipher.final(),
        ]).toString(),
      );
    } catch {
      throw new Error(
        'Background receipt could not be authenticated; inspect the original process before recovery',
      );
    }
  }
  stop(job: BackgroundJob) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.key(job), 'base64'),
      nonce,
    );
    cipher.setAAD(Buffer.from(this.aad(job, 'stop')));
    const data = Buffer.concat([
      cipher.update(JSON.stringify({ stop: true })),
      cipher.final(),
    ]);
    const path = join(this.directory(job.id), 'stop');
    const temporary = path + '.' + randomUUID();
    writeFileSync(
      temporary,
      JSON.stringify({
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    const fd = openSync(temporary, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  }
}
