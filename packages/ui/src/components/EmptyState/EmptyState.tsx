import type { ReactNode } from 'react';
import classes from './EmptyState.module.css';
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={classes.empty}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children && <div className={classes.actions}>{children}</div>}
    </div>
  );
}
