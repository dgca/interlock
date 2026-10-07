import { createHash, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { InterlockError } from '@interlock/core';
import {
  parseImportDocument,
  importDocumentMetadata,
} from '../../core/src/importDocument.js';
import {
  importSelection,
  type SelectedFile,
} from '../../runtime/src/importSelection.js';
import type { Engine } from '@interlock/runtime';

const MiB = 1024 * 1024;
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const validationMessage = (e: ZodError) => {
  const issue = e.issues[0];
  const reason =
    issue.path.at(-1) === 'kind' ? 'Unsupported node kind' : issue.message;
  return `Invalid workflow at ${issue.path.join('.') || 'document'}: ${reason}. Correct the export file.`;
};
const detail = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function parseGithubFolderUrl(value: string) {
  const help =
    'Use an HTTPS public github.com repository folder URL, such as https://github.com/owner/repo/tree/main/workflows.';
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new InterlockError(help);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new InterlockError(help);
  let segments: string[];
  try {
    segments = url.pathname
      .replace(/\/$/, '')
      .split('/')
      .slice(1)
      .map(decodeURIComponent);
  } catch {
    throw new InterlockError(`Invalid URL encoding. ${help}`);
  }
  if (
    segments.length < 5 ||
    segments[2] !== 'tree' ||
    segments.some(
      (x) =>
        !x ||
        x
          .split('/')
          .some(
            (s) =>
              !s ||
              s === '.' ||
              s === '..' ||
              s.includes('\\') ||
              /[\x00-\x1f]/.test(s),
          ),
    ) ||
    !/^[\w.-]+$/.test(segments[0]) ||
    !/^[\w.-]+$/.test(segments[1])
  )
    throw new InterlockError(help);
  return {
    owner: segments[0],
    repository: segments[1],
    tail: segments.slice(3),
  };
}
class GithubResponseError extends InterlockError {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type Source = {
  owner: string;
  repository: string;
  requestedRef: string;
  resolvedCommit: string;
  folder: string;
  url: string;
};
type Choice = ReturnType<typeof importDocumentMetadata> & {
  fileId: string;
  filename: string;
  path: string;
  sha256: string;
};
type Preview = {
  source: Source;
  choices: Choice[];
  files: SelectedFile[];
  expiresAt: number;
  bytes: number;
};
export class GithubImports {
  private previews = new Map<string, Preview>();
  constructor(
    private engine: Engine,
    private fetcher: typeof fetch = fetch,
    private clock = Date.now,
  ) {}
  async discover(url: string) {
    const parsed = parseGithubFolderUrl(url);
    const operation = new AbortController();
    const deadline = setTimeout(() => operation.abort(), 60_000);
    const prefix = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`;
    const request = async (path: string, maxBytes: number, raw = false) => {
      let response: Response;
      try {
        response = await this.fetcher(
          raw
            ? `https://raw.githubusercontent.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}${path}`
            : prefix + path,
          {
            redirect: 'error',
            signal: AbortSignal.any([
              operation.signal,
              AbortSignal.timeout(15_000),
            ]),
            headers: {
              Accept: raw
                ? 'application/vnd.github.raw+json'
                : 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          },
        );
      } catch {
        throw new InterlockError(
          'Could not reach GitHub. Check your connection, then retry.',
        );
      }
      if (!response.ok) {
        const retry = response.headers.get('retry-after'),
          reset = response.headers.get('x-ratelimit-reset');
        const limit =
          response.status === 429 ||
          (response.status === 403 &&
            response.headers.get('x-ratelimit-remaining') === '0');
        throw new GithubResponseError(
          response.status,
          limit
            ? `GitHub rate limit reached.${retry ? ` Retry after ${retry} seconds.` : reset ? ` Retry after ${new Date(Number(reset) * 1000).toISOString()}.` : ' Try again later.'}`
            : response.status === 404
              ? 'GitHub repository, ref or folder was not found. Check the public folder URL.'
              : `GitHub rejected the request (${response.status}). Check that the repository is public, then retry.`,
        );
      }
      const reader = response.body?.getReader();
      if (!reader)
        throw new InterlockError('GitHub returned an empty response. Retry.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new InterlockError(
              `GitHub response exceeds ${maxBytes / MiB} MiB. Choose a smaller file or folder.`,
            );
          }
          chunks.push(value);
        }
      } catch (e) {
        if (e instanceof InterlockError) throw e;
        throw new InterlockError('GitHub response was interrupted. Retry.');
      }
      return Buffer.concat(chunks).toString('utf8');
    };
    try {
      let source: Source | undefined;
      if (parsed.tail.length - 1 > 16)
        throw new InterlockError(
          'This URL needs too many ref probes. Use a commit URL and a shorter folder path.',
        );
      for (let count = parsed.tail.length - 1; count >= 1; count--) {
        const ref = parsed.tail.slice(0, count).join('/');
        try {
          const commit = JSON.parse(
            await request(`/commits/${encodeURIComponent(ref)}`, MiB),
          );
          if (!/^[a-f0-9]{40}$/.test(commit.sha))
            throw new InterlockError(
              'GitHub returned an invalid commit. Retry.',
            );
          const folder = parsed.tail.slice(count).join('/');
          source = {
            owner: parsed.owner,
            repository: parsed.repository,
            requestedRef: ref,
            resolvedCommit: commit.sha,
            folder,
            url: `https://github.com/${parsed.owner}/${parsed.repository}/tree/${commit.sha}/${folder.split('/').map(encodeURIComponent).join('/')}`,
          };
          break;
        } catch (e) {
          if (
            !(e instanceof GithubResponseError) ||
            ![404, 422].includes(e.status)
          )
            throw e;
        }
      }
      if (!source)
        throw new InterlockError(
          'GitHub ref was not found. Check the branch or commit and folder path.',
        );
      const contentPath = (path: string) =>
        `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${source!.resolvedCommit}`;
      const entries = JSON.parse(
        await request(contentPath(source.folder), 2 * MiB),
      ) as {
        type: string;
        name: string;
        path: string;
        size: number;
        submodule_git_url?: string;
        target?: string;
      }[];
      if (!Array.isArray(entries))
        throw new InterlockError(
          'This URL identifies a file. Choose a repository folder.',
        );
      if (entries.length > 200)
        throw new InterlockError(
          'Folder has more than 200 entries. Choose a smaller folder.',
        );
      const candidates = entries.filter(
        (e) =>
          e.type === 'file' &&
          !e.submodule_git_url &&
          !e.target &&
          e.name.endsWith('.json') &&
          e.path === `${source!.folder}/${e.name}` &&
          !e.name.includes('/'),
      );
      if (candidates.length > 100)
        throw new InterlockError(
          'Folder has more than 100 JSON files. Choose a smaller folder.',
        );
      const choices: Choice[] = [],
        files: SelectedFile[] = [],
        diagnostics: { filename: string; reason: string }[] = [];
      let ignoredCount = entries.filter(
          (e) => e.type === 'file' && !e.name.endsWith('.json'),
        ).length,
        total = 0,
        next = 0;
      const worker = async () => {
        while (next < candidates.length) {
          const entry = candidates[next++];
          let text: string;
          try {
            if (entry.size > MiB)
              throw new InterlockError(
                'File exceeds 1 MiB. Use a smaller export.',
              );
            text = await request(
              `/${source!.resolvedCommit}/${entry.path.split('/').map(encodeURIComponent).join('/')}`,
              MiB,
              true,
            );
          } catch (e) {
            if (
              (e instanceof GithubResponseError && e.status === 404) ||
              detail(e).includes('exceeds')
            ) {
              diagnostics.push({ filename: entry.name, reason: detail(e) });
              continue;
            }
            throw e;
          }
          total += Buffer.byteLength(text);
          if (total > 8 * MiB)
            throw new InterlockError(
              'Folder JSON exceeds 8 MiB. Choose a smaller folder.',
            );
          try {
            const data = JSON.parse(text);
            if (
              !data ||
              typeof data !== 'object' ||
              (!('format' in data) &&
                (!('name' in data) || !('definition' in data)))
            ) {
              ignoredCount++;
              continue;
            }
            const document = parseImportDocument(data),
              sha256 = digest(text),
              fileId = digest(
                `${source!.resolvedCommit}:${entry.path}:${sha256}`,
              );
            choices.push({
              ...importDocumentMetadata(document),
              fileId,
              filename: entry.name,
              path: entry.path,
              sha256,
            });
            files.push({ fileId, filename: entry.name, data });
          } catch (e) {
            diagnostics.push({
              filename: entry.name,
              reason:
                e instanceof SyntaxError
                  ? 'Invalid JSON. Correct the export file.'
                  : e instanceof ZodError
                    ? validationMessage(e)
                    : detail(e),
            });
          }
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(4, candidates.length) }, worker),
        );
      } catch (e) {
        operation.abort();
        throw e;
      }
      choices.sort((a, b) => a.filename.localeCompare(b.filename));
      diagnostics.sort((a, b) => a.filename.localeCompare(b.filename));
      this.expire();
      while (
        this.previews.size >= 8 ||
        [...this.previews.values()].reduce((sum, p) => sum + p.bytes, 0) +
          total >
          64 * MiB
      )
        this.previews.delete(this.previews.keys().next().value!);
      const previewId = randomUUID(),
        expiresAt = this.clock() + 15 * 60_000;
      this.previews.set(previewId, {
        source,
        choices,
        files,
        expiresAt,
        bytes: total,
      });
      return {
        previewId,
        expiresAt: new Date(expiresAt).toISOString(),
        source,
        choices,
        diagnostics,
        ignoredCount,
      };
    } finally {
      clearTimeout(deadline);
    }
  }
  private expire() {
    for (const [id, p] of this.previews)
      if (p.expiresAt <= this.clock()) this.previews.delete(id);
  }
  import(previewId: string, fileIds: string[]) {
    this.expire();
    const preview = this.previews.get(previewId);
    if (!preview)
      throw new InterlockError(
        'Nothing imported: preview expired or was removed. Load workflows again.',
      );
    if (
      !fileIds.length ||
      fileIds.length > 100 ||
      new Set(fileIds).size !== fileIds.length
    )
      throw new InterlockError(
        'Nothing imported: select 1 to 100 unique workflow files.',
      );
    const files = fileIds.map((id) =>
      preview.files.find((f) => f.fileId === id),
    );
    if (files.some((f) => !f))
      throw new InterlockError(
        'Nothing imported: selection does not belong to this preview. Load workflows again.',
      );
    try {
      return {
        source: preview.source,
        ...importSelection(this.engine.store, files as SelectedFile[]),
      };
    } catch (e) {
      throw new InterlockError(`Nothing imported: ${detail(e)}`);
    }
  }
}
const services = new WeakMap<Engine, GithubImports>();
export function githubImports(engine: Engine) {
  let service = services.get(engine);
  if (!service) {
    service = new GithubImports(engine);
    services.set(engine, service);
  }
  return service;
}
