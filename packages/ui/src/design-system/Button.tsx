import { forwardRef } from 'react';
import {
  Button as MantineButton,
  createPolymorphicComponent,
  type ButtonProps as MantineButtonProps,
  type ElementProps,
} from '@mantine/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends Omit<MantineButtonProps, 'variant'> {
  variant?: ButtonVariant;
}

const variants = {
  primary: 'filled',
  secondary: 'default',
  ghost: 'subtle',
  danger: 'light',
} as const;

/** Visual intent stays consistent for native buttons and polymorphic links. */
export const Button = createPolymorphicComponent<'button', ButtonProps>(
  forwardRef<
    HTMLButtonElement,
    ButtonProps & ElementProps<'button', keyof ButtonProps>
  >(function Button({ variant = 'secondary', color, ...props }, ref) {
    return (
      <MantineButton
        {...props}
        ref={ref}
        variant={variants[variant]}
        color={color ?? (variant === 'danger' ? 'red' : undefined)}
      />
    );
  }),
);
