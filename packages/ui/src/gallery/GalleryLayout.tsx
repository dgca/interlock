import type { ReactNode } from 'react';
import classes from './Gallery.module.css';

export function Specimen({
  name,
  wide = false,
  children,
}: {
  name: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={classes.specimen} data-wide={wide || undefined}>
      <span className={classes.caption}>{name}</span>
      <div className={classes.sample}>{children}</div>
    </div>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className={classes.section}
      aria-labelledby={`gallery-${id}`}
      data-gallery-section={id}
    >
      <h2 id={`gallery-${id}`}>{title}</h2>
      <div className={classes.grid}>{children}</div>
    </section>
  );
}
