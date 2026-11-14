import { Stack, Text } from '../../design-system';
import { pricingLines, type PricingSummary } from '@interlock/core';

/** States which list prices a derived cost assumed and which models have none. */
export function PricingNote({ pricing }: { pricing?: PricingSummary }) {
  const lines = pricingLines({ pricing });
  if (!lines.length) return null;
  return (
    <Stack gap={0} aria-label="Cost basis">
      {lines.map((line, index) => (
        <Text
          key={index}
          size="xs"
          c="dimmed"
          pl={line.startsWith('    ') ? 'sm' : 0}
        >
          {line.trim()}
        </Text>
      ))}
    </Stack>
  );
}
