import { isAbsolute } from 'node:path';
import {
  InterlockError,
  executorProfileSchema,
  executorProfileUpdateSchema,
  executorModelsQuerySchema,
  executorEffortSchema,
  executorSettingsSchema,
  executorSettingsUpdateSchema,
  type ExecutorModels,
  type ExecutorProfile,
  type ExecutorProfileUpdate,
  type WorkRequest,
} from '@interlock/core';
import type { Engine } from '../index.js';
import type { HarnessAdapter } from './contracts.js';
import { customInvocation } from './custom.js';

// Inspection needs assignment identity and configuration, never task payloads.
export type ManagedAssignment = Pick<
  WorkRequest,
  | 'id'
  | 'runId'
  | 'attempt'
  | 'status'
  | 'executor'
  | 'executorModel'
  | 'executorModelSource'
  | 'executorEffort'
  | 'executorPermissions'
  | 'executorPermissionsSource'
> & {
  context: Pick<WorkRequest['context'], 'continuityGroup' | 'tools' | 'skills'>;
  trialEnvironment?: { id: string };
};

const profilesCollection = 'executorProfiles';
const defaults: ExecutorProfile[] = [
  executorProfileSchema.parse({
    id: 'claude-code',
    harness: 'claude-code',
    name: 'Claude Code',
  }),
  executorProfileSchema.parse({ id: 'codex', harness: 'codex', name: 'Codex' }),
  executorProfileSchema.parse({ id: 'pi', harness: 'pi', name: 'Pi' }),
];

/** Supervision state the configuration reads but does not own. */
export interface ExecutorConfigurationHost {
  adapters(): ReadonlyMap<string, HarnessAdapter>;
  running(): boolean;
  stopped(): boolean;
  schedule(): void;
}

/** Executor profiles, shared settings, harness detection and model catalogs. */
export class ExecutorConfiguration {
  private readonly catalogs = new Map<
    string,
    { at: number; result: ExecutorModels }
  >();
  readonly modelRequests = new Map<
    string,
    { abort: AbortController; done: Promise<ExecutorModels> }
  >();
  readonly detections = new Map<
    string,
    { at: number; result: Awaited<ReturnType<HarnessAdapter['detect']>> }
  >();
  private readonly detectionRequests = new Map<
    string,
    ReturnType<HarnessAdapter['detect']>
  >();
  private readonly presetChecks = new Set<string>();
  constructor(
    private readonly engine: Pick<Engine, 'store' | 'getAllowedRoots' | 'pump'>,
    private readonly defaultCwd: string,
    private readonly host: ExecutorConfigurationHost,
  ) {}
  private get adapters() {
    return this.host.adapters();
  }
  private get running() {
    return this.host.running();
  }
  private get stopped() {
    return this.host.stopped();
  }
  private schedule() {
    this.host.schedule();
  }
  profiles() {
    const stored = this.engine.store
      .list<unknown>(profilesCollection)
      .map(parseProfileSnapshot);
    return [
      ...defaults.filter((d) => !stored.some((p) => p.id === d.id)),
      ...stored,
    ];
  }
  configuredPresetProfile(profile: ExecutorProfile | undefined) {
    if (
      !profile?.enabled ||
      (profile.harness === 'custom' && !customInvocation(profile))
    )
      return;
    if (!this.running) return profile;
    const adapter = this.adapters.get(profile.harness);
    return adapter && adapter.available?.(profile.command) !== false
      ? profile
      : undefined;
  }
  /** Undefined means the version check is still pending. */
  presetProfileReady(profile: ExecutorProfile): boolean | undefined {
    if (!this.running) return true;
    const key = this.detectionKey(profile);
    const checked = this.currentDetection(key);
    if (checked) return checked.status === 'detected';
    if (!this.presetChecks.has(key)) {
      this.presetChecks.add(key);
      void this.detect(profile)
        .then(() => {
          this.presetChecks.delete(key);
          this.engine.pump();
        })
        .catch(() => {});
    }
  }
  settings() {
    const stored = this.engine.store.get<{
      id: string;
      revision: number;
      concurrency: number | null;
      allowedRoots?: string[];
      providerPrefixes?: Record<string, string>;
    }>('executorSettings', 'shared');
    const roots = stored?.allowedRoots ?? this.engine.getAllowedRoots();
    return executorSettingsSchema.parse({
      revision: stored?.revision ?? 0,
      concurrency: stored ? stored.concurrency : 3,
      ...(roots && roots.length > 0 ? { allowedRoots: roots } : {}),
      ...(stored?.providerPrefixes
        ? { providerPrefixes: stored.providerPrefixes }
        : {}),
    });
  }
  saveSettings(input: unknown) {
    const q = executorSettingsUpdateSchema.parse(input);
    const result = this.engine.store.transaction(() => {
      if (this.settings().revision !== q.expectedRevision)
        throw new InterlockError(
          'Execution settings changed. Reload before saving.',
        );
      const currentRoots = this.settings().allowedRoots;
      const roots =
        q.allowedRoots !== undefined ? q.allowedRoots : currentRoots;
      const currentPrefixes = this.settings().providerPrefixes;
      const providerPrefixes =
        q.providerPrefixes !== undefined ? q.providerPrefixes : currentPrefixes;
      const next = executorSettingsSchema.parse({
        revision: q.expectedRevision + 1,
        concurrency: q.concurrency,
        ...(roots && roots.length > 0 ? { allowedRoots: roots } : {}),
        ...(providerPrefixes && Object.keys(providerPrefixes).length > 0
          ? { providerPrefixes }
          : {}),
      });
      this.engine.store.put('executorSettings', { id: 'shared', ...next });
      return next;
    });
    this.schedule();
    return result;
  }
  saveProfile(input: ExecutorProfileUpdate) {
    const q = executorProfileUpdateSchema.parse(input);
    const pathsToCheck = [
      q.harness !== 'custom' ? q.command : undefined,
      q.cwd,
      ...(q.allowedRoots ?? []),
    ];
    for (const path of pathsToCheck)
      if (path && !isAbsolute(path))
        throw new InterlockError(
          'Executable, working directory, and allowed root overrides must be absolute paths',
        );
    if (
      q.transport === 'pull' &&
      (q.harness !== 'custom' || q.mode !== 'launcher')
    )
      throw new InterlockError(
        'The pull transport requires a custom profile in launcher mode',
      );
    const result = this.engine.store.transaction(() => {
      const current = this.profiles().find((p) => p.id === q.id);
      if ((current?.revision ?? 0) !== q.expectedRevision)
        throw new InterlockError(
          'Harness configuration changed. Reload before saving.',
        );
      if (current && current.harness !== q.harness)
        throw new InterlockError('A profile cannot change harness identity');
      if (!current && this.profiles().length >= 20)
        throw new InterlockError(
          'At most 20 local executor configurations are supported',
        );
      const { expectedRevision: _revision, ...value } = q;
      const next = executorProfileSchema.parse({
        ...value,
        revision: q.expectedRevision + 1,
      });
      this.engine.store.put(profilesCollection, next);
      return next;
    });
    this.detections.clear();
    this.schedule();
    return result;
  }
  async listProfiles(refresh = false) {
    return Promise.all(
      this.profiles().map(async (profile) => ({
        ...profile,
        detection:
          profile.harness === 'custom' && !customInvocation(profile)
            ? {
                status: 'unavailable' as const,
                message:
                  profile.transport === 'http'
                    ? 'Set the integration URL.'
                    : 'Set the integration command.',
              }
            : await this.detect(profile, refresh),
      })),
    );
  }
  async models(input: unknown): Promise<ExecutorModels> {
    const q = executorModelsQuerySchema.parse(input);
    const stored = this.profiles().find((p) => p.id === q.profileId);
    if (!stored) throw new InterlockError('Harness configuration not found');
    const profile = q.paths
      ? { ...stored, command: q.paths.command, cwd: q.paths.cwd }
      : stored;
    return this.profileModels(profile, q.refresh);
  }
  private catalogKey(profile: ExecutorProfile) {
    return JSON.stringify([
      profile.harness,
      profile.command,
      profile.cwd ?? this.defaultCwd,
    ]);
  }
  async profileModels(
    profile: ExecutorProfile,
    refresh = false,
  ): Promise<ExecutorModels> {
    for (const path of [profile.command, profile.cwd])
      if (path && !isAbsolute(path))
        throw new InterlockError(
          'Executable and working directory overrides must be absolute paths',
        );
    const key = this.catalogKey(profile);
    const cached = this.catalogs.get(key);
    if (
      !refresh &&
      cached &&
      Date.now() - cached.at <
        (cached.result.status === 'ready' ? 300000 : 30000)
    )
      return cached.result;
    const pending = this.modelRequests.get(key);
    if (pending) return pending.done;
    if (this.stopped || this.modelRequests.size >= 4)
      return {
        status: 'unavailable',
        models: [],
        truncated: false,
        message: 'Model discovery is busy or stopping. Try again shortly.',
      };
    const abort = new AbortController();
    const done = (async (): Promise<ExecutorModels> => {
      const timer = setTimeout(
        () => abort.abort(new Error('Model discovery timed out')),
        15000,
      );
      try {
        const adapter = this.adapters.get(profile.harness);
        if (!adapter?.models)
          throw new Error('This harness does not support model discovery');
        const detection = await this.detect(profile, refresh);
        if (abort.signal.aborted) throw abort.signal.reason;
        if (!detection.command || detection.status !== 'detected')
          throw new Error(detection.message ?? 'Harness is unavailable');
        const catalog = await adapter.models({
          command: detection.command,
          cwd: profile.cwd ?? this.defaultCwd,
          signal: abort.signal,
        });
        if (abort.signal.aborted) throw abort.signal.reason;
        const models: ExecutorModels['models'] = [];
        const ids = new Set<string>();
        for (const model of catalog.models) {
          if (
            typeof model.id !== 'string' ||
            !model.id.trim() ||
            model.id.length > 200 ||
            ids.has(model.id)
          )
            continue;
          ids.add(model.id);
          models.push({
            id: model.id,
            name: (model.name || model.id).slice(0, 120),
            ...(model.effortLevels !== undefined
              ? {
                  effortLevels: [
                    ...new Set(
                      model.effortLevels.filter(
                        (level) =>
                          executorEffortSchema.safeParse(level).success,
                      ),
                    ),
                  ].slice(0, 20),
                }
              : {}),
            ...(model.defaultEffort &&
            executorEffortSchema.safeParse(model.defaultEffort).success
              ? { defaultEffort: model.defaultEffort }
              : {}),
            ...(model.description
              ? { description: model.description.slice(0, 300) }
              : {}),
          });
          if (models.length === 100) break;
        }
        return {
          status: 'ready',
          models,
          truncated: !!catalog.truncated || catalog.models.length > 100,
        };
      } catch (error) {
        return {
          status: 'unavailable',
          models: [],
          truncated: false,
          message: errorText(error),
        };
      } finally {
        clearTimeout(timer);
      }
    })();
    this.modelRequests.set(key, { abort, done });
    try {
      const result = await done;
      if (!this.stopped) {
        if (this.catalogs.size >= 20)
          this.catalogs.delete(this.catalogs.keys().next().value!);
        this.catalogs.set(key, { at: Date.now(), result });
      }
      return result;
    } finally {
      this.modelRequests.delete(key);
    }
  }
  private detectionKey(profile: ExecutorProfile) {
    return `${profile.id}:${profile.revision}:${profile.command ?? ''}`;
  }
  private currentDetection(key: string) {
    const cached = this.detections.get(key);
    return cached && Date.now() - cached.at < 30000 ? cached.result : undefined;
  }
  async detect(
    profile: ExecutorProfile,
    refresh = false,
  ): ReturnType<HarnessAdapter['detect']> {
    const key = this.detectionKey(profile);
    const cached = this.currentDetection(key);
    if (!refresh && cached) return cached;
    const pending = this.detectionRequests.get(key);
    if (pending) return pending;
    const adapter = this.adapters.get(profile.harness);
    const probe = Promise.resolve()
      .then(() =>
        adapter
          ? adapter.detect(profile.command)
          : {
              status: 'unavailable' as const,
              message: 'Harness execution is not attached to this server',
            },
      )
      .catch((error: unknown) => ({
        status: 'unavailable' as const,
        message:
          error instanceof Error ? error.message : 'Harness check failed',
      }))
      .then((result) => {
        this.detections.set(key, { at: Date.now(), result });
        return result;
      })
      .finally(() => this.detectionRequests.delete(key));
    this.detectionRequests.set(key, probe);
    return probe;
  }
  incompatible(work: ManagedAssignment, profile: ExecutorProfile) {
    if (work.trialEnvironment)
      return 'Managed local Git trials require a scoped external executor; native harness dispatch is not supported';
    const missing = [
      ...work.context.tools.filter((t) => !profile.tools.includes(t)),
      ...work.context.skills.filter((s) => !profile.skills.includes(s)),
    ];
    return missing.length
      ? `Profile is missing configured capabilities: ${missing.join(', ')}`
      : undefined;
  }
  assignmentProfile(
    work: ManagedAssignment,
    configured: ExecutorProfile,
  ): ExecutorProfile {
    return {
      ...configured,
      model: work.executorModel ?? configured.model,
      effort:
        work.executorEffort !== undefined
          ? work.executorEffort
          : configured.effort,
      permissions: work.executorPermissions ?? configured.permissions,
    };
  }
  effortProblem(
    profile: ExecutorProfile,
  ): { reason: string; pending?: boolean } | undefined {
    if (!profile.effort) return;
    if (!profile.model)
      return { reason: 'Select a model before configuring thinking effort' };
    const catalog = this.catalogs.get(this.catalogKey(profile))?.result;
    if (!catalog)
      return {
        reason: 'Checking thinking effort support for the selected model',
        pending: true,
      };
    if (catalog.status !== 'ready')
      return {
        reason: `Thinking effort support could not be checked: ${catalog.message ?? 'model discovery unavailable'}`,
      };
    const model = catalog.models.find((m) => m.id === profile.model);
    if (!model?.effortLevels)
      return {
        reason:
          'This model does not report thinking effort choices. Use native default or select a model with reported support.',
      };
    if (!model.effortLevels.includes(profile.effort))
      return {
        reason: `Thinking effort ${profile.effort} is not supported by ${profile.model}. Choose a supported level or use native default.`,
      };
  }
}
export function errorText(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2000,
  );
}

/** Preserve captured profile settings while ignoring the retired timeout draft field. */
export function parseProfileSnapshot(value: unknown): ExecutorProfile {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { timeoutMs: _retiredTimeout, ...current } = value as Record<
      string,
      unknown
    >;
    return executorProfileSchema.parse(current);
  }
  return executorProfileSchema.parse(value);
}
