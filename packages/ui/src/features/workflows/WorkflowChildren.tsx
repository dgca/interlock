import { useState } from 'react';
import { Badge, SegmentedControl, TextInput } from '@mantine/core';
import {
  ArrowUpRight,
  GitBranch,
  Plus,
  Search,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import type { Workflow } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import styles from './WorkflowChildren.module.css';

export function WorkflowChildren({
  workflow,
  workflows,
  onOpen,
  onCreate,
  disabled,
}: {
  workflow: Workflow;
  workflows: Workflow[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  disabled: boolean;
}) {
  const [name, setName] = useState('');
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owned = workflows.filter((w) => w.ownerWorkflowId === workflow.id);
  const children = owned
    .filter(
      (w) =>
        w.archived === archived &&
        `${w.name} ${w.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const canCreate = !disabled && !workflow.archived;
  const openCreate = () => {
    setName('');
    setError('');
    setCreating(true);
  };
  return (
    <section className={styles.page} aria-label="Child workflows">
      <header className={styles.header}>
        <h1>Child workflows</h1>
        <Button variant="primary" disabled={!canCreate} onClick={openCreate}>
          <Plus size={16} />
          New child
        </Button>
      </header>
      <div className={styles.toolbar}>
        <SegmentedControl
          aria-label="Child workflow status"
          value={archived ? 'archived' : 'active'}
          onChange={(value) => setArchived(value === 'archived')}
          data={[
            {
              value: 'active',
              label: `Active · ${owned.filter((w) => !w.archived).length}`,
            },
            {
              value: 'archived',
              label: `Archived · ${owned.filter((w) => w.archived).length}`,
            },
          ]}
        />
        <TextInput
          className={styles.search}
          aria-label="Search child workflows"
          placeholder="Find a child workflow…"
          leftSection={<Search size={15} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {children.length ? (
        <div className={styles.grid}>
          {children.map((child) => {
            const uses = workflow.draft.nodes.filter(
              (n) => n.kind === 'workflow' && n.workflowId === child.id,
            );
            const steps = child.draft.nodes.filter(
              (n) => n.kind !== 'entry' && n.kind !== 'exit',
            ).length;
            return (
              <button
                type="button"
                className={styles.card}
                key={child.id}
                disabled={disabled}
                onClick={() => onOpen(child.id)}
                aria-label={`Open ${child.name}`}
              >
                <div className={styles.cardTop}>
                  <span className={styles.icon}>
                    <WorkflowIcon size={21} strokeWidth={1.6} />
                  </span>
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
                  >
                    {child.archived
                      ? 'Archived'
                      : child.latestVersion
                        ? `v${child.latestVersion} published`
                        : 'Draft'}
                  </Badge>
                </div>
                <h2>{child.name}</h2>
                <p className={styles.description}>
                  {child.description ||
                    'A focused piece of work, with its own steps and versions.'}
                </p>
                <div className={styles.cardFooter}>
                  <span>
                    {steps} {steps === 1 ? 'step' : 'steps'}
                    <span className={styles.dot}>·</span>
                    {uses.length
                      ? `Used in ${uses.length} ${uses.length === 1 ? 'step' : 'steps'}`
                      : 'Not used in draft'}
                  </span>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </div>
              </button>
            );
          })}
          {!archived && !query && (
            <button
              type="button"
              className={styles.newCard}
              disabled={!canCreate}
              onClick={openCreate}
            >
              <span className={styles.newIcon}>
                <Plus size={21} />
              </span>
              <strong>Create a child workflow</strong>
              <span>Build a helper for {workflow.name}</span>
            </button>
          )}
        </div>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>
            <GitBranch size={28} strokeWidth={1.5} />
          </span>
          <h2>
            {query
              ? 'No matching child workflows'
              : archived
                ? 'No archived children'
                : 'Create your first child workflow'}
          </h2>
          <p>
            {query
              ? 'Try another name or clear your search.'
              : archived
                ? 'Archived children will appear here.'
                : 'Give a focused task its own steps and versions. It stays here with its parent, ready to use when you need it.'}
          </p>
          {query ? (
            <Button onClick={() => setQuery('')}>Clear search</Button>
          ) : (
            !archived && (
              <Button
                variant="primary"
                disabled={!canCreate}
                onClick={openCreate}
              >
                <Plus size={16} />
                Create your first child
              </Button>
            )
          )}
        </div>
      )}
      <p className={styles.caption}>
        <GitBranch size={13} />
        Children stay with this parent and out of the main workflow library.
      </p>
      {creating && (
        <Modal
          title="New child workflow"
          onClose={() => {
            if (!busy) setCreating(false);
          }}
        >
          <form
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
            <p className={styles.dialogIntro}>
              Create a helper that belongs to <strong>{workflow.name}</strong>.
            </p>
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
            <div className={styles.dialogActions}>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!name.trim() || !canCreate || busy}
              >
                {busy ? 'Creating…' : 'Save and create child'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
