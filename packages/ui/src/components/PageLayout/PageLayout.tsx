import type { ReactNode } from 'react';
import { Tabs } from '@mantine/core';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../Button/Button';
import classes from './WorkspacePage.module.css';

export function PageHeader({
  title,
  status,
  onBack,
  backLabel = 'Back',
  actions,
  busy = false,
}: {
  title: string;
  status?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <header className={classes.header}>
      {onBack && (
        <Button
          variant="ghost"
          aria-label={backLabel}
          onClick={onBack}
          disabled={busy}
        >
          <ArrowLeft />
        </Button>
      )}
      <div className={classes.title}>
        <h1 title={title}>{title}</h1>
        {status && (
          <div className={classes.status} role="status">
            {status}
          </div>
        )}
      </div>
      {actions && <div className={classes.actions}>{actions}</div>}
    </header>
  );
}

export function PageTabs({
  items,
  value,
  label,
  children,
}: {
  items: { value: string; label: string; to: string; count?: number }[];
  value: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className={classes.tabs}>
      <nav aria-label={label} className={classes.tabLinks}>
        {items.map((item) => (
          <Link
            key={item.value}
            to={item.to}
            className={classes.tab}
            aria-current={value === item.value ? 'page' : undefined}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={classes.count}>{item.count}</span>
            )}
          </Link>
        ))}
      </nav>
      {children && <div className={classes.filters}>{children}</div>}
    </div>
  );
}

/** Uses the surrounding Mantine Tabs context for in-page sections. */
export function PageTabList({
  items,
  label,
  children,
}: {
  items: { value: string; label: string; count?: number }[];
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className={classes.tabs}>
      <Tabs.List className={classes.tabLinks} aria-label={label}>
        {items.map((item) => (
          <Tabs.Tab
            unstyled
            key={item.value}
            value={item.value}
            className={classes.tab}
          >
            {item.label}
            {item.count !== undefined && (
              <>
                {' '}
                <span className={classes.count}>{item.count}</span>
              </>
            )}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {children && <div className={classes.filters}>{children}</div>}
    </div>
  );
}

export { classes as workspacePage };
