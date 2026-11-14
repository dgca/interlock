import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs';
import { join } from 'node:path';
import {
  InterlockError,
  modelReferences,
  promptIds,
  sameWorkflowContent,
  variableReferences,
  type VariableImportBindings,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import {
  workflowBundleSchema,
  type WorkflowBundle,
} from '@interlock/core/transfer';
import type { Store } from '@interlock/storage';
import type { Engine } from './index.js';
import { ModelAliases } from './modelAliases.js';
import {
  diffBundleImport,
  exportWorkflows,
  importWorkflows,
} from './transfer.js';
import { Variables } from './variables.js';
import { observePublishes, publishObserver } from './workflowSyncHooks.js';

/** One file, or the folder itself, that sync could not apply. */
export interface WorkflowSyncItem {
  file: string;
  workflowId?: string;
  reason: string;
}

export interface WorkflowSyncStatus {
  folder: string;
  items: WorkflowSyncItem[];
}

/** The file content a workflow was last imported from or exported to. */
interface SyncBaseline {
  id: string;
  file: string;
  fileHash: string;
  draftRevision: number;
  name: string;
  description: string;
}

interface FileRead {
  file: string;
  hash: string;
  bundle?: WorkflowBundle;
  reason?: string;
}

const baselines = 'workflowSyncFiles';
const hashOf = (content: string) =>
  createHash('sha256').update(content).digest('hex');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Sorted keys and two-space indentation keep Git diffs to the edited lines. */
function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : isRecord(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .filter((key) => item[key] !== undefined)
              .map((key) => [key, sort(item[key])]),
          )
        : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Files carry drafts only: versions, deletions and triggers stay local. */
const localOnly = new Set(['deletedVersions', 'schedules', 'eventTriggers']);
function draftOnly(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.workflows)) return value;
  return {
    ...Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'promptRevisions'),
    ),
    workflows: value.workflows.map((entry: unknown) =>
      isRecord(entry)
        ? {
            ...Object.fromEntries(
              Object.entries(entry).filter(([key]) => !localOnly.has(key)),
            ),
            versions: [],
          }
        : entry,
    ),
  };
}

function readBundle(folder: string, file: string): FileRead {
  const content = readFileSync(join(folder, file), 'utf8');
  const hash = hashOf(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { file, hash, reason: `Not valid JSON: ${message(error)}` };
  }
  const result = workflowBundleSchema.safeParse(draftOnly(parsed));
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return {
      file,
      hash,
      reason: `Not a valid workflow bundle. ${path}${issue.message}`,
    };
  }
  return { file, hash, bundle: result.data };
}

/** Bind portable variables already known here; provision unset placeholders otherwise. */
function variableBindings(store: Store, bundle: WorkflowBundle) {
  const variables = new Variables(store);
  const bindings: VariableImportBindings = {};
  for (const requirement of bundle.variables ?? []) {
    try {
      bindings[requirement.id] = {
        action: 'bind',
        variableId: variables.get(requirement.id).id,
      };
    } catch {
      bindings[requirement.id] = {
        action: 'provision',
        name: requirement.name,
      };
    }
  }
  return bindings;
}

/**
 * Keeps workflow drafts in step with a folder of portable bundles. A changed
 * file imports into the draft; publishing writes the published workflow back.
 */
export class WorkflowSync {
  private items: WorkflowSyncItem[] = [];
  /** Files publishing left alone, with the content they held then. */
  private exportItems = new Map<
    string,
    { item: WorkflowSyncItem; hash?: string }
  >();
  /** Workflow ID to the files that defined it at the last scan. */
  private owners = new Map<string, string[]>();
  private watcher?: FSWatcher;
  private retry?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private pending = new Map<string, number>();

  constructor(
    private engine: Engine,
    readonly folder: string,
    private options: { debounceMs?: number; retryMs?: number } = {},
  ) {
    observePublishes(engine.store, {
      publishing: () => this.publishing(),
    });
  }

  private get store() {
    return this.engine.store;
  }

  /** Scan once, then watch the folder; a missing folder is checked again later. */
  start() {
    this.scan();
    this.watch();
  }

  stop() {
    this.watcher?.close();
    this.watcher = undefined;
    clearInterval(this.retry);
    clearTimeout(this.debounce);
    if (publishObserver(this.store)) observePublishes(this.store);
  }

  status(): WorkflowSyncStatus {
    return {
      folder: this.folder,
      items: [
        ...this.items,
        ...[...this.exportItems.values()].map(({ item }) => item),
      ],
    };
  }

  private folderExists() {
    try {
      return statSync(this.folder).isDirectory();
    } catch {
      return false;
    }
  }

  private watch() {
    if (this.watcher || this.retry) return;
    if (!this.folderExists()) {
      this.retry = setInterval(() => {
        if (!this.folderExists()) return;
        clearInterval(this.retry);
        this.retry = undefined;
        this.safeScan();
        this.watch();
      }, this.options.retryMs ?? 5000);
      this.retry.unref();
      return;
    }
    this.watcher = watch(this.folder, { persistent: false }, () => {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(
        () => this.safeScan(),
        this.options.debounceMs ?? 200,
      );
      this.debounce.unref();
    });
    this.watcher.on('error', () => {
      this.watcher?.close();
      this.watcher = undefined;
      this.safeScan();
      this.watch();
    });
  }

  /** Background scans report failures instead of stopping the server. */
  private safeScan() {
    try {
      this.scan();
    } catch (error) {
      this.items = [
        { file: this.folder, reason: `Sync failed: ${message(error)}` },
      ];
    }
  }

  /** Import changed files into drafts. Never publishes, starts runs or enables triggers. */
  scan(): WorkflowSyncStatus {
    if (!this.folderExists()) {
      this.items = [
        {
          file: this.folder,
          reason:
            'The sync folder does not exist. Create it; Interlock checks again every few seconds.',
        },
      ];
      this.owners.clear();
      return this.status();
    }
    const items: WorkflowSyncItem[] = [];
    const reads: FileRead[] = [];
    const unreadable = new Set<string>();
    for (const file of readdirSync(this.folder).sort()) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      try {
        reads.push(readBundle(this.folder, file));
      } catch (error) {
        items.push({ file, reason: `Cannot read the file: ${message(error)}` });
        unreadable.add(file);
      }
    }
    this.owners.clear();
    for (const read of reads)
      for (const entry of read.bundle?.workflows ?? [])
        this.owners.set(entry.id, [
          ...(this.owners.get(entry.id) ?? []),
          read.file,
        ]);
    const present = new Set([...unreadable, ...reads.map((read) => read.file)]);
    const hashes = new Map(reads.map((read) => [read.file, read.hash]));
    // An edit to a file publishing left alone supersedes that notice.
    for (const [id, { item, hash }] of this.exportItems)
      if (hashes.get(item.file) !== hash) this.exportItems.delete(id);
    for (const baseline of this.store.list<SyncBaseline>(baselines))
      // A deleted file leaves its workflow in place and ends the link.
      if (!present.has(baseline.file))
        this.store.remove(baselines, baseline.id);

    let queue: FileRead[] = [];
    for (const read of reads) {
      if (!read.bundle) {
        items.push({ file: read.file, reason: read.reason! });
        continue;
      }
      const duplicate = read.bundle.workflows.find(
        (entry) => this.owners.get(entry.id)!.length > 1,
      );
      if (duplicate) {
        const others = this.owners
          .get(duplicate.id)!
          .filter((file) => file !== read.file);
        items.push({
          file: read.file,
          workflowId: duplicate.id,
          reason: `Workflow ${duplicate.id} is also defined in ${others.join(', ')}. Keep it in one file.`,
        });
        continue;
      }
      if (!this.unchanged(read)) queue.push(read);
    }
    // Retry until no file makes progress, so owners import before owned children.
    let failures: WorkflowSyncItem[] = [];
    while (queue.length) {
      failures = [];
      const failed: FileRead[] = [];
      for (const read of queue) {
        const failure = this.apply(read);
        if (failure) {
          failures.push(failure);
          failed.push(read);
        }
      }
      if (failed.length === queue.length) break;
      queue = failed;
    }
    this.items = [...items, ...failures];
    return this.status();
  }

  /** The file still holds what was last synced for each of its workflows. */
  private unchanged(read: FileRead) {
    return read.bundle!.workflows.every((entry) => {
      const baseline = this.store.get<SyncBaseline>(baselines, entry.id);
      return baseline?.file === read.file && baseline.fileHash === read.hash;
    });
  }

  /** Draft edits made in Interlock since the last sync, not yet published. */
  private unsyncedEdits(workflow: Workflow) {
    const baseline = this.store.get<SyncBaseline>(baselines, workflow.id);
    // Renames do not advance the draft revision and versions do not record names.
    if (
      baseline &&
      (baseline.name !== workflow.name ||
        baseline.description !== workflow.description)
    )
      return true;
    if (baseline?.draftRevision === workflow.draftRevision) return false;
    const published = this.store.getVersion(
      workflow.id,
      workflow.latestVersion,
    )?.definition;
    return !published || !sameWorkflowContent(workflow.draft, published);
  }

  private apply(read: FileRead): WorkflowSyncItem | undefined {
    const bundle = read.bundle!;
    const draftRevisions: Record<string, number> = {};
    for (const entry of bundle.workflows) {
      const existing = this.store.get<Workflow>('workflows', entry.id);
      if (!existing) continue;
      draftRevisions[entry.id] = existing.draftRevision;
      const same =
        sameWorkflowContent(existing.draft, entry.draft) &&
        existing.name === entry.name &&
        existing.description === entry.description;
      if (!same && this.unsyncedEdits(existing))
        return {
          file: read.file,
          workflowId: entry.id,
          reason: `"${existing.name}" has draft edits in Interlock that are not in this file, and the file changed too. Publish or discard the draft to load the file, or restore the file.`,
        };
    }
    try {
      const conflict = diffBundleImport(this.store, bundle).prompts?.find(
        (prompt) => prompt.status === 'conflict',
      );
      if (conflict)
        throw new InterlockError(
          `Saved prompt "${conflict.name}" differs from the one in Interlock. Import does not overwrite saved prompts.`,
        );
      importWorkflows(this.store, bundle, {
        draftRevisions,
        variableBindings: variableBindings(this.store, bundle),
      });
    } catch (error) {
      return {
        file: read.file,
        workflowId: bundle.rootId,
        reason: message(error),
      };
    }
    for (const entry of bundle.workflows)
      this.remember(entry.id, read.file, read.hash);
    return undefined;
  }

  private remember(id: string, file: string, fileHash: string) {
    const workflow = this.store.get<Workflow>('workflows', id);
    if (workflow)
      this.store.put<SyncBaseline>(baselines, {
        id,
        file,
        fileHash,
        draftRevision: workflow.draftRevision,
        name: workflow.name,
        description: workflow.description,
      });
  }

  private publishing() {
    const before = new Map(
      this.store.workflows().map((w) => [w.id, w.latestVersion]),
    );
    return () => {
      for (const w of this.store.workflows())
        if (w.latestVersion !== before.get(w.id))
          this.pending.set(w.id, w.latestVersion);
      // After the caller's transaction settles: a rolled-back publish writes nothing.
      if (this.pending.size) setImmediate(() => this.flush());
    };
  }

  /** Write files for publications that committed, then pick up files they left alone. */
  private flush() {
    const pending = [...this.pending];
    this.pending.clear();
    for (const [id, version] of pending)
      if (this.store.get<Workflow>('workflows', id)?.latestVersion === version)
        try {
          this.exportWorkflow(id);
        } catch (error) {
          this.exportItems.set(id, {
            item: {
              file: this.folder,
              workflowId: id,
              reason: `Publishing could not write the file: ${message(error)}`,
            },
          });
        }
    if (pending.length) this.safeScan();
  }

  /** Write a workflow's published draft, unless the file has changes not yet imported. */
  private exportWorkflow(id: string): boolean {
    if (!this.folderExists()) return false;
    const workflow = this.store.get<Workflow>('workflows', id);
    if (!workflow) return false;
    const owners = this.owners.get(id) ?? [];
    if (owners.length > 1) return false;
    const file =
      owners[0] ?? `${id.replace(/[^\w.-]/g, '_').replace(/^\./, '_')}.json`;
    const path = join(this.folder, file);
    const read = existsSync(path) ? readBundle(this.folder, file) : undefined;
    const skip = (reason: string) => {
      this.exportItems.set(id, {
        item: { file, workflowId: id, reason },
        hash: read?.hash,
      });
      return false;
    };
    if (read) {
      if (read.bundle && read.bundle.workflows.length > 1)
        return skip(
          'Publishing did not write this file because it holds other workflows too. Move this workflow to its own file.',
        );
      const baseline = this.store.get<SyncBaseline>(baselines, id);
      const synced = baseline?.file === file && baseline.fileHash === read.hash;
      const entry = read.bundle?.workflows[0];
      // A file that holds a retained version has nothing Interlock would lose.
      const known =
        entry?.id === id &&
        entry.name === workflow.name &&
        entry.description === workflow.description &&
        this.store
          .listVersions(id)
          .some((v) => sameWorkflowContent(entry.draft, v.definition));
      if (!synced && !known) {
        // The edits are safe in the new version, so the file may load into the draft.
        this.remember(
          id,
          file,
          baseline?.file === file ? baseline.fileHash : '',
        );
        return skip(
          `Publishing did not overwrite this file because it has changes that are not in Interlock. Version ${workflow.latestVersion} keeps the Interlock edits; the file loads into the draft once nothing conflicts.`,
        );
      }
    }
    let content: string;
    try {
      content = stableJson(this.fileBundle(id));
    } catch (error) {
      return skip(`Publishing could not write this file: ${message(error)}`);
    }
    try {
      const temporary = join(this.folder, `.${file}.tmp`);
      writeFileSync(temporary, content);
      renameSync(temporary, path);
    } catch (error) {
      return skip(`Publishing could not write this file: ${message(error)}`);
    }
    this.exportItems.delete(id);
    this.owners.set(id, [file]);
    this.remember(id, file, hashOf(content));
    return true;
  }

  /** A one-workflow bundle with the draft and only what the draft references. */
  private fileBundle(id: string): WorkflowBundle {
    const bundle = exportWorkflows(this.store, id);
    const entry = bundle.workflows.find((w) => w.id === id)!;
    const draft: WorkflowDefinition = entry.draft;
    const promptSet = new Set(promptIds(draft));
    const prompts = (bundle.prompts ?? []).filter((p) => promptSet.has(p.id));
    const variables = new Variables(this.store).requirements(
      variableReferences(draft),
    );
    const modelAliases = new ModelAliases(this.store).requirements(
      modelReferences(draft),
    );
    return {
      format: bundle.format,
      formatVersion: bundle.formatVersion,
      ...(prompts.length ? { prompts } : {}),
      ...(variables.length ? { variables } : {}),
      ...(modelAliases.length ? { modelAliases } : {}),
      rootId: id,
      workflows: [
        {
          id,
          name: entry.name,
          description: entry.description,
          ownerWorkflowId: entry.ownerWorkflowId,
          ...(entry.boardSuggestion
            ? { boardSuggestion: entry.boardSuggestion }
            : {}),
          draft,
          // Import ignores it; a constant keeps edits from changing this line.
          draftRevision: 1,
          versions: [],
        },
      ],
    };
  }
}

const running = new WeakMap<Store, WorkflowSync>();

/** Start syncing with a folder; the caller stops the returned sync on shutdown. */
export function startWorkflowSync(engine: Engine, folder: string) {
  const sync = new WorkflowSync(engine, folder);
  running.set(engine.store, sync);
  sync.start();
  return sync;
}

/** Sync state for the API, or null when no folder is configured. */
export const workflowSyncStatus = (engine: Engine) =>
  running.get(engine.store)?.status() ?? null;
