import { useRef, useState } from 'react';
import {
  ArrowRight,
  Plus,
  Search,
  Upload,
  GitBranch,
  Copy,
  Archive,
  Download,
  MoreHorizontal,
  Layers,
} from 'lucide-react';
import type { Workflow } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import { api, download } from '../../lib/api';
import styles from './WorkflowLibrary.module.css';
export function WorkflowLibrary({
  workflows,
  onOpen,
  act,
}: {
  workflows: Workflow[];
  onOpen: (id: string) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const visible = workflows.filter(
    (w) =>
      w.archived === archived &&
      `${w.name} ${w.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={styles.page}>
      <div className={styles.breadcrumb}>
        Workspace <span>/</span> Workflows
      </div>
      <header className={styles.header}>
        <div>
          <div className="eyebrow">YOUR AUTOMATION WORKSPACE</div>
          <h1>Workflows</h1>
          <p>Repeatable procedures. Room for judgment.</p>
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
              })
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
            });
          e.target.value = '';
        }}
      />
      <div className={styles.banner}>
        <div className={styles.bannerIcon}>
          <Layers size={24} />
        </div>
        <div>
          <h3>A little structure goes a long way.</h3>
          <p>
            Connect steps, define their context, and let your agent take it from
            there.
          </p>
        </div>
        <span>
          HARNESS READY <i />
        </span>
      </div>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            className={!archived ? styles.selected : ''}
            onClick={() => setArchived(false)}
          >
            All workflows{' '}
            <span>{workflows.filter((w) => !w.archived).length}</span>
          </button>
          <button
            className={archived ? styles.selected : ''}
            onClick={() => setArchived(true)}
          >
            Archived
          </button>
        </div>
        <label className={styles.search}>
          <Search size={15} />
          <input
            aria-label="Search workflows"
            placeholder="Search workflows..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.grid}>
        {visible.map((w) => (
          <article key={w.id} className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.cardIcon}>
                <GitBranch size={19} />
              </span>
              <details className={styles.menu}>
                <summary aria-label={`Actions for ${w.name}`}>
                  <MoreHorizontal size={19} />
                </summary>
                <div>
                  <button
                    onClick={() =>
                      void act(async () => {
                        const copy = await api.workflows.clone.mutate({
                          id: w.id,
                        });
                        onOpen(copy.id);
                      })
                    }
                  >
                    <Copy size={13} />
                    Clone
                  </button>
                  <button
                    onClick={() =>
                      download(`${w.name}.json`, {
                        name: w.name,
                        description: w.description,
                        definition: w.draft,
                      })
                    }
                  >
                    <Download size={13} />
                    Export
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        api.workflows.update.mutate({
                          id: w.id,
                          archived: !w.archived,
                        }),
                      )
                    }
                  >
                    <Archive size={13} />
                    {w.archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </details>
            </div>
            <button className={styles.cardBody} onClick={() => onOpen(w.id)}>
              <h2>{w.name}</h2>
              <p>{w.description || 'A new procedure, ready to take shape.'}</p>
              <div className={styles.miniGraph}>
                {w.draft.nodes.map((n, i) => (
                  <span key={n.id} title={n.label}>
                    <i
                      className={
                        n.kind === 'agent' || n.kind === 'map'
                          ? styles.agent
                          : ''
                      }
                    />
                    {i < w.draft.nodes.length - 1 && <b />}
                  </span>
                ))}
              </div>
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
            })
          }
        >
          <span>
            <Plus size={23} />
          </span>
          Create a workflow<small>Start with an input and an idea</small>
        </button>
      </div>
      <div className={styles.caption}>
        Workflows run on your local engine. Connect a harness to pick up agent
        assignments.
      </div>
    </div>
  );
}
