import { useEffect, useState } from 'react';
import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from '../packages/ui/src/design-system';
import {
  createQueryClient,
  type QueryClient,
  QueryProvider,
  notifyManager,
} from '../packages/ui/src/lib/query';

notifyManager.setScheduler(queueMicrotask);

/** Each mounted test application owns its cache and clears it on unmount. */
export function UiTestProvider({
  client: suppliedClient,
  ...props
}: DesignSystemProviderProps & { client?: QueryClient }) {
  const [client] = useState(() => suppliedClient ?? createQueryClient());
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryProvider client={client}>
      <DesignSystemProvider {...props} />
    </QueryProvider>
  );
}
