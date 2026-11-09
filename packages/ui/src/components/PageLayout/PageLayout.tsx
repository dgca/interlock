import type { ReactNode } from 'react';
import { Tabs } from '@mantine/core';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../Button/Button';
import { Placeholder } from '../LoadingSkeleton/LoadingSkeleton';
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

function TabBar({
  tabs,
  children,
  decorative = false,
}: {
  tabs: ReactNode;
  children?: ReactNode;
  decorative?: boolean;
}) {
  return (
    <div className={classes.tabs} aria-hidden={decorative || undefined}>
      {tabs}
      {children && <div className={classes.filters}>{children}</div>}
    </div>
  );
}

export function PageToolbar({
  summary,
  children,
}: {
  summary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <TabBar tabs={<div className={classes.toolbarSummary}>{summary}</div>}>
      {children}
    </TabBar>
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
    <TabBar
      tabs={
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
      }
    >
      {children}
    </TabBar>
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
    <TabBar
      tabs={
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
      }
    >
      {children}
    </TabBar>
  );
}

export function PageTabsSkeleton({
  items,
  value,
  children,
  showCounts = true,
}: {
  items: readonly { value: string; label: string }[];
  value: string;
  children?: ReactNode;
  showCounts?: boolean;
}) {
  return (
    <TabBar
      decorative
      tabs={
        <div className={classes.tabLinks}>
          {items.map((item) => (
            <span
              key={item.value}
              className={classes.tab}
              aria-current={value === item.value ? 'page' : undefined}
            >
              {item.label}
              {showCounts && <Placeholder h={10} w={10} />}
            </span>
          ))}
        </div>
      }
    >
      {children}
    </TabBar>
  );
}

export { classes as workspacePage };
