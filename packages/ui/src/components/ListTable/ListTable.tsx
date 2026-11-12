import { LoadingSkeleton } from '../../design-system';
import {
  Children,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import classes from './ListTable.module.css';

export type ListTableLayout = {
  columns: readonly {
    label: string;
    width?: string;
    compactWidth?: string;
    fitContent?: boolean;
  }[];
  minWidth: number;
};

export function ListTable({
  columns,
  minWidth,
  children,
  label,
  placeholder,
}: ListTableLayout & {
  children: ReactNode;
  label: string;
  placeholder?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const area = scroller.current;
    const content = table.current;
    if (placeholder || !area || !content) return;
    const measure = () => setOverflow(area.scrollWidth > area.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(content);
    return () => observer.disconnect();
  }, [placeholder]);
  return (
    <div
      ref={scroller}
      className={classes.scroller}
      inert={placeholder}
      tabIndex={overflow ? 0 : undefined}
      role={overflow ? 'region' : undefined}
      aria-label={overflow ? `Scroll ${label}` : undefined}
    >
      <table
        ref={table}
        className={classes.table}
        style={{ minWidth }}
        aria-label={label}
      >
        <colgroup>
          {columns.map(({ label, width, compactWidth, fitContent }) => (
            <col
              key={label}
              className={fitContent ? classes.fitContentColumn : undefined}
              style={
                {
                  '--column-width': width,
                  '--compact-column-width': compactWidth ?? width,
                } as CSSProperties
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map(({ label }) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function ListTableRow({
  children,
  className,
  colSpan,
  headerId,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  headerId?: string;
}) {
  return (
    <tr className={className}>
      {colSpan ? (
        <td className={classes.detail} colSpan={colSpan} headers={headerId}>
          {children}
        </td>
      ) : (
        Children.map(children, (cell, index) =>
          index === 0 ? (
            <th scope="row" id={headerId}>
              {cell}
            </th>
          ) : (
            <td>{cell}</td>
          ),
        )
      )}
    </tr>
  );
}

export function ListTableSkeleton({
  columns,
  minWidth,
  label,
  children,
  footer,
}: ListTableLayout & {
  label: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <LoadingSkeleton label={label}>
      <ListTable
        columns={columns}
        minWidth={minWidth}
        label={label}
        placeholder
      >
        {[1, 2, 3].map((row) => (
          <ListTableRow key={row}>{children}</ListTableRow>
        ))}
      </ListTable>
      {footer}
    </LoadingSkeleton>
  );
}
