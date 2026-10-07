import { z } from 'zod';
import { InterlockError } from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import {
  inspectImportDocument,
  importSelection,
} from '../../runtime/src/importSelection.js';

const segment = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const githubSourceSchema = z
  .object({
    owner: segment,
    repo: segment,
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    folder: z
      .string()
      .min(1)
      .max(1000)
      .refine((value) =>
        value
          .split('/')
          .every(
            (s) => s && s !== '.' && s !== '..' && !/[\\\x00-\x1f]/.test(s),
          ),
      ),
  })
  .strict();
export type GithubSource = z.infer<typeof githubSourceSchema>;
const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/');
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 50;

class GithubTransportError extends InterlockError {}

function importErrorMessage(error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const reason =
      issue.path.at(-1) === 'kind' ? 'Unsupported node kind' : issue.message;
    return `Invalid workflow at ${issue.path.join('.') || 'document'}: ${reason}. Correct the export file.`;
  }
  return error instanceof Error ? error.message : 'Cannot read workflow file';
}

export class GithubImporter {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async request(
    path: string,
    signal: AbortSignal,
    raw = false,
    resolvingRef = false,
  ) {
    let response: Response;
    try {
      response = await this.fetcher(
        `${raw ? 'https://raw.githubusercontent.com' : 'https://api.github.com'}${path}`,
        {
          signal,
          redirect: 'error',
          headers: {
            Accept: raw
              ? 'application/vnd.github.raw+json'
              : 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Interlock',
          },
        },
      );
    } catch (error) {
      throw new GithubTransportError(
        signal.aborted
          ? 'GitHub request cancelled or timed out. Retry discovery.'
          : `Cannot reach GitHub. Check your connection and retry. ${error instanceof Error ? error.message : ''}`,
      );
    }
    if (!response.ok) {
      if (response.status === 404 || (resolvingRef && response.status === 422))
        return undefined;
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get('retry-after');
        const reset = Number(response.headers.get('x-ratelimit-reset'));
        const guidance =
          retry && /^\d+$/.test(retry)
            ? ` Retry after ${retry} seconds.`
            : Number.isFinite(reset) && reset > 0
              ? ` Retry after ${new Date(reset * 1000).toISOString()}.`
              : '';
        throw new GithubTransportError(
          `GitHub rejected the request or its public API rate limit was reached. Wait and retry.${guidance}`,
        );
      }
      throw new GithubTransportError(
        `GitHub returned HTTP ${response.status}. Retry discovery.`,
      );
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new InterlockError(
        'GitHub response exceeds the 2 MiB limit. Choose a smaller folder or file.',
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new GithubTransportError(
        'GitHub returned an empty response. Retry discovery.',
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.length;
        if (size > MAX_BYTES)
          throw new InterlockError(
            'GitHub response exceeds the 2 MiB limit. Choose a smaller folder or file.',
          );
        chunks.push(result.value);
      }
    } catch (error) {
      if (error instanceof InterlockError) throw error;
      throw new GithubTransportError(
        signal.aborted
          ? 'GitHub request cancelled or timed out. Retry discovery.'
          : 'GitHub response was interrupted. Retry discovery.',
      );
    } finally {
      await reader.cancel().catch(() => {});
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (raw) return text;
    try {
      return JSON.parse(text);
    } catch {
      throw new GithubTransportError(
        'GitHub returned an invalid response. Retry discovery.',
      );
    }
  }
  private scope(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(60_000);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  private async directory(source: GithubSource, signal: AbortSignal) {
    const data = await this.request(
      `/repos/${source.owner}/${source.repo}/contents/${encodePath(source.folder)}?ref=${source.commit}`,
      signal,
    );
    if (!Array.isArray(data))
      throw new InterlockError(
        'GitHub folder was not found. Check the repository, ref, and folder path.',
      );
    if (data.length >= 1000)
      throw new InterlockError(
        'GitHub directory listing may be incomplete. Choose a folder with fewer than 1,000 entries.',
      );
    const files = data.filter(
      (item) =>
        item.type === 'file' &&
        !item.submodule_git_url &&
        typeof item.name === 'string' &&
        item.name.toLowerCase().endsWith('.json') &&
        item.path === `${source.folder}/${item.name}`,
    );
    if (files.length > MAX_FILES)
      throw new InterlockError(
        'This folder contains more than 50 JSON files. Choose a smaller folder.',
      );
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }
  private async read(
    source: GithubSource,
    file: { path: string; size: number },
    signal: AbortSignal,
  ) {
    if (file.size > MAX_BYTES)
      throw new InterlockError('File exceeds the 2 MiB import limit.');
    const text = await this.request(
      `/${source.owner}/${source.repo}/${source.commit}/${encodePath(file.path)}`,
      signal,
      true,
    );
    if (typeof text !== 'string')
      throw new InterlockError(
        'File was not found at this commit. Retry discovery.',
      );
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new InterlockError(
        'Invalid JSON. Fix the source file and discover again.',
      );
    }
    return data;
  }
  async discover(url: string, signal?: AbortSignal) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InterlockError(
        'Enter a public GitHub folder URL, such as https://github.com/owner/repo/tree/branch/folder.',
      );
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new InterlockError(
        'Use an HTTPS public github.com folder URL without credentials, query, or fragment.',
      );
    let parts: string[];
    try {
      parts = parsed.pathname
        .replace(/\/$/, '')
        .split('/')
        .slice(1)
        .map(decodeURIComponent);
    } catch {
      throw new InterlockError('GitHub URL has invalid path encoding.');
    }
    if (
      parts.length < 5 ||
      parts.length > 20 ||
      parts[2] !== 'tree' ||
      !segment.safeParse(parts[0]).success ||
      !segment.safeParse(parts[1]).success ||
      parts.some(
        (s) => !s || s === '.' || s === '..' || /[\\\x00-\x1f]/.test(s),
      )
    )
      throw new InterlockError(
        'Use a GitHub repository folder link containing /tree/REF/FOLDER, with at most 20 path segments.',
      );
    const [owner, repo] = parts;
    const active = this.scope(signal);
    const metadata = await this.request(`/repos/${owner}/${repo}`, active);
    if (!metadata || metadata.private !== false)
      throw new InterlockError(
        'Public repository was not found. Private repositories are not supported.',
      );
    let source: GithubSource | undefined;
    for (let end = parts.length - 1; end > 3; end--) {
      const ref = parts.slice(3, end).join('/');
      const commit = await this.request(
        `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
        active,
        false,
        true,
      );
      if (commit && typeof commit.sha === 'string') {
        source = githubSourceSchema.parse({
          owner,
          repo,
          commit: commit.sha,
          folder: parts.slice(end).join('/'),
        });
        break;
      }
    }
    if (!source)
      throw new InterlockError(
        'GitHub branch or commit was not found. Check the folder URL.',
      );
    const files = await this.directory(source, active);
    const items = [];
    for (const file of files) {
      try {
        const data = await this.read(source, file, active);
        // Ordinary metadata with a name is not a legacy workflow export.
        if (
          !data ||
          typeof data !== 'object' ||
          !('format' in data || 'definition' in data)
        )
          throw new InterlockError(
            'Not a workflow export. Use a legacy definition or portable bundle.',
          );
        const inspected = inspectImportDocument(data);
        items.push({
          file: file.name,
          valid: true as const,
          name: inspected.name,
          description: inspected.description,
          workflows: inspected.workflows,
          prompts: inspected.prompts,
          error: '',
        });
      } catch (error) {
        if (active.aborted) throw error;
        if (error instanceof GithubTransportError) throw error;
        items.push({
          file: file.name,
          valid: false as const,
          name: file.name,
          description: '',
          workflows: [],
          prompts: [],
          error: importErrorMessage(error),
        });
      }
    }
    return { source, items };
  }
  async import(
    engine: Engine,
    sourceData: GithubSource,
    names: string[],
    signal?: AbortSignal,
  ) {
    try {
      const source = githubSourceSchema.parse(sourceData);
      if (!names.length || new Set(names).size !== names.length)
        throw new InterlockError('Select one or more distinct workflow files.');
      const active = this.scope(signal);
      const files = await this.directory(source, active);
      const data = [];
      for (const name of names) {
        const file = files.find((item) => item.name === name);
        if (!file)
          throw new InterlockError(
            `Selected file ${name} is not a direct JSON file in this folder. Discover again.`,
          );
        const document = await this.read(source, file, active);
        if (
          !document ||
          typeof document !== 'object' ||
          !('format' in document || 'definition' in document)
        )
          throw new InterlockError(
            `Selected file ${name} is not a workflow export.`,
          );
        data.push(document);
      }
      active.throwIfAborted();
      return importSelection(engine, data);
    } catch (error) {
      throw new InterlockError(
        `Nothing imported: ${importErrorMessage(error)}`,
      );
    }
  }
}
