import { statfsSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  VERSION,
  type DiagnosticCheck,
  type DiagnosticStatus,
  type DoctorOptions,
  type DoctorReport,
  variableReferences,
  modelReferences,
  agentAliasReference,
  selectsPreset,
  promptIds,
  sameWorkflowContent,
  type ResourceReservation,
  type ManagedExecution,
  type PauseHold,
} from '@interlock/core';
import type { Engine } from './index.js';
import {
  uncertainClaimCollection,
  uncertainOperationCollection,
} from './quiescence.js';
import { upgradeChecks } from './doctorUpgrade.js';
import { privateFetchCheck } from './fetch.js';

export async function runDoctor(
  engine: Engine,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DiagnosticCheck[] = [];

  // ==========================================
  // 1. System & Storage Checks
  // ==========================================
  // 1a. Engine version
  checks.push({
    category: 'system',
    name: 'Engine version',
    status: 'ok',
    message: `Interlock engine v${VERSION}`,
    details: { version: VERSION },
  });

  // 1b. Schema version
  try {
    const migration = engine.store.migration;
    checks.push({
      category: 'system',
      name: 'Database schema version',
      status: 'ok',
      message: `Database schema is current (version ${migration.to})`,
      details: { version: migration.to, from: migration.from },
    });
  } catch (err) {
    checks.push({
      category: 'system',
      name: 'Database schema version',
      status: 'fail',
      message: `Failed to inspect schema version: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Check database connectivity and migrations.',
    });
  }

  // 1c. SQLite integrity check
  try {
    const integrityResults = engine.store.quickCheck();
    if (
      integrityResults.length === 1 &&
      integrityResults[0].toLowerCase() === 'ok'
    ) {
      checks.push({
        category: 'system',
        name: 'SQLite integrity',
        status: 'ok',
        message: 'SQLite database integrity check passed',
        details: { check: 'ok' },
      });
    } else {
      checks.push({
        category: 'system',
        name: 'SQLite integrity',
        status: 'fail',
        message: `SQLite integrity check failed: ${integrityResults.join(', ')}`,
        details: { errors: integrityResults },
        remediation:
          'Database file may be corrupted. Restore from backup or run sqlite3 repair.',
      });
    }
  } catch (err) {
    checks.push({
      category: 'system',
      name: 'SQLite integrity',
      status: 'fail',
      message: `Failed to run SQLite integrity check: ${err instanceof Error ? err.message : String(err)}`,
      remediation: 'Check database file permissions and lock state.',
    });
  }

  // 1d. Storage size and history
  try {
    const space = engine.store.storageSpace();
    const runCount = engine.store.historyRuns().length;
    const dbMb = (space.databaseBytes / (1024 * 1024)).toFixed(2);
    checks.push({
      category: 'system',
      name: 'Storage space',
      status: 'ok',
      message: `Database size: ${dbMb} MB (${space.reusableBytes} reusable bytes, ${runCount} runs recorded)`,
      details: {
        databaseBytes: space.databaseBytes,
        reusableBytes: space.reusableBytes,
        runCount,
      },
    });
  } catch (err) {
    checks.push({
      category: 'system',
      name: 'Storage space',
      status: 'warn',
      message: `Could not retrieve storage metrics: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 1e. Free disk space
  try {
    const dbPath = engine.store.path;
    const checkDir =
      dbPath === ':memory:' ? process.cwd() : dirname(resolve(dbPath));
    const stats = statfsSync(checkDir);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeGb = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
    const totalGb = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);

    if (freeBytes < 250 * 1024 * 1024) {
      checks.push({
        category: 'system',
        name: 'Free disk space',
        status: 'fail',
        message: `Critically low disk space: ${freeGb} GB free of ${totalGb} GB total`,
        details: { freeBytes, totalBytes },
        remediation: 'Free up disk space on host filesystem immediately.',
      });
    } else if (freeBytes < 1024 * 1024 * 1024) {
      checks.push({
        category: 'system',
        name: 'Free disk space',
        status: 'warn',
        message: `Low disk space: ${freeGb} GB free of ${totalGb} GB total`,
        details: { freeBytes, totalBytes },
        remediation:
          'Ensure sufficient disk space is maintained for execution logs and databases.',
      });
    } else {
      checks.push({
        category: 'system',
        name: 'Free disk space',
        status: 'ok',
        message: `Sufficient disk space: ${freeGb} GB free of ${totalGb} GB total`,
        details: { freeBytes, totalBytes },
      });
    }
  } catch (err) {
    checks.push({
      category: 'system',
      name: 'Free disk space',
      status: 'warn',
      message: `Could not check filesystem free space: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 1f. 0.3.0 upgrade readiness
  checks.push(...upgradeChecks(engine));

  // ==========================================
  // 2. Harness Profiles Checks
  // ==========================================
  try {
    const profiles = await engine.executors.listProfiles(true);
    const enabledProfiles = profiles.filter((p) => p.enabled);

    if (enabledProfiles.length === 0) {
      checks.push({
        category: 'harnesses',
        name: 'Configured harnesses',
        status: 'ok',
        message: `0 of ${profiles.length} harness profiles enabled`,
        details: { totalProfiles: profiles.length, enabledProfiles: 0 },
      });
    } else {
      for (const profile of enabledProfiles) {
        // Binary detection
        if (profile.detection?.status === 'detected') {
          checks.push({
            category: 'harnesses',
            name: `Harness binary: ${profile.name}`,
            status: 'ok',
            message: `Executable detected at ${profile.detection.command ?? 'PATH'}${profile.detection.version ? ` (${profile.detection.version})` : ''}`,
            details: {
              profileId: profile.id,
              harness: profile.harness,
              command: profile.detection.command,
              version: profile.detection.version,
            },
          });
        } else {
          checks.push({
            category: 'harnesses',
            name: `Harness binary: ${profile.name}`,
            status: 'fail',
            message: `Harness binary not found: ${profile.detection?.message ?? 'missing on PATH'}`,
            details: {
              profileId: profile.id,
              harness: profile.harness,
              command: profile.command,
            },
            remediation: `Install the "${profile.harness}" binary or set an explicit absolute path in Harness Settings.`,
          });
        }

        // Cwd existence
        if (profile.cwd) {
          try {
            if (
              existsSync(profile.cwd) &&
              statSync(profile.cwd).isDirectory()
            ) {
              checks.push({
                category: 'harnesses',
                name: `Working directory: ${profile.name}`,
                status: 'ok',
                message: `Directory exists: ${profile.cwd}`,
                details: { profileId: profile.id, cwd: profile.cwd },
              });
            } else {
              checks.push({
                category: 'harnesses',
                name: `Working directory: ${profile.name}`,
                status: 'fail',
                message: `Configured cwd does not exist or is not a directory: ${profile.cwd}`,
                details: { profileId: profile.id, cwd: profile.cwd },
                remediation: `Create the directory "${profile.cwd}" or update profile settings.`,
              });
            }
          } catch {
            checks.push({
              category: 'harnesses',
              name: `Working directory: ${profile.name}`,
              status: 'fail',
              message: `Cannot access configured cwd: ${profile.cwd}`,
              details: { profileId: profile.id, cwd: profile.cwd },
              remediation: `Ensure path "${profile.cwd}" exists and is accessible.`,
            });
          }
        }

        // allowedRoots existence
        if (profile.allowedRoots && profile.allowedRoots.length > 0) {
          for (const root of profile.allowedRoots) {
            try {
              if (existsSync(root) && statSync(root).isDirectory()) {
                checks.push({
                  category: 'harnesses',
                  name: `Allowed root: ${profile.name}`,
                  status: 'ok',
                  message: `Allowed root exists: ${root}`,
                  details: { profileId: profile.id, root },
                });
              } else {
                checks.push({
                  category: 'harnesses',
                  name: `Allowed root: ${profile.name}`,
                  status: 'fail',
                  message: `Allowed root path does not exist: ${root}`,
                  details: { profileId: profile.id, root },
                  remediation: `Create directory "${root}" or remove from profile allowedRoots.`,
                });
              }
            } catch {
              checks.push({
                category: 'harnesses',
                name: `Allowed root: ${profile.name}`,
                status: 'fail',
                message: `Cannot access allowed root path: ${root}`,
                details: { profileId: profile.id, root },
                remediation: `Ensure path "${root}" exists and is accessible.`,
              });
            }
          }
        }

        // Live probe if requested
        if (options.live) {
          try {
            const models = await engine.executors.models({
              profileId: profile.id,
              refresh: true,
            });
            checks.push({
              category: 'harnesses',
              name: `Live probe: ${profile.name}`,
              status: 'ok',
              message: `Live probe succeeded (${models.models.length} model(s) available)`,
              details: {
                profileId: profile.id,
                modelCount: models.models.length,
              },
            });
          } catch (err) {
            checks.push({
              category: 'harnesses',
              name: `Live probe: ${profile.name}`,
              status: 'fail',
              message: `Live probe failed: ${err instanceof Error ? err.message : String(err)}`,
              details: { profileId: profile.id },
              remediation:
                'Verify network connectivity, API keys, or harness login credentials.',
            });
          }
        }
      }
    }
  } catch (err) {
    checks.push({
      category: 'harnesses',
      name: 'Harness configuration',
      status: 'warn',
      message: `Failed to inspect harness profiles: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  checks.push(engine.executors.errors.check());

  // ==========================================
  // 3. Active Triggers Checks
  // ==========================================
  try {
    const triggers = engine.store.workflowTriggers();
    let triggerIssues = 0;

    for (const trigger of triggers) {
      if (!trigger.enabled) continue;
      if (trigger.autoPaused) {
        triggerIssues++;
        checks.push({
          category: 'triggers',
          name: `Auto-paused ${trigger.kind}: ${trigger.name}`,
          status: 'fail',
          message: `${trigger.kind} trigger "${trigger.name}" is auto-paused after repeated failures (${trigger.consecutiveFailures ?? 0} failures)`,
          details: {
            triggerId: trigger.id,
            workflowId: trigger.workflowId,
            consecutiveFailures: trigger.consecutiveFailures,
          },
          remediation:
            'Inspect trigger outcomes and re-enable after resolving the failure.',
        });
      } else if ((trigger.consecutiveFailures ?? 0) > 0) {
        triggerIssues++;
        checks.push({
          category: 'triggers',
          name: `Consecutive failures: ${trigger.name}`,
          status: 'warn',
          message: `${trigger.kind} trigger "${trigger.name}" has ${trigger.consecutiveFailures} consecutive failure(s)`,
          details: {
            triggerId: trigger.id,
            workflowId: trigger.workflowId,
            consecutiveFailures: trigger.consecutiveFailures,
          },
          remediation: 'Inspect recent trigger outcomes and handler failures.',
        });
      }

      if (trigger.kind === 'schedule') {
        // Schedule lag
        if (
          trigger.enabled &&
          !trigger.autoPaused &&
          !engine.store.pauseHolds(trigger.workflowId).length
        ) {
          const lagMs = Date.now() - Date.parse(trigger.nextFireAt);
          if (lagMs > 60000) {
            triggerIssues++;
            const lagSec = Math.round(lagMs / 1000);
            checks.push({
              category: 'triggers',
              name: `Schedule lag: ${trigger.name}`,
              status: 'warn',
              message: `Schedule "${trigger.name}" is delayed by ${lagSec} seconds past nextFireAt`,
              details: {
                triggerId: trigger.id,
                workflowId: trigger.workflowId,
                lagMs,
                nextFireAt: trigger.nextFireAt,
              },
              remediation:
                'Check if the engine event loop or system timers are under heavy load.',
            });
          }
        }
      }
    }

    if (triggerIssues === 0) {
      checks.push({
        category: 'triggers',
        name: 'Triggers and schedules',
        status: 'ok',
        message: `${triggers.length} trigger(s) configured, no lag, trigger failures, or automatic pauses`,
        details: { totalTriggers: triggers.length },
      });
    }
  } catch (err) {
    checks.push({
      category: 'triggers',
      name: 'Trigger inspection',
      status: 'warn',
      message: `Failed to inspect triggers: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ==========================================
  // 4. Active Blockers & Stalls Checks
  // ==========================================
  try {
    let blockerIssues = 0;

    // 4a. Human pauses
    const pauses = engine.store
      .list<PauseHold>('pauseHolds')
      .filter((hold) => !hold.releasedAt);
    if (pauses.length > 0) {
      blockerIssues++;
      checks.push({
        category: 'blockers',
        name: 'Active pause holds',
        status: 'warn',
        message: `${pauses.length} active pause hold(s) preventing run execution`,
        details: {
          pauses: pauses.map((p) => ({
            id: p.id,
            scope: p.scope,
            reason: p.reason,
          })),
        },
        remediation: 'Review and resume active pause holds when ready.',
      });
    }

    // 4b. Uncertain resource/executor holds
    const uncertainClaims = engine.store.list(uncertainClaimCollection);
    const uncertainOps = engine.store.list(uncertainOperationCollection);
    const uncertainReservations = engine.store
      .list<ResourceReservation>('workResources')
      .filter((reservation) => reservation.state === 'uncertain');
    if (
      uncertainClaims.length > 0 ||
      uncertainOps.length > 0 ||
      uncertainReservations.length > 0
    ) {
      blockerIssues++;
      checks.push({
        category: 'blockers',
        name: 'Uncertain resource reservations',
        status: 'warn',
        message: `${uncertainClaims.length} uncertain claim(s) and ${uncertainOps.length} uncertain operation(s), and ${uncertainReservations.length} uncertain resource reservation(s)`,
        details: {
          uncertainClaimsCount: uncertainClaims.length,
          uncertainOperationsCount: uncertainOps.length,
          uncertainReservationsCount: uncertainReservations.length,
        },
        remediation:
          'Confirm whether stopped processes exited and reconcile resource reservations.',
      });
    }

    // 4c. Work stalls
    const stalls = engine.store.currentStalls();
    if (stalls.length > 0) {
      blockerIssues++;
      checks.push({
        category: 'blockers',
        name: 'Unresolved stalled work',
        status: 'fail',
        message: `${stalls.length} unresolved work stall(s) detected`,
        details: {
          stalls: stalls.map((s) => ({
            runId: s.runId,
            workId: s.workId,
            kind: s.kind,
            nodeId: s.nodeId,
          })),
        },
        remediation:
          'Inspect stalled work assignments and provide resolutions or manual retries.',
      });
    }

    // 4d. needs_model holds
    const managedExecutions =
      engine.store.list<ManagedExecution>('managedExecutions');
    const needsModel = managedExecutions.filter(
      (e) => e.state === 'needs_model',
    );
    if (needsModel.length > 0) {
      blockerIssues++;
      checks.push({
        category: 'blockers',
        name: 'Executions waiting for model (needs_model)',
        status: 'warn',
        message: `${needsModel.length} managed execution(s) held in needs_model state`,
        details: {
          executions: needsModel.map((e) => ({
            id: e.id,
            profileId: e.profile?.id,
          })),
        },
        remediation:
          'Select a supported model or enable a suitable harness profile.',
      });
    }

    if (blockerIssues === 0) {
      checks.push({
        category: 'blockers',
        name: 'Blockers and stalls',
        status: 'ok',
        message: 'No active pause holds, stalls, or uncertain resource locks',
      });
    }
  } catch (err) {
    checks.push({
      category: 'blockers',
      name: 'Blocker inspection',
      status: 'warn',
      message: `Failed to inspect blockers: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ==========================================
  // 5. Workflow & Dependency Integrity Checks
  // ==========================================
  try {
    const workflows = engine.store.workflows();
    let workflowIssues = 0;

    for (const workflow of workflows) {
      // Check published version
      if (workflow.latestVersion) {
        const version = engine.store.getVersion(
          workflow.id,
          workflow.latestVersion,
        );
        if (version?.definition) {
          // Check variable references
          const varRefs = variableReferences(version.definition);
          for (const ref of varRefs) {
            try {
              const variable = engine.variables.get(ref);
              if (!variable.enabled) {
                workflowIssues++;
                checks.push({
                  category: 'workflows',
                  name: `Disabled variable in workflow: ${workflow.name}`,
                  status: 'fail',
                  message: `Published workflow "${workflow.name}" references disabled variable "${variable.name}" (${ref})`,
                  details: {
                    workflowId: workflow.id,
                    version: workflow.latestVersion,
                    variableId: variable.id,
                  },
                  remediation: `Enable variable "${variable.name}" in Variables library.`,
                });
              } else if (variable.valueRevision === null) {
                workflowIssues++;
                checks.push({
                  category: 'workflows',
                  name: `Unset variable value in workflow: ${workflow.name}`,
                  status: 'fail',
                  message: `Published workflow "${workflow.name}" references variable "${variable.name}" with no set value`,
                  details: {
                    workflowId: workflow.id,
                    version: workflow.latestVersion,
                    variableId: variable.id,
                  },
                  remediation: `Provide a value for variable "${variable.name}" in Variables library.`,
                });
              } else if (engine.variables.status(variable) === 'locked') {
                workflowIssues++;
                checks.push({
                  category: 'workflows',
                  name: `Locked variable in workflow: ${workflow.name}`,
                  status: 'fail',
                  message: `Published workflow "${workflow.name}" references locked variable "${variable.name}"`,
                  details: {
                    workflowId: workflow.id,
                    version: workflow.latestVersion,
                    variableId: variable.id,
                  },
                  remediation:
                    'Restore the original readable variable encryption key, or replace the variable value with an available key.',
                });
              }
            } catch (err) {
              workflowIssues++;
              checks.push({
                category: 'workflows',
                name: `Missing variable in workflow: ${workflow.name}`,
                status: 'fail',
                message: `Published workflow "${workflow.name}" references missing variable "${ref}"`,
                details: {
                  workflowId: workflow.id,
                  version: workflow.latestVersion,
                  reference: ref,
                },
                remediation: `Create or bind variable "${ref}" in Variables library.`,
              });
            }
          }

          for (const promptId of promptIds(version.definition)) {
            const revision = version.pinnedPromptRevisions?.[promptId];
            try {
              if (
                version.definition.pinPromptsAtPublish &&
                revision === undefined
              )
                throw new Error('Published prompt pin metadata is missing');
              engine.prompts.get(promptId, revision);
            } catch {
              workflowIssues++;
              checks.push({
                category: 'workflows',
                name: `Unavailable saved prompt in workflow: ${workflow.name}`,
                status: 'fail',
                message: `Published workflow "${workflow.name}" requires unavailable prompt ${promptId}${revision === undefined ? '' : ` revision ${revision}`}`,
                details: {
                  workflowId: workflow.id,
                  version: workflow.latestVersion,
                  promptId,
                  ...(revision === undefined ? {} : { revision }),
                },
                remediation:
                  version.definition.pinPromptsAtPublish ||
                  revision !== undefined
                    ? 'Restore the exact published prompt revision and pin metadata, or publish a corrected workflow version.'
                    : 'Restore the current saved prompt or update and publish the workflow reference.',
              });
            }
          }

          // Check model aliases referenced
          const modelRefs = modelReferences(version.definition);
          for (const mRef of modelRefs) {
            const alias = engine.modelAliases.get(mRef);
            const requirement = engine.modelAliases.requirement(mRef);
            if (!engine.modelAliases.usesReference(version.definition, mRef))
              continue;
            const agents = version.definition.nodes
              .filter((node) => node.kind === 'agent')
              .filter(
                (node) =>
                  agentAliasReference(node, version.definition) === mRef,
              );
            if (
              !alias &&
              (requirement ||
                agents.some((node) => selectsPreset(node, version.definition)))
            ) {
              const aliasName = requirement?.name ?? mRef;
              workflowIssues++;
              checks.push({
                category: 'workflows',
                name: `Missing model alias in workflow: ${workflow.name}`,
                status: 'fail',
                message: `Published workflow "${workflow.name}" requires missing local alias "${aliasName}"`,
                details: {
                  workflowId: workflow.id,
                  version: workflow.latestVersion,
                  reference: mRef,
                  aliasName,
                },
                remediation: `Configure local alias "${aliasName}" before starting a new run.`,
              });
            } else if (alias && alias.candidates.length === 0) {
              workflowIssues++;
              checks.push({
                category: 'workflows',
                name: `Empty model alias in workflow: ${workflow.name}`,
                status: 'warn',
                message: `Published workflow "${workflow.name}" references model alias "${alias.name}" which has no candidate models`,
                details: {
                  workflowId: workflow.id,
                  aliasId: alias.id,
                  aliasName: alias.name,
                },
                remediation: `Add candidate models to alias "${alias.name}".`,
              });
            } else if (alias) {
              const problem = agents
                .map((node) =>
                  engine.modelAliases.eligibilityProblem(
                    version.definition,
                    node,
                    alias,
                  ),
                )
                .find(Boolean);
              if (!problem) continue;
              workflowIssues++;
              checks.push({
                category: 'workflows',
                name: `Unavailable model alias profiles in workflow: ${workflow.name}`,
                status: 'fail',
                message: problem,
                details: {
                  workflowId: workflow.id,
                  version: workflow.latestVersion,
                  aliasId: alias.id,
                  aliasName: alias.name,
                },
                remediation: `Check the harnesses and permissions for "${alias.name}".`,
              });
            }
          }
        }
      }

      const privateFetch = privateFetchCheck(workflow, engine.store);
      if (privateFetch) {
        workflowIssues++;
        checks.push(privateFetch);
      }

      // Check unpublished drafts of active workflows
      if (!workflow.archived && workflow.latestVersion) {
        const latest = engine.store.getVersion(
          workflow.id,
          workflow.latestVersion,
        );
        if (latest) {
          const draftMatches = sameWorkflowContent(
            workflow.draft,
            latest.definition,
          );
          if (!draftMatches) {
            workflowIssues++;
            checks.push({
              category: 'workflows',
              name: `Unpublished draft: ${workflow.name}`,
              status: 'warn',
              message: `Workflow "${workflow.name}" has unpublished draft modifications differing from v${workflow.latestVersion}`,
              details: {
                workflowId: workflow.id,
                draftRevision: workflow.draftRevision,
                publishedVersion: workflow.latestVersion,
              },
              remediation:
                'Publish the draft or review changes in Workflow Editor.',
            });
          }
        }
      }
    }

    if (workflowIssues === 0) {
      checks.push({
        category: 'workflows',
        name: 'Workflow dependencies',
        status: 'ok',
        message: `${workflows.length} workflow(s) verified; all referenced variables and dependencies exist and are enabled`,
        details: { totalWorkflows: workflows.length },
      });
    }
  } catch (err) {
    checks.push({
      category: 'workflows',
      name: 'Workflow dependency inspection',
      status: 'warn',
      message: `Failed to inspect workflow dependencies: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // ==========================================
  // Summary & Overall Status
  // ==========================================
  const summary = {
    total: checks.length,
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };

  const status: DiagnosticStatus =
    summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'ok';

  return {
    status,
    checkedAt: new Date().toISOString(),
    summary,
    checks,
  };
}
