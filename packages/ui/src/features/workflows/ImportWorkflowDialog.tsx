import {
  LoadingSkeleton,
  Placeholder,
  Checkbox,
  Radio,
  Stack,
  Textarea,
  TextInput,
  Modal,
  ModalBody,
  ModalFooter,
  Button,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { BookOpen, Braces, FileJson, FolderGit2, Upload } from 'lucide-react';

import { api, errorMessage } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import { importWorkflowJson } from './importWorkflowJson';
import { Details } from './ImportDetails';
import {
  BoardImportEditor,
  boardImportChoices,
  mergeBoardImportPreviews,
  type BoardImportDrafts,
} from './BoardImportEditor';
import styles from './ImportWorkflowDialog.module.css';
import { VariableImportBindingsEditor } from '../variables/VariableImportBindings';
import {
  boardSettingsRevisionConflict,
  variableImportBindingsSchema,
  type VariableImportBindings,
} from '@interlock/core';

type Source = 'starters' | 'github' | 'file' | 'paste';
type GithubPreview = Awaited<
  ReturnType<typeof api.workflows.discoverGithub.query>
>;
type DocumentPreview = Awaited<
  ReturnType<typeof api.workflows.previewImport.query>
>;
type Starter = Awaited<ReturnType<typeof api.workflows.starters.query>>[number];
type LocalDocument = {
  text: string;
  filename?: string;
  preview: DocumentPreview;
  generation: number;
};
const emptyBoardDrafts: BoardImportDrafts = new Map();
export function ImportWorkflowDialog({
  onClose,
  onImported,
  allowLocalFile = true,
  act,
}: {
  onClose: () => void;
  onImported?: (ids: string[]) => void;
  allowLocalFile?: boolean;
  act: Action;
}) {
  const [source, setSource] = useState<Source>('starters');
  const [catalog, setCatalog] = useState<Starter[]>();
  const [selectedStarter, setSelectedStarter] = useState('sdlc');
  const [copy, setCopy] = useState(false);
  const [url, setUrl] = useState(''),
    [json, setJson] = useState('');
  const [github, setGithub] = useState<GithubPreview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [documents, setDocuments] = useState<
    Partial<Record<'file' | 'paste', LocalDocument>>
  >({});
  const [errors, setErrors] = useState<Partial<Record<Source, string>>>({});
  const [loading, setLoading] = useState<Partial<Record<Source, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [refreshingBoard, setRefreshingBoard] = useState(false);
  const controlsDisabled = busy || refreshingBoard;
  const [variableBindings, setVariableBindings] =
    useState<VariableImportBindings>({});
  const [boardDraftState, setBoardDraftState] = useState<{
    scope: string;
    drafts: BoardImportDrafts;
  }>();
  const mounted = useRef(true),
    importing = useRef(false),
    githubGeneration = useRef(0),
    documentGeneration = useRef({ file: 0, paste: 0 }),
    request = useRef({ identity: '', id: '' });
  const file = useRef<HTMLInputElement>(null),
    panel = useRef<HTMLElement>(null);
  const error = (kind: Source, message = '') => {
    if (mounted.current) setErrors((e) => ({ ...e, [kind]: message }));
  };
  const load = (kind: Source, value: boolean) => {
    if (mounted.current) setLoading((l) => ({ ...l, [kind]: value }));
  };
  const loadStarters = async () => {
    load('starters', true);
    error('starters');
    try {
      const rows = await api.workflows.starters.query();
      if (mounted.current) setCatalog(rows);
    } catch (e) {
      error('starters', errorMessage(e));
    } finally {
      load('starters', false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void loadStarters();
    return () => {
      mounted.current = false;
      githubGeneration.current++;
      documentGeneration.current.file++;
      documentGeneration.current.paste++;
    };
  }, []);
  const changeSource = (value: Source) => {
    setSource(value);
    panel.current?.scrollTo?.(0, 0);
  };
  const discover = async () => {
    const generation = ++githubGeneration.current;
    load('github', true);
    error('github');
    try {
      const result = await api.workflows.discoverGithub.query({
        url: url.trim(),
      });
      if (mounted.current && generation === githubGeneration.current) {
        setGithub(result);
        setSelected([]);
      }
    } catch (e) {
      if (generation === githubGeneration.current)
        error('github', errorMessage(e));
    } finally {
      if (generation === githubGeneration.current) load('github', false);
    }
  };
  const prepare = async (
    kind: 'file' | 'paste',
    text: string,
    filename?: string,
    expectedGeneration?: number,
  ) => {
    const generation = expectedGeneration ?? ++documentGeneration.current[kind];
    load(kind, true);
    error(kind);
    try {
      let document;
      try {
        document = JSON.parse(text);
        if (
          document === null ||
          typeof document !== 'object' ||
          Array.isArray(document)
        )
          throw new Error('Use a workflow JSON object or a portable bundle.');
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Use a workflow'))
          throw e;
        throw new Error('Enter valid JSON before importing.');
      }
      const preview = await api.workflows.previewImport.query({ document });
      if (mounted.current && generation === documentGeneration.current[kind])
        setDocuments((d) => ({
          ...d,
          [kind]: { text, filename, preview, generation },
        }));
    } catch (e) {
      if (generation === documentGeneration.current[kind])
        error(kind, errorMessage(e));
    } finally {
      if (generation === documentGeneration.current[kind]) load(kind, false);
    }
  };
  const readFile = async (value?: File) => {
    if (!value) return;
    const generation = ++documentGeneration.current.file;
    load('file', true);
    setDocuments((d) => ({ ...d, file: undefined }));
    if (value.size > 2 * 1024 * 1024) {
      load('file', false);
      error('file', 'Choose a JSON file smaller than 2 MiB.');
      return;
    }
    try {
      const text = await value.text();
      if (!mounted.current || generation !== documentGeneration.current.file)
        return;
      await prepare('file', text, value.name, generation);
    } catch (e) {
      if (generation === documentGeneration.current.file) {
        load('file', false);
        error('file', errorMessage(e));
      }
    }
  };
  const starter = catalog?.find((s) => s.id === selectedStarter);
  const local =
    source === 'file' || source === 'paste' ? documents[source] : undefined;
  const boardScope = JSON.stringify([
    source,
    source === 'starters'
      ? [selectedStarter, copy]
      : source === 'github'
        ? [githubGeneration.current, ...selected.toSorted()]
        : local?.generation,
  ]);
  const boardDrafts =
    boardDraftState?.scope === boardScope
      ? boardDraftState.drafts
      : emptyBoardDrafts;
  const boardPreview = mergeBoardImportPreviews(
    source === 'github'
      ? (github?.items
          .filter((item) => item.valid && selected.includes(item.file))
          .map((item) => (item.valid ? item.boardSetup : undefined)) ?? [])
      : source === 'starters'
        ? [starter?.existing && !copy ? undefined : starter?.boardSetup]
        : [local?.preview.boardSetup],
  );
  const destinationBoards =
    (source === 'github'
      ? github?.boards
      : source === 'starters'
        ? starter?.boardSetup?.boards
        : local?.preview.boardSetup?.boards) ?? [];
  const boardChoices = boardImportChoices(
    boardPreview.suggestions,
    boardDrafts,
  );
  const requiredVariables = [
    ...new Map(
      (source === 'github'
        ? (github?.items
            .filter((item) => selected.includes(item.file))
            .flatMap((item) => item.variables ?? []) ?? [])
        : (local?.preview.variables ?? [])
      ).map((v) => [v.id, v]),
    ).values(),
  ];
  const selectedBindings = Object.fromEntries(
    requiredVariables.flatMap((v) =>
      variableBindings[v.id] ? [[v.id, variableBindings[v.id]]] : [],
    ),
  );
  const unresolvedVariables = requiredVariables.filter((variable) => {
    const choice = variableBindings[variable.id];
    return (
      !choice ||
      (choice.action === 'bind' && !choice.variableId) ||
      !variableImportBindingsSchema.safeParse({ [variable.id]: choice }).success
    );
  }).length;
  const invalidProvisionNames = requiredVariables.filter((variable) => {
    const choice = variableBindings[variable.id];
    return (
      choice?.action === 'provision' &&
      !variableImportBindingsSchema.safeParse({ [variable.id]: choice }).success
    );
  }).length;
  const finish = (ids: string[]) => {
    onClose();
    onImported?.([...new Set(ids)]);
  };
  const add = async () => {
    if (importing.current || refreshingBoard) return;
    if (unresolvedVariables) {
      error(
        source,
        'Choose how to provide each required variable before importing.',
      );
      return;
    }
    if (!boardChoices) {
      error(source, 'Complete board setup or choose Skip board setup.');
      return;
    }
    if (source === 'starters' && starter?.existing && !copy) {
      finish([starter.existing.id]);
      return;
    }
    const identity = JSON.stringify([
      boardScope,
      boardChoices,
      source === 'github' ? selected : undefined,
      selectedBindings,
    ]);
    if (request.current.identity !== identity)
      request.current = { identity, id: crypto.randomUUID() };
    const boardSetup = boardChoices.length
      ? { requestId: request.current.id, choices: boardChoices }
      : undefined;
    importing.current = true;
    setBusy(true);
    error(source);
    try {
      await act(async () => {
        try {
          if (source === 'starters' && starter) {
            const result = await api.workflows.importStarter.mutate({
              starterId: starter.id,
              requestId: request.current.id,
              copy,
              ...(boardSetup ? { boardSetup } : {}),
            });
            finish([result.workflow.id]);
          } else if (source === 'github' && github && selected.length) {
            const result = await api.workflows.importGithub.mutate({
              source: github.source,
              files: selected,
              ...(boardSetup ? { boardSetup } : {}),
              ...(requiredVariables.length
                ? { variableBindings: selectedBindings }
                : {}),
            });
            finish(result.rootIds);
          } else if (local)
            finish([
              await importWorkflowJson(
                local.text,
                selectedBindings,
                boardSetup,
              ),
            ]);
        } catch (e) {
          const detail = errorMessage(e);
          const message =
            source === 'github' && !detail.startsWith('Nothing imported:')
              ? boardSetup
                ? `The import result could not be confirmed. Retry without changing the import choices to recover the result. ${detail}`
                : `The import result could not be confirmed. Inspect the library before retrying. ${detail}`
              : detail;
          error(source, message);
          throw new Error(message);
        }
      }, 'Workflows added to your library.');
    } finally {
      importing.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const needsDiscovery =
    source === 'github' && (!github || !github.items.some((i) => i.valid));
  const primary =
    source === 'starters'
      ? starter?.existing && !copy
        ? 'Open workflow'
        : 'Add to library'
      : needsDiscovery
        ? 'Find workflows'
        : source === 'file' && !local
          ? 'Choose JSON file'
          : source === 'paste' && !local
            ? 'Preview workflow'
            : source === 'github' && selected.length > 1
              ? `Import ${selected.length} workflows`
              : 'Import workflow';
  const disabled =
    busy ||
    refreshingBoard ||
    loading[source] ||
    !boardChoices ||
    (unresolvedVariables > 0 &&
      (source === 'github' ? !needsDiscovery : !!local)) ||
    (source === 'starters'
      ? !starter
      : source === 'github'
        ? needsDiscovery
          ? !url.trim()
          : !selected.length
        : source === 'paste'
          ? !json.trim()
          : false);
  const primaryAction = () =>
    source === 'github' && needsDiscovery
      ? discover()
      : source === 'file' && !local
        ? file.current?.click()
        : source === 'paste' && !local
          ? prepare('paste', json)
          : add();
  const sources = [
    { id: 'github', label: 'GitHub folder', icon: FolderGit2 },
    ...(allowLocalFile
      ? [{ id: 'file', label: 'Local file', icon: FileJson }]
      : []),
    { id: 'paste', label: 'Paste JSON', icon: Braces },
    { id: 'starters', label: 'Starters', icon: BookOpen },
  ] as const;
  return (
    <Modal
      title={
        <span className={styles.title}>
          <Upload size={18} />
          Import workflows
        </span>
      }
      size={920}
      height={740}
      busy={controlsDisabled}
      onClose={() => {
        if (!importing.current && !refreshingBoard) onClose();
      }}
    >
      <ModalBody flush>
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <nav aria-label="Import source">
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={source === s.id ? 'page' : undefined}
                  disabled={controlsDisabled}
                  onClick={() => changeSource(s.id as Source)}
                >
                  <s.icon size={17} />
                  {s.label}
                </button>
              ))}
            </nav>
          </aside>
          <section
            className={styles.panel}
            ref={panel}
            aria-labelledby="import-source-heading"
          >
            <h2 id="import-source-heading">
              {source === 'starters'
                ? 'Starter workflows'
                : sources.find((s) => s.id === source)?.label}
            </h2>
            {source === 'starters' && (
              <>
                {loading.starters && !catalog && (
                  <LoadingSkeleton label="Loading starters…">
                    {[1, 2, 3].map((row) => (
                      <div className={styles.starterRow} key={row}>
                        <Placeholder h={14} w="60%" />
                        <Placeholder mt={8} h={10} w="85%" />
                      </div>
                    ))}
                  </LoadingSkeleton>
                )}
                {catalog && (
                  <Radio.Group
                    value={selectedStarter}
                    onChange={(value) => {
                      setSelectedStarter(value);
                      setCopy(false);
                      error('starters');
                    }}
                    aria-label="Starter workflow"
                  >
                    <Stack gap={0}>
                      {catalog.map((s) => (
                        <div
                          className={styles.starterRow}
                          data-selected={s.id === selectedStarter || undefined}
                          key={s.id}
                        >
                          <Radio
                            disabled={controlsDisabled}
                            value={s.id}
                            label={s.name}
                            description={s.description}
                          />
                          {s.existing && (
                            <span className={styles.existing}>
                              In your library
                            </span>
                          )}
                        </div>
                      ))}
                    </Stack>
                  </Radio.Group>
                )}
                {starter && (
                  <div className={styles.starterContext}>
                    <p>{starter.requirements}</p>
                    {starter.existing && (
                      <>
                        <p className="hint">
                          Your copy: <strong>{starter.existing.name}</strong>
                          {starter.existing.archived
                            ? ' · Archived'
                            : starter.existing.latestVersion
                              ? ` · v${starter.existing.latestVersion}`
                              : ' · Draft'}
                        </p>
                        <Checkbox
                          disabled={controlsDisabled}
                          label="Add another copy"
                          checked={copy}
                          onChange={(e) => setCopy(e.currentTarget.checked)}
                        />
                      </>
                    )}
                  </div>
                )}
                {!!errors.starters && (
                  <Button variant="ghost" onClick={() => void loadStarters()}>
                    Reload starters
                  </Button>
                )}
              </>
            )}
            {source === 'github' && (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (url.trim() && !controlsDisabled && !loading.github)
                      void discover();
                  }}
                >
                  <TextInput
                    label="Public GitHub folder URL"
                    placeholder="https://github.com/owner/repo/tree/branch/folder"
                    value={url}
                    disabled={controlsDisabled}
                    onChange={(e) => {
                      githubGeneration.current++;
                      setUrl(e.currentTarget.value);
                      setGithub(undefined);
                      setSelected([]);
                      load('github', false);
                      error('github');
                    }}
                  />
                </form>
                {loading.github && (
                  <LoadingSkeleton
                    label="Reading workflows from GitHub…"
                    className={styles.documentPreview}
                  />
                )}
                {github && (
                  <>
                    <div className={styles.resultHeading}>
                      <h3>Choose workflows</h3>
                      <Button
                        variant="ghost"
                        disabled={controlsDisabled || loading.github}
                        onClick={() => void discover()}
                      >
                        Reload folder
                      </Button>
                    </div>
                    {!github.items.some((i) => i.valid) && (
                      <p role="status">
                        No importable workflows were found in this folder.
                      </p>
                    )}
                    {github.items.map((item) => (
                      <article className={styles.resultRow} key={item.file}>
                        {item.valid ? (
                          <>
                            <Checkbox
                              disabled={controlsDisabled}
                              label={item.name}
                              checked={selected.includes(item.file)}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setSelected((ids) =>
                                  checked
                                    ? [...ids, item.file]
                                    : ids.filter((id) => id !== item.file),
                                );
                              }}
                            />
                            <div className={styles.resultBody}>
                              {item.description && <p>{item.description}</p>}
                              <Details
                                item={item}
                                filename={item.file}
                                commit={github.source.commit}
                              />
                            </div>
                          </>
                        ) : (
                          <details>
                            <summary>{item.file} · Cannot import</summary>
                            <p className={styles.error}>{item.error}</p>
                          </details>
                        )}
                      </article>
                    ))}
                  </>
                )}
              </>
            )}
            {(source === 'file' || source === 'paste') && (
              <>
                {source === 'file' && (
                  <input
                    ref={file}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      void readFile(e.currentTarget.files?.[0]);
                      e.currentTarget.value = '';
                    }}
                  />
                )}
                {source === 'file' && !local && (
                  <div
                    className={styles.dropZone}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!controlsDisabled)
                        void readFile(e.dataTransfer.files[0]);
                    }}
                  >
                    <FileJson size={26} />
                    <p>Drop a workflow JSON file here</p>
                    <Button
                      disabled={controlsDisabled}
                      onClick={() => file.current?.click()}
                    >
                      Browse files
                    </Button>
                  </div>
                )}
                {source === 'paste' && !local && (
                  <Textarea
                    label="Workflow JSON"
                    description="A workflow definition or a portable bundle with its dependencies."
                    value={json}
                    disabled={controlsDisabled}
                    rows={13}
                    spellCheck={false}
                    className={styles.json}
                    onChange={(e) => {
                      documentGeneration.current.paste++;
                      setJson(e.currentTarget.value);
                      load('paste', false);
                      error('paste');
                    }}
                  />
                )}
                {local && (
                  <>
                    <div className={styles.resultHeading}>
                      <h3>Review import</h3>
                      <Button
                        variant="ghost"
                        disabled={controlsDisabled}
                        onClick={() =>
                          source === 'file'
                            ? file.current?.click()
                            : setDocuments((d) => ({ ...d, paste: undefined }))
                        }
                      >
                        {source === 'file' ? 'Change file' : 'Edit JSON'}
                      </Button>
                    </div>
                    <article className={styles.documentPreview}>
                      <h3>{local.preview.name}</h3>
                      {local.preview.description && (
                        <p>{local.preview.description}</p>
                      )}
                      <p className="hint">
                        {local.preview.published
                          ? 'Includes published versions.'
                          : 'Added as a draft. Review and publish before running.'}
                      </p>
                      <Details item={local.preview} filename={local.filename} />
                    </article>
                  </>
                )}
                {loading[source] && (
                  <LoadingSkeleton
                    label="Reading workflow…"
                    className={styles.documentPreview}
                  />
                )}
              </>
            )}
            {(boardPreview.suggestions.length > 0 ||
              boardPreview.unresolved.length > 0) && (
              <BoardImportEditor
                key={boardScope}
                {...boardPreview}
                boards={destinationBoards}
                drafts={boardDrafts}
                onChange={(drafts) =>
                  setBoardDraftState({ scope: boardScope, drafts })
                }
                onRefreshing={setRefreshingBoard}
                boardConflict={
                  errors[source]?.includes(boardSettingsRevisionConflict) ??
                  false
                }
                disabled={controlsDisabled}
              />
            )}
            <VariableImportBindingsEditor
              requirements={requiredVariables}
              choices={variableBindings}
              onChange={setVariableBindings}
              disabled={controlsDisabled}
            />
            {errors[source] && (
              <p role="alert" className={styles.error}>
                {errors[source]}
              </p>
            )}
          </section>
        </div>
      </ModalBody>
      <ModalFooter
        aside={
          <p
            className={styles.footerNote}
            aria-live="polite"
            aria-atomic="true"
          >
            {!boardChoices
              ? 'Complete board setup or choose Skip board setup.'
              : invalidProvisionNames
                ? `Fix ${invalidProvisionNames} local variable name${invalidProvisionNames === 1 ? '' : 's'} to enable import.`
                : unresolvedVariables
                  ? `Choose how to provide ${unresolvedVariables} required variable${unresolvedVariables === 1 ? '' : 's'} to enable import.`
                  : source === 'starters' &&
                      starter &&
                      (!starter.existing || copy)
                    ? 'Adds a published copy. Nothing runs automatically.'
                    : source === 'github' && selected.length
                      ? `${selected.length} selected. Included dependencies come with them.`
                      : ''}
          </p>
        }
      >
        <Button disabled={controlsDisabled} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!!disabled}
          onClick={() => void primaryAction()}
        >
          {busy ? 'Importing…' : primary}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
