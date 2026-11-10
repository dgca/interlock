import {
  Button,
  LoadingSkeleton,
  Modal,
  ModalBody,
  Placeholder,
} from '../../design-system';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const readMore = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLAnchorElement | HTMLButtonElement>(null);
  const [truncated, setTruncated] = useState(false);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    const element = paragraph.current;
    if (!element) {
      setTruncated(false);
      setReading(false);
      return;
    }
    let current = true;
    const measure = () => {
      if (current)
        setTruncated(element.scrollHeight > element.clientHeight + 1);
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
  }, [description]);

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
          <p ref={paragraph} className={classes.description}>
            {description}
          </p>
        )}
        {description && truncated && (
          <Button
            ref={readMore}
            variant="ghost"
            className={classes.readMore}
            aria-haspopup="dialog"
            aria-label={`Read more about ${name}`}
            onClick={() => setReading(true)}
          >
            Read more
          </Button>
        )}
      </div>
      <div className={classes.footer}>
        <span>{metadata}</span>
        {status}
        <ChevronRight size={16} aria-hidden="true" />
      </div>
      {description && reading && (
        <Modal
          title={name}
          size={680}
          onClose={() => setReading(false)}
          returnFocusTo={() => readMore.current ?? navigation.current}
        >
          <ModalBody>
            <p className={classes.readingText}>{description}</p>
          </ModalBody>
        </Modal>
      )}
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
