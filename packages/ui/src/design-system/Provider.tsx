import { MantineProvider, type MantineProviderProps } from '@mantine/core';
import './fonts.css';
import './tokens.css';
import { theme } from './theme';

export type DesignSystemProviderProps = Omit<
  MantineProviderProps,
  'theme' | 'forceColorScheme'
>;

export function DesignSystemProvider(props: DesignSystemProviderProps) {
  return <MantineProvider {...props} theme={theme} forceColorScheme="dark" />;
}
