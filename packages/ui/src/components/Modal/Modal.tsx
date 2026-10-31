import type { ReactNode } from 'react';
import { Modal as MantineModal } from '@mantine/core';

/** Dialogs stay mounted only while open; contract pages can handle Close as Back. */
export function Modal({
  title,
  onClose,
  children,
  className = '',
  classNames,
  size = 550,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  classNames?: { header?: string; body?: string };
  size?: number;
}) {
  return (
    <MantineModal
      opened
      title={title}
      onClose={onClose}
      size={size}
      classNames={{ ...classNames, content: className }}
      closeButtonProps={{ 'aria-label': 'Close dialog' }}
      closeOnClickOutside={false}
    >
      {children}
    </MantineModal>
  );
}
