import { LoadingSkeleton } from '../../design-system';

import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';

import classes from './ListTable.module.css';

export type ListTableColumn = {
  label: string;
  width: string;
  compactWidth?: string;
};

export function ListTable({
  columns,
  children,
  className,
}: {
  columns: readonly ListTableColumn[];
  children: ReactNode;
  className?: string;
}) {
  const style = {
    '--list-columns': columns.map((column) => column.width).join(' '),
    '--list-columns-compact': columns
      .map((column) => column.compactWidth ?? column.width)
      .join(' '),
  } as CSSProperties;
  return (
    <div
      className={[classes.table, className].filter(Boolean).join(' ')}
      style={style}
    >
      <div className={classes.heading}>
        {columns.map((column, index) => (
          <span key={index}>{column.label}</span>
        ))}
      </div>
      {children}
    </div>
  );
}

type RowProps = { children: ReactNode; className?: string } & (
  | { to: string; onClick?: never; placeholder?: never }
  | { onClick: () => void; to?: never; placeholder?: never }
  | { placeholder?: true; to?: never; onClick?: never }
);

/** Links and buttons navigate; static rows can contain their own controls. */
export function ListTableRow({
  children,
  className,
  to,
  onClick,
  placeholder,
}: RowProps) {
  const rowClass = [classes.row, className].filter(Boolean).join(' ');
  if (placeholder || (to === undefined && onClick === undefined))
    return <div className={rowClass}>{children}</div>;
  if (to !== undefined)
    return (
      <Link className={rowClass} to={to}>
        {children}
      </Link>
    );
  return (
    <button type="button" className={rowClass} onClick={onClick}>
      {children}
    </button>
  );
}

export function ListTableSkeleton({
  columns,
  label,
  children,
  rowClassName,
  footer,
  className,
}: {
  columns: readonly ListTableColumn[];
  label: string;
  children: ReactNode;
  rowClassName?: string;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <LoadingSkeleton label={label}>
      <ListTable columns={columns} className={className}>
        {[1, 2, 3].map((row) => (
          <ListTableRow key={row} placeholder className={rowClassName}>
            {children}
          </ListTableRow>
        ))}
      </ListTable>
      {footer}
    </LoadingSkeleton>
  );
}
