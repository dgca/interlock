import { useEffect, useRef } from 'react';
import classes from './ActionError.module.css';

export function ActionError({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message && document.activeElement === document.body)
      ref.current?.focus();
  }, [message]);
  return message ? (
    <p
      ref={ref}
      tabIndex={-1}
      role="alert"
      className={[classes.error, className].filter(Boolean).join(' ')}
    >
      {message}
    </p>
  ) : null;
}
