import { ArrowUpRight, ChevronRight } from 'lucide-react';
import type { NodeExecution, Run } from '@interlock/core';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import styles from './RunInspector.module.css';

type States = Record<string, string | undefined>;

/** The run a waited or detached Workflow step started. */
export function ChildRunLinks({
  execution,
  runIndex,
  states,
  onOpen,
}: {
  execution: NodeExecution;
  runIndex: Map<string, Run>;
  states: States;
  onOpen: (child: Run) => void;
}) {
  return execution.childRunIds.map((childId) => {
    const child = runIndex.get(childId);
    return child ? (
      <section key={child.id}>
        <h3>{child.parentMode === 'detached' ? 'Started run' : 'Child run'}</h3>
        <div className={styles.linkedRuns}>
          <button className={styles.child} onClick={() => onOpen(child)}>
            <span>
              {child.workflowName}
              <small>{child.id.slice(0, 8)}</small>
            </span>
            <StatusBadge status={states[child.id] ?? child.status} />
            <ArrowUpRight size={14} />
          </button>
        </div>
      </section>
    ) : null;
  });
}

/** Tool calls an Agent execution made, in call order, across its claim attempts. */
export function ToolCallLinks({
  execution,
  runIndex,
  states,
  onSelect,
}: {
  execution: NodeExecution;
  runIndex: Map<string, Run>;
  states: States;
  onSelect: (step: NodeExecution, owner: Run) => void;
}) {
  const calls = execution.childRunIds.flatMap((id) => {
    const call = runIndex.get(id);
    return call?.toolCall ? [{ call, link: call.toolCall }] : [];
  });
  if (!calls.length) return null;
  return (
    <section aria-label="Tool calls">
      <h3>Tool calls</h3>
      <div className={styles.linkedRuns}>
        {calls.map(({ call, link }) => {
          const step = call.executions.at(-1);
          const content = (
            <>
              <span className={styles.branchName}>
                {link.name}
                <small>
                  Attempt {link.attempt} ·{' '}
                  {new Date(call.createdAt).toLocaleTimeString()}
                </small>
              </span>
              <StatusBadge status={states[call.id] ?? call.status} />
            </>
          );
          return step ? (
            <button
              key={call.id}
              type="button"
              className={styles.child}
              onClick={() => onSelect(step, call)}
            >
              {content}
              <ChevronRight size={14} />
            </button>
          ) : (
            <div key={call.id} className={styles.toolPending}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}
