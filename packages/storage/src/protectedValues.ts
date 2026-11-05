import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { InterlockError, type VariableKind } from '@interlock/core';

interface Documents {
  get<T>(collection: string, id: string): T | undefined;
  put(collection: string, value: { id: string }): void;
  list<T>(collection: string): T[];
}
interface Vault {
  id: string;
  vaultId: string;
  check?: { nonce: string; tag: string };
}
interface Envelope {
  id: string;
  variableId: string;
  valueRevision: number;
  kind: VariableKind;
  vaultId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
/** Keys are deliberately excluded from SQLite and portable workflow data. */
export class ProtectedValues {
  private memoryKey?: Buffer;
  constructor(
    private documents: Documents,
    private database: string,
    private configuredKeyFile?: string,
  ) {}
  private failure() {
    return new InterlockError(
      'Protected variable store unavailable. Restore its original owner-only key file, check INTERLOCK_SECRET_KEY_FILE, and retry. Stored values were not changed.',
    );
  }
  private keyPath(vaultId: string) {
    const base =
      process.platform === 'darwin'
        ? join(homedir(), 'Library/Application Support/Interlock')
        : join(
            process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
            'interlock',
          );
    return this.configuredKeyFile ?? join(base, 'keys', `${vaultId}.key`);
  }
  info() {
    const vault = this.documents.get<{ vaultId: string }>(
      'variableVault',
      'default',
    );
    return {
      vaultId: vault?.vaultId ?? null,
      keyFile:
        vault && (this.database !== ':memory:' || this.configuredKeyFile)
          ? this.keyPath(vault.vaultId)
          : null,
    };
  }
  private key(vaultId: string, create: boolean): Buffer {
    if (this.database === ':memory:' && !this.configuredKeyFile) {
      if (!this.memoryKey && create) this.memoryKey = randomBytes(32);
      if (!this.memoryKey) throw this.failure();
      return this.memoryKey;
    }
    const path = this.keyPath(vaultId);
    if (!isAbsolute(path) || path === this.database) throw this.failure();
    if (create) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      let fd: number | undefined;
      try {
        fd = openSync(
          path,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        writeFileSync(fd, randomBytes(32));
        fsyncSync(fd);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          throw this.failure();
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    let fd: number | undefined;
    try {
      fd = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.size !== 32 ||
        (info.mode & 0o077) !== 0 ||
        (process.getuid && info.uid !== process.getuid())
      )
        throw this.failure();
      return readFileSync(fd);
    } catch {
      throw this.failure();
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  private aad(
    e: Pick<Envelope, 'vaultId' | 'variableId' | 'kind' | 'valueRevision'>,
  ) {
    return Buffer.from(
      JSON.stringify([e.vaultId, e.variableId, e.kind, e.valueRevision]),
    );
  }
  private vaultAad(vaultId: string) {
    return Buffer.from(
      JSON.stringify(['interlock-variable-vault-v1', vaultId]),
    );
  }
  private verifier(vaultId: string, key: Buffer): NonNullable<Vault['check']> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(this.vaultAad(vaultId));
    cipher.final();
    return {
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }
  private decrypt(e: Envelope, key: Buffer): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(e.nonce, 'base64'),
      { authTagLength: 16 },
    );
    decipher.setAAD(this.aad(e));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(e.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
  private verify(vault: Vault, key: Buffer) {
    try {
      if (!vault.check) {
        // Readable pre-release vaults gain a persistent verifier on their next write.
        const existing = this.documents
          .list<Envelope>('variableValues')
          .find((e) => e.vaultId === vault.vaultId);
        if (!existing) throw this.failure();
        this.decrypt(existing, key);
        return;
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(vault.check.nonce, 'base64'),
        { authTagLength: 16 },
      );
      decipher.setAAD(this.vaultAad(vault.vaultId));
      decipher.setAuthTag(Buffer.from(vault.check.tag, 'base64'));
      decipher.final();
    } catch {
      throw this.failure();
    }
  }
  write(
    variableId: string,
    kind: VariableKind,
    valueRevision: number,
    value: string,
  ) {
    const old = this.documents.get<Vault>('variableVault', 'default');
    const vaultId = old?.vaultId ?? randomUUID();
    const key = this.key(vaultId, !old);
    if (old) this.verify(old, key);
    const nonce = randomBytes(12);
    const e = {
      id: `${variableId}:${valueRevision}`,
      variableId,
      kind,
      valueRevision,
      vaultId,
    };
    if (this.documents.get('variableValues', e.id))
      throw new InterlockError('Variable value revision already exists');
    const cipher = createCipheriv('aes-256-gcm', key, nonce, {
      authTagLength: 16,
    });
    cipher.setAAD(this.aad(e));
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    if (!old?.check)
      this.documents.put('variableVault', {
        id: 'default',
        vaultId,
        check: this.verifier(vaultId, key),
      } as Vault);
    this.documents.put('variableValues', {
      ...e,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    } as Envelope);
  }
  read(variableId: string, kind: VariableKind, valueRevision: number): string {
    const e = this.documents.get<Envelope>(
      'variableValues',
      `${variableId}:${valueRevision}`,
    );
    if (
      !e ||
      e.variableId !== variableId ||
      e.kind !== kind ||
      e.valueRevision !== valueRevision
    )
      throw new InterlockError(
        'Protected variable revision is missing. Restore the protected store or start a new run after provisioning the value.',
      );
    try {
      const vault = this.documents.get<Vault>('variableVault', 'default');
      if (!vault || vault.vaultId !== e.vaultId) throw this.failure();
      const key = this.key(e.vaultId, false);
      this.verify(vault, key);
      return this.decrypt(e, key);
    } catch {
      throw this.failure();
    }
  }
}
