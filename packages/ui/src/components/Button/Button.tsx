import type { ButtonHTMLAttributes } from 'react';
import { Button as MantineButton } from '@mantine/core';

/** Workflow actions share semantic variants across the canvas and dialogs. */
export function Button({
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  return (
    <MantineButton
      variant={
        variant === 'primary'
          ? 'filled'
          : variant === 'ghost'
            ? 'subtle'
            : variant === 'danger'
              ? 'light'
              : 'default'
      }
      color={variant === 'danger' ? 'red' : undefined}
      {...props}
    />
  );
}
