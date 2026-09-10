import type { Action } from '../../lib/useActionFeedback';
import { ActionIcon, Menu, Tabs, TextInput } from '@mantine/core';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
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
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false);
  const [deleting, setDeleting] = useState<Workflow>();
  const file = useRef<HTMLInputElement>(null);
  const visible = workflows.filter(
    (w) =>
      !w.ownerWorkflowId &&
      w.archived === archived &&
      `${w.name} ${w.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div>
          <h1>Workflows</h1>
          <p>Create, organize, and run your workflows.</p>
        </div>
        <div className="actions">
          <Button onClick={() => file.current?.click()}>
            <Upload />
            Import
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void act(async () => {
                const w = await api.workflows.create.mutate({
                  name: 'Untitled workflow',
                });
                onOpen(w.id);
              }, 'Workflow created.')
            }
          >
            <Plus />
            New workflow
          </Button>
        </div>
      </header>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const selected = e.target.files?.[0];
          if (selected)
            void act(async () => {
              const data = JSON.parse(await selected.text());
              if (data.format === 'interlock-workflows') {
                const result = await api.workflows.import.mutate({
                  bundle: data,
                });
                onOpen(result.rootId);
                return;
              }
              const w = await api.workflows.create.mutate(data);
              onOpen(w.id);
            }, 'Workflow imported.');
          e.target.value = '';
        }}
      />
      <Tabs
        value={archived ? 'archived' : 'active'}
        onChange={(value) => setArchived(value === 'archived')}
      >
        <div className={styles.toolbar}>
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
              <article key={w.id} className={styles.card}>
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
              onClick={() =>
                void act(async () => {
                  const w = await api.workflows.create.mutate({
                    name: 'Untitled workflow',
                  });
                  onOpen(w.id);
                }, 'Workflow created.')
              }
            >
              <span>
                <Plus size={23} />
              </span>
              Create a workflow<small>Start with an input and an idea</small>
            </button>
          </div>
        </Tabs.Panel>
      </Tabs>
      {deleting && (
        <DeleteWorkflowDialog
          workflow={deleting}
          act={act}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDeleting(undefined)}
        />
      )}
      <div className={styles.caption}>
        Workflows run on your local engine. Connect a harness to pick up agent
        assignments.
      </div>
    </div>
  );
}
