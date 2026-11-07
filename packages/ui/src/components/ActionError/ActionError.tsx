import { useEffect, useRef } from 'react';

export function ActionError({
  message,
  className = 'error-text',
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
    <p ref={ref} tabIndex={-1} role="alert" className={className}>
      {message}
    </p>
  ) : null;
}
