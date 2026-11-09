import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, GitBranch } from 'lucide-react';
import {
  LoadingSkeleton,
  Placeholder,
} from '../LoadingSkeleton/LoadingSkeleton';
import classes from './WorkflowCards.module.css';

type CardProps = {
  name: string;
  description?: string;
  metadata: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  highlighted?: boolean;
} & (
  | { to: string; onOpen?: never; disabled?: never }
  | { onOpen: () => void; to?: never; disabled?: boolean }
);

export function WorkflowCard({
  name,
  description,
  metadata,
  status,
  actions,
  highlighted,
  to,
  onOpen,
  disabled,
}: CardProps) {
  return (
    <article
      className={classes.card}
      data-highlighted={highlighted || undefined}
      data-disabled={disabled || undefined}
    >
      <div className={classes.top}>
        <span className={classes.icon} aria-hidden="true">
          <GitBranch size={19} />
        </span>
        <div className={classes.actions}>{actions}</div>
      </div>
      <div className={classes.body}>
        <h2>
          {to !== undefined ? (
            <Link className={classes.link} to={to}>
              {name}
            </Link>
          ) : (
            <button
              type="button"
              className={classes.link}
              onClick={onOpen}
              disabled={disabled}
              aria-label={`Open ${name}`}
            >
              {name}
            </button>
          )}
        </h2>
        {description && <p>{description}</p>}
      </div>
      <div className={classes.footer}>
        <span>{metadata}</span>
        {status}
        <ChevronRight size={16} aria-hidden="true" />
      </div>
    </article>
  );
}

export function WorkflowGrid({ children }: { children: ReactNode }) {
  return <div className={classes.grid}>{children}</div>;
}

export function WorkflowCardsSkeleton() {
  return (
    <LoadingSkeleton label="Loading workflows…">
      <WorkflowGrid>
        {[1, 2, 3].map((row) => (
          <div className={classes.card} key={row}>
            <div className={classes.top}>
              <Placeholder h={35} w={35} />
            </div>
            <div className={classes.body}>
              <Placeholder h={14} w="65%" />
              <Placeholder h={10} w="85%" mt={12} />
            </div>
            <div className={classes.footer}>
              <Placeholder h={10} w={110} />
              <Placeholder h={18} w={60} />
            </div>
          </div>
        ))}
      </WorkflowGrid>
    </LoadingSkeleton>
  );
}
