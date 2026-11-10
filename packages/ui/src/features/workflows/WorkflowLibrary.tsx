import {
  ActionIcon,
  Menu,
  Tabs,
  TextInput,
  Button,
  EmptyState,
  PageHeader,
  PageTabList,
  workspacePage,
} from '../../design-system';

import { useUiFeatures } from '../../lib/uiFeatures';
import type { Action } from '../../lib/useActionFeedback';

import { useRef, useState } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Upload,
  Copy,
  Archive,
  Trash2,
  Download,
  MoreHorizontal,
} from 'lucide-react';
import type { Workflow } from '@interlock/core';

import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import { api, download } from '../../lib/api';
import { ImportWorkflowDialog } from './ImportWorkflowDialog';
import { DeleteWorkflowDialog } from './DeleteWorkflowDialog';
import { paths } from '../../routes/paths';

import {
  WorkflowCard,
  WorkflowGrid,
} from '../../components/WorkflowCards/WorkflowCards';

import { workflowTabs } from './workflowListConfig';
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
  const searchInput = useRef<HTMLInputElement>(null);
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
  const library = workflows.filter((w) => !w.ownerWorkflowId);
  const scope = library.filter((w) =>
    `${w.name} ${w.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const visible = scope.filter((w) => w.archived === archived);
  return (
    <Tabs
      unstyled
      value={archived ? 'archived' : 'active'}
      onChange={(value) => setArchived(value === 'archived')}
      className={workspacePage.page}
    >
      <PageHeader
        title="Workflows"
        controls={
          <TextInput
            ref={searchInput}
            className={workspacePage.search}
            aria-label="Search workflows"
            placeholder="Search workflows"
            leftSection={<Search size={14} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        actions={
          <>
            <Button onClick={() => setImporting(true)}>
              <Upload size={14} />
              Import
            </Button>
            <Button
              variant="primary"
              disabled={creating}
              aria-busy={creating}
              onClick={() => void create()}
            >
              <Plus size={14} />
              New workflow
            </Button>
          </>
        }
      />
      <PageTabList label="Workflow status" items={workflowTabs(scope)} />
      <Tabs.Panel
        value={archived ? 'archived' : 'active'}
        className={workspacePage.content}
      >
        {visible.length ? (
          <WorkflowGrid>
            {visible.map((w) => {
              const childCount = workflows.filter(
                (child) => child.ownerWorkflowId === w.id,
              ).length;
              return (
                <WorkflowCard
                  key={w.id}
                  name={w.name}
                  description={w.description}
                  to={paths.workflow(w.id)}
                  highlighted={importedIds.includes(w.id)}
                  status={
                    <StatusBadge
                      status={w.latestVersion ? 'published' : 'draft'}
                    />
                  }
                  metadata={[
                    `${w.draft.nodes.length} nodes`,
                    childCount
                      ? `${childCount} ${childCount === 1 ? 'child' : 'children'}`
                      : '',
                    w.latestVersion ? `v${w.latestVersion}` : 'Unpublished',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
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
                                  await api.workflows.export.query({
                                    id: w.id,
                                  }),
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
                  }
                />
              );
            })}
          </WorkflowGrid>
        ) : (
          <EmptyState
            title={
              query
                ? 'No matching workflows'
                : archived
                  ? 'No archived workflows'
                  : library.length
                    ? 'No active workflows'
                    : 'No workflows yet'
            }
          >
            {query ? (
              <Button
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </Button>
            ) : (
              !archived &&
              (!library.length ? (
                <Button onClick={() => setImporting(true)}>
                  <BookOpen size={16} />
                  Browse starter workflows
                </Button>
              ) : (
                <Button onClick={() => setArchived(true)}>
                  View archived workflows
                </Button>
              ))
            )}
          </EmptyState>
        )}
      </Tabs.Panel>
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
    </Tabs>
  );
}
