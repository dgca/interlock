import type { Run } from '@interlock/core';
import { ArrowUpRight, Activity } from 'lucide-react';
import { Badge } from '../../components/Badge/Badge';
export function RunHistory({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (id: string) => void;
}) {
  const roots = runs.filter((r) => !r.parentRunId);
  return (
    <div className="content-page">
      <div className="eyebrow">EXECUTION LOG</div>
      <h1>Run history</h1>
      <p className="muted">
        Every assignment, result, and decision in one place.
      </p>
      {roots.length ? (
        <div className="run-table">
          <div className="run-row table-heading">
            <span>Workflow</span>
            <span>Status</span>
            <span>Started</span>
            <span>Steps</span>
            <span />
          </div>
          {roots.map((r) => (
            <button className="run-row" key={r.id} onClick={() => onOpen(r.id)}>
              <span>
                <strong>{r.workflowName}</strong>
                <small>
                  v{r.version} · {r.id.slice(0, 8)}
                </small>
              </span>
              <Badge status={r.status} />
              <span>{new Date(r.createdAt).toLocaleString()}</span>
              <span>{r.executions.length}</span>
              <ArrowUpRight size={15} />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <Activity size={28} />
          <h2>Your first run starts here.</h2>
          <p>Open a published workflow and choose Run.</p>
        </div>
      )}
    </div>
  );
}
