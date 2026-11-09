import { PageTabStrip, workspacePage as classes } from '../../design-system';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

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
    <PageTabStrip toolbar={children}>
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
    </PageTabStrip>
  );
}
