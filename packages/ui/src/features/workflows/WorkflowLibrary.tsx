import { useUiFeatures } from '../../lib/uiFeatures';
import type { Action } from '../../lib/useActionFeedback';
import { ActionIcon, Menu, Tabs, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  BookOpen,
  Plus,
  Search,
  Upload,
  GitBranch,
  Copy,
  Archive,
  Trash2,
  Download,
  MoreHorizontal,
} from 'lucide-react';
import type { Workflow } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import { api, download } from '../../lib/api';
import { ImportWorkflowDialog } from './ImportWorkflowDialog';
import { DeleteWorkflowDialog } from './DeleteWorkflowDialog';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';
import styles from './WorkflowLibrary.module.css';
export function WorkflowLibrary({
  workflows,
  onOpen,
  act,
}: {
  workflows: Workflow[];
  onOpen: (id: string) => void;
  act: Action;
}) {
  const features = useUiFeatures();
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false);
  const [importing, setImporting] = useState(false);
  const importTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!importing) importTrigger.current?.focus();
  }, [importing]);
  const [deleting, setDeleting] = useState<Workflow>();
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const createPending = useRef(false);
  const create = async () => {
    if (createPending.current) return;
    createPending.current = true;
    setCreating(true);
    try {
      await act(async () => {
        const workflow = await api.workflows.create.mutate({
          name: 'Untitled workflow',
        });
        onOpen(workflow.id);
      }, 'Workflow created.');
    } finally {
      createPending.current = false;
      setCreating(false);
    }
  };
  const visible = workflows.filter(
    (w) =>
      !w.ownerWorkflowId &&
      w.archived === archived &&
      `${w.name} ${w.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={layout.page}>
      <header className={`${layout.header} ${layout.libraryHeader}`}>
        <div>
          <h1>Workflows</h1>
          <p>Create, organize, and run your workflows.</p>
        </div>
        <div className="actions">
          <Button
            onClick={(event) => {
              importTrigger.current = event.currentTarget;
              setImporting(true);
            }}
          >
            <Upload />
            Import
          </Button>
          <Button
            variant="primary"
            disabled={creating}
            aria-busy={creating}
            onClick={() => void create()}
          >
            <Plus />
            {creating ? 'Creating…' : 'New workflow'}
          </Button>
        </div>
      </header>
      <Tabs
        value={archived ? 'archived' : 'active'}
        onChange={(value) => setArchived(value === 'archived')}
      >
        <div className={layout.libraryToolbar}>
          <Tabs.List>
            <Tabs.Tab value="active">
              Active{' '}
              {
                workflows.filter((w) => !w.ownerWorkflowId && !w.archived)
                  .length
              }
            </Tabs.Tab>
            <Tabs.Tab value="archived">Archived</Tabs.Tab>
          </Tabs.List>
          <TextInput
            className={layout.librarySearch}
            size="xs"
            aria-label="Search workflows"
            placeholder="Search workflows..."
            leftSection={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Tabs.Panel value={archived ? 'archived' : 'active'}>
          <div className={styles.grid}>
            {visible.map((w) => (
              <article
                key={w.id}
                className={`${styles.card} ${importedIds.includes(w.id) ? styles.imported : ''}`}
              >
                <div className={styles.cardTop}>
                  <span className={styles.cardIcon}>
                    <GitBranch size={19} />
                  </span>
                  <Menu position="bottom-end" width={160}>
                    <Menu.Target>
                      <ActionIcon
                        className={styles.cardMenu}
                        variant="subtle"
                        color="gray"
                        aria-label={`Actions for ${w.name}`}
                      >
                        <MoreHorizontal size={19} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<Copy size={14} />}
                        disabled={workflows.some(
                          (child) => child.ownerWorkflowId === w.id,
                        )}
                        onClick={() =>
                          void act(async () => {
                            const copy = await api.workflows.clone.mutate({
                              id: w.id,
                            });
                            onOpen(copy.id);
                          }, 'Workflow cloned.')
                        }
                      >
                        Clone
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Download size={14} />}
                        onClick={() =>
                          void act(
                            async () =>
                              download(
                                `${w.name}.json`,
                                await api.workflows.export.query({ id: w.id }),
                              ),
                            'Workflow exported.',
                          )
                        }
                      >
                        Export
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<Archive size={14} />}
                        onClick={() =>
                          void act(
                            () =>
                              api.workflows.update.mutate({
                                id: w.id,
                                archived: !w.archived,
                              }),
                            w.archived
                              ? 'Workflow restored.'
                              : 'Workflow archived.',
                          )
                        }
                      >
                        {w.archived ? 'Restore' : 'Archive'}
                      </Menu.Item>
                      <Menu.Divider />
                      <Menu.Item
                        color="red"
                        leftSection={<Trash2 size={14} />}
                        onClick={() => setDeleting(w)}
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </div>
                <div className={styles.cardBody}>
                  <h2>
                    <Link className={styles.cardLink} to={paths.workflow(w.id)}>
                      {w.name}
                    </Link>
                  </h2>
                  <p>
                    {w.description || 'A new procedure, ready to take shape.'}
                  </p>
                </div>
                <div className={styles.cardFooter}>
                  <span>
                    {w.draft.nodes.length} nodes <b>·</b>{' '}
                    {workflows.some(
                      (child) => child.ownerWorkflowId === w.id,
                    ) && (
                      <>
                        {
                          workflows.filter(
                            (child) => child.ownerWorkflowId === w.id,
                          ).length
                        }{' '}
                        {workflows.filter(
                          (child) => child.ownerWorkflowId === w.id,
                        ).length === 1
                          ? 'child'
                          : 'children'}{' '}
                        <b>·</b>{' '}
                      </>
                    )}
                    {w.latestVersion ? `v${w.latestVersion}` : 'Unpublished'}
                  </span>
                  <Badge status={w.latestVersion ? 'published' : 'draft'} />
                  <span className={styles.cardArrow} aria-hidden="true">
                    <ArrowRight size={15} />
                  </span>
                </div>
              </article>
            ))}
            <button
              className={styles.newCard}
              onClick={() => {
                if (!workflows.some((w) => !w.ownerWorkflowId)) {
                  setImporting(true);
                  return;
                }
                void act(async () => {
                  const w = await api.workflows.create.mutate({
                    name: 'Untitled workflow',
                  });
                  onOpen(w.id);
                }, 'Workflow created.');
              }}
            >
              <span>
                {!workflows.some((w) => !w.ownerWorkflowId) ? (
                  <BookOpen size={23} />
                ) : (
                  <Plus size={23} />
                )}
              </span>
              {!workflows.some((w) => !w.ownerWorkflowId) ? (
                <>
                  Browse starter workflows
                  <small>Choose a procedure to add to your library</small>
                </>
              ) : (
                <>
                  Create a workflow
                  <small>Start with an input and an idea</small>
                </>
              )}
            </button>
          </div>
        </Tabs.Panel>
      </Tabs>
      {importing && (
        <ImportWorkflowDialog
          act={act}
          onImported={(ids) => {
            if (ids.length === 1) onOpen(ids[0]);
            else {
              setImportedIds(ids);
              setQuery('');
              setArchived(false);
            }
          }}
          onClose={() => setImporting(false)}
          allowLocalFile={features.localFileImport}
        />
      )}
      {deleting && (
        <DeleteWorkflowDialog
          workflow={deleting}
          hasChildren={workflows.some(
            (child) => child.ownerWorkflowId === deleting.id,
          )}
          act={act}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDeleting(undefined)}
        />
      )}
      <div className={styles.caption}>
        Workflows run on your local engine.
        {features.connectAgent &&
          ' Connect a harness to pick up agent assignments.'}
      </div>
    </div>
  );
}
