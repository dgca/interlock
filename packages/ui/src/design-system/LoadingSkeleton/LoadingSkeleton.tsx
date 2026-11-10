import { Skeleton, Stack, VisuallyHidden } from '@mantine/core';
import type { ComponentProps, ReactNode } from 'react';

export function Placeholder(props: ComponentProps<typeof Skeleton>) {
  return <Skeleton animate={false} {...props} />;
}

export function LoadingSkeleton({
  label,
  children,
  className,
}: {
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <VisuallyHidden role="status">{label}</VisuallyHidden>
      <div className={className} aria-hidden="true">
        {children ?? (
          <Stack gap="xs">
            <Placeholder h={12} w="65%" />
            <Placeholder h={12} w="85%" />
            <Placeholder h={12} w="50%" />
          </Stack>
        )}
      </div>
    </>
  );
}

export function FormPlaceholder() {
  return (
    <Stack gap="lg">
      {[40, 66, 150].map((height) => (
        <Stack key={height} gap={6}>
          <Placeholder h={12} w={92} />
          <Placeholder h={height} />
        </Stack>
      ))}
    </Stack>
  );
}
