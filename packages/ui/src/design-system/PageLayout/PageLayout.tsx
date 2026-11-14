import { ActionIcon, Tabs } from '@mantine/core';
import { Placeholder } from '../LoadingSkeleton/LoadingSkeleton';
import { useEffect, useRef, type ReactNode } from 'react';

import { ArrowLeft } from 'lucide-react';

import classes from './WorkspacePage.module.css';

export function PageHeader({
  title,
  subtitle,
  status,
  onBack,
  backLabel = 'Back',
  controls,
  actions,
  busy = false,
}: {
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  controls?: ReactNode;
  actions?: ReactNode;
  busy?: boolean;
}) {
  return (
    <header
      className={classes.header}
      data-two-line={Boolean(subtitle || status) || undefined}
    >
      <div className={classes.headerHeading}>
        {onBack && (
          <ActionIcon
            variant="subtle"
            aria-label={backLabel}
            onClick={onBack}
            disabled={busy}
          >
            <ArrowLeft size={18} />
          </ActionIcon>
        )}
        <div className={classes.title}>
          <h1 title={title}>{title}</h1>
          {subtitle && <div className={classes.subtitle}>{subtitle}</div>}
          {status && (
            <div className={classes.status} role="status">
              {status}
            </div>
          )}
        </div>
      </div>
      {(controls || actions) && (
        <div className={classes.headerTools}>
          {controls && <div className={classes.headerControls}>{controls}</div>}
          {actions && <div className={classes.actions}>{actions}</div>}
        </div>
      )}
    </header>
  );
}

export function PageTabStrip({
  children,
  toolbar,
  decorative = false,
}: {
  children: ReactNode;
  toolbar?: ReactNode;
  decorative?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const shown = useRef<Element | null>(null);
  // Keep the selected tab visible when the strip scrolls at narrow widths.
  useEffect(() => {
    const tab = strip.current?.querySelector<HTMLElement>(
      '[aria-selected="true"], [aria-current="page"]',
    );
    const list = tab?.parentElement;
    if (!tab || !list || tab === shown.current) return;
    shown.current = tab;
    const start =
      tab.offsetParent === list
        ? tab.offsetLeft
        : tab.offsetLeft - list.offsetLeft;
    if (start < list.scrollLeft) list.scrollLeft = start;
    else if (start + tab.offsetWidth > list.scrollLeft + list.clientWidth)
      list.scrollLeft = start + tab.offsetWidth - list.clientWidth;
  });
  return (
    <>
      {toolbar && <PageToolbar>{toolbar}</PageToolbar>}
      <div
        ref={strip}
        className={classes.tabs}
        aria-hidden={decorative || undefined}
      >
        {children}
      </div>
    </>
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
    <div className={classes.toolbar}>
      {summary && <div className={classes.toolbarSummary}>{summary}</div>}
      {children && <div className={classes.filters}>{children}</div>}
    </div>
  );
}

/** Uses the surrounding Mantine Tabs context for in-page sections. */
export function PageTabList({
  items,
  label,
  toolbar,
}: {
  items: { value: string; label: string; count?: number }[];
  label: string;
  toolbar?: ReactNode;
}) {
  return (
    <PageTabStrip toolbar={toolbar}>
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
    </PageTabStrip>
  );
}

export function PageTabsSkeleton({
  items,
  value,
  toolbar,
  showCounts = true,
}: {
  items: readonly { value: string; label: string }[];
  value: string;
  toolbar?: ReactNode;
  showCounts?: boolean;
}) {
  return (
    <PageTabStrip decorative toolbar={toolbar}>
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
    </PageTabStrip>
  );
}

export { classes as workspacePage };
