import { Anchor, LoadingSkeleton, Placeholder } from '../../design-system';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight, GitBranch } from 'lucide-react';

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
  const paragraph = useRef<HTMLParagraphElement>(null);
  const disclosure = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();
  const [truncated, setTruncated] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const element = paragraph.current;
    if (!element) {
      setTruncated(false);
      setExpanded(false);
      return;
    }
    if (expanded) return;
    let current = true;
    const measure = () => {
      if (!current || element.dataset.expanded === 'true') return;
      const overflows = element.scrollHeight > element.clientHeight + 1;
      if (!overflows && document.activeElement === disclosure.current) {
        const target = navigation.current;
        if (target instanceof HTMLButtonElement && target.disabled)
          heading.current?.focus();
        else target?.focus();
      }
      setTruncated(overflows);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const fonts = document.fonts;
    void fonts?.ready.then(measure);
    fonts?.addEventListener('loadingdone', measure);
    return () => {
      current = false;
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', measure);
    };
  }, [description, expanded]);

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
        <h2 ref={heading} tabIndex={-1}>
          {to !== undefined ? (
            <Link
              className={classes.link}
              to={to}
              ref={(element) => {
                navigation.current = element;
              }}
            >
              {name}
            </Link>
          ) : (
            <button
              type="button"
              className={classes.link}
              onClick={onOpen}
              disabled={disabled}
              ref={(element) => {
                navigation.current = element;
              }}
              aria-label={`Open ${name}`}
            >
              {name}
            </button>
          )}
        </h2>
        {description && (
          <p
            id={descriptionId}
            ref={paragraph}
            className={classes.description}
            data-expanded={expanded || undefined}
          >
            {description}
          </p>
        )}
        {description && (expanded || truncated) && (
          <Anchor
            component="button"
            type="button"
            size="sm"
            ref={disclosure}
            className={classes.disclosure}
            aria-expanded={expanded}
            aria-controls={descriptionId}
            aria-label={`${expanded ? 'Show Less' : 'Show More'} about ${name}`}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show Less' : 'Show More'}
          </Anchor>
        )}
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
