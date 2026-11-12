import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { Modal as MantineModal } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';
import styles from './Modal.module.css';

/** Dialogs stay mounted only while open. Nested pages can label dismissal as Back. */
export function Modal({
  title,
  onClose,
  children,
  height,
  backLabel,
  busy = false,
  covered = false,
  size = 550,
  returnFocusTo,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  height?: number;
  backLabel?: string;
  busy?: boolean;
  covered?: boolean;
  size?: ComponentProps<typeof MantineModal>['size'];
  returnFocusTo?: () => HTMLElement | null;
}) {
  const dismissButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (backLabel) dismissButton.current?.focus();
  }, [backLabel]);
  const [trigger] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  const [resolveFocus] = useState(() => () => returnFocusTo?.() ?? trigger);
  useEffect(() => {
    const path = window.location.pathname;
    return () => {
      // The dialog unmounts immediately. Restore after its focus trap is gone.
      requestAnimationFrame(() => {
        const focusTarget = resolveFocus();
        if (
          window.location.pathname === path &&
          document.activeElement === document.body &&
          focusTarget instanceof HTMLElement &&
          focusTarget.isConnected
        )
          focusTarget.focus();
      });
    };
  }, [resolveFocus]);
  return (
    <MantineModal
      opened
      title={title}
      onClose={onClose}
      size={size}
      xOffset={16}
      yOffset={16}
      classNames={{
        content: styles.content,
        header: backLabel
          ? `${styles.header} ${styles.nestedHeader}`
          : styles.header,
        title: styles.title,
        close: styles.close,
        body: styles.body,
      }}
      styles={height ? { content: { height } } : undefined}
      closeButtonProps={{
        ref: dismissButton,
        'aria-label': backLabel ?? 'Close dialog',
        title: backLabel,
        disabled: busy || covered,
        icon: backLabel ? (
          <ArrowLeft size={18} aria-hidden="true" />
        ) : undefined,
      }}
      inert={covered}
      trapFocus={!covered}
      closeOnEscape={!busy && !covered}
      closeOnClickOutside={false}
    >
      {children}
    </MantineModal>
  );
}
