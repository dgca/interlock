import { useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

export type Action = <T>(
  fn: () => Promise<T>,
  success?: string | ((result: T) => string),
) => Promise<void>;

export function useActionFeedback(refresh: () => Promise<void>) {
  const nextId = useRef(0);
  const [feedback, setFeedback] = useState<{
    id: number;
    kind: 'success' | 'error';
    message: string;
  }>();
  const notify = (kind: 'success' | 'error', message: string) =>
    setFeedback({ id: ++nextId.current, kind, message });
  useEffect(() => {
    if (feedback?.kind !== 'success') return;
    const timer = setTimeout(
      () =>
        setFeedback((current) =>
          current?.id === feedback.id ? undefined : current,
        ),
      6000,
    );
    return () => clearTimeout(timer);
  }, [feedback]);
  const act: Action = async (fn, success) => {
    let result;
    try {
      result = await fn();
    } catch (error) {
      notify('error', errorMessage(error));
      return;
    }
    if (success)
      notify(
        'success',
        typeof success === 'function' ? success(result) : success,
      );
    try {
      await refresh();
    } catch (error) {
      notify(
        'error',
        `Action completed, but the view could not refresh: ${errorMessage(error)}`,
      );
    }
  };
  return {
    act,
    feedback,
    dismiss: () => setFeedback(undefined),
    success: (message: string) => notify('success', message),
  };
}
