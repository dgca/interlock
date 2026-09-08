import type { Action } from '../../lib/useActionFeedback';
import { ActionIcon, Menu, Tabs, TextInput } from '@mantine/core';
import { useRef, useState } from 'react';
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
              All workflows {workflows.filter((w) => !w.archived).length}
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
                          download(`${w.name}.json`, {
                            name: w.name,
                            description: w.description,
                            definition: w.draft,
                          })
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
                <button
                  className={styles.cardBody}
                  onClick={() => onOpen(w.id)}
                >
                  <h2>{w.name}</h2>
                  <p>
                    {w.description || 'A new procedure, ready to take shape.'}
                  </p>
                </button>
                <div className={styles.cardFooter}>
                  <span>
                    {w.draft.nodes.length} nodes <b>·</b>{' '}
                    {w.latestVersion ? `v${w.latestVersion}` : 'Unpublished'}
                  </span>
                  <Badge status={w.latestVersion ? 'published' : 'draft'} />
                  <button
                    aria-label={`Open ${w.name}`}
                    onClick={() => onOpen(w.id)}
                  >
                    <ArrowRight size={15} />
                  </button>
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
