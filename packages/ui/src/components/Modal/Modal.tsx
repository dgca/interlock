import type { ReactNode } from 'react';
import { Modal as MantineModal } from '@mantine/core';

/** Dialogs stay mounted only while open; contract pages can handle Close as Back. */
export function Modal({
  title,
  onClose,
  children,
  className = '',
  size = 550,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  size?: number;
}) {
  return (
    <MantineModal
      opened
      title={title}
      onClose={onClose}
      size={size}
      classNames={{ content: className }}
      closeButtonProps={{ 'aria-label': 'Close dialog' }}
      closeOnClickOutside={false}
    >
      {children}
    </MantineModal>
  );
}
