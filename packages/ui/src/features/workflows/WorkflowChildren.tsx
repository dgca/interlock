import {
  ActionIcon,
  Badge,
  Menu,
  Tabs,
  TextInput,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  EmptyState,
  PageTabList,
  workspacePage,
} from '../../design-system';

import { useId, useRef, useState } from 'react';

import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import type { Workflow } from '@interlock/core';

import type { Action } from '../../lib/useActionFeedback';
import { DeleteWorkflowDialog } from './DeleteWorkflowDialog';
import styles from './WorkflowChildren.module.css';

import {
  WorkflowCard,
  WorkflowGrid,
} from '../../components/WorkflowCards/WorkflowCards';

import { workflowTabs } from './workflowListConfig';

export function WorkflowChildren({
  workflow,
  workflows,
  onOpen,
  onCreate,
  act,
  disabled,
}: {
  workflow: Workflow;
  workflows: Workflow[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  act: Action;
  disabled: boolean;
}) {
  const createFormId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Workflow>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owned = workflows.filter((w) => w.ownerWorkflowId === workflow.id);
  const scope = owned.filter((w) =>
    `${w.name} ${w.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  const children = scope
    .filter((w) => w.archived === archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const canCreate = !disabled && !workflow.archived;
  const openCreate = () => {
    setName('');
    setError('');
    setCreating(true);
  };
  return (
    <Tabs
      unstyled
      className={workspacePage.page}
      aria-label="Child workflows"
      value={archived ? 'archived' : 'active'}
      onChange={(value) => setArchived(value === 'archived')}
    >
      <PageTabList
        label="Child workflow status"
        items={workflowTabs(scope)}
        toolbar={
          <>
            <TextInput
              ref={searchInput}
              className={workspacePage.search}
              aria-label="Search child workflows"
              placeholder="Search child workflows"
              leftSection={<Search size={14} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button
              variant="primary"
              disabled={!canCreate}
              onClick={openCreate}
            >
              <Plus size={14} />
              New child
            </Button>
          </>
        }
      />
      <Tabs.Panel
        value={archived ? 'archived' : 'active'}
        className={workspacePage.content}
      >
        {children.length ? (
          <WorkflowGrid>
            {children.map((child) => {
              const uses = workflow.draft.nodes.filter(
                (node) =>
                  node.kind === 'workflow' && node.workflowId === child.id,
              ).length;
              const steps = child.draft.nodes.filter(
                (node) => node.kind !== 'entry' && node.kind !== 'exit',
              ).length;
              return (
                <WorkflowCard
                  key={child.id}
                  name={child.name}
                  description={child.description}
                  disabled={disabled}
                  onOpen={() => onOpen(child.id)}
                  status={
                    <Badge
                      variant="light"
                      color={
                        child.archived
                          ? 'gray'
                          : child.latestVersion
                            ? 'teal'
                            : 'gray'
                      }
                      size="sm"
                      tt="none"
                    >
                      {child.archived
                        ? 'Archived'
                        : child.latestVersion
                          ? `v${child.latestVersion} published`
                          : 'Draft'}
                    </Badge>
                  }
                  metadata={`${steps} ${steps === 1 ? 'step' : 'steps'} · ${uses ? `Used in ${uses} ${uses === 1 ? 'step' : 'steps'}` : 'Not used in draft'}`}
                  actions={
                    <Menu position="bottom-end" width={160}>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Actions for ${child.name}`}
                          disabled={disabled}
                        >
                          <MoreHorizontal size={19} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          color="red"
                          leftSection={<Trash2 size={14} />}
                          onClick={() => setDeleting(child)}
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
                ? 'No matching child workflows'
                : archived
                  ? 'No archived children'
                  : 'No child workflows yet'
            }
            description={
              !query && !archived
                ? 'Children stay with this parent and out of the main workflow library.'
                : undefined
            }
          >
            {query && (
              <Button
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </Button>
            )}
          </EmptyState>
        )}
        {children.length > 0 && (
          <p className={styles.caption}>
            Children stay with this parent and out of the main workflow library.
          </p>
        )}
      </Tabs.Panel>
      {creating && (
        <Modal
          title="New child workflow"
          busy={busy}
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <ModalBody>
            <form
              id={createFormId}
              onSubmit={async (event) => {
                event.preventDefault();
                if (!name.trim() || busy || !canCreate) return;
                setBusy(true);
                setError('');
                try {
                  await onCreate(name.trim());
                  setCreating(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <TextInput
                label="Child workflow name"
                placeholder="e.g. Gather evidence"
                required
                maxLength={120}
                value={name}
                disabled={busy || disabled}
                onChange={(e) => setName(e.target.value)}
                data-autofocus
              />
              <p className={styles.dialogHint}>
                This saves the parent draft, then opens the child editor. Add a
                Workflow node in the parent when you're ready to use it.
              </p>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
            </form>
          </ModalBody>
          <ModalFooter>
            <Button
              type="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={createFormId}
              variant="primary"
              disabled={!name.trim() || !canCreate || busy}
            >
              {busy ? 'Creating…' : 'Save and create child'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {deleting && (
        <DeleteWorkflowDialog
          workflow={deleting}
          act={act}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDeleting(undefined)}
        />
      )}
    </Tabs>
  );
}
