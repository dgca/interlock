import { useEffect, useState } from 'react';
import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from '../packages/ui/src/design-system';
import {
  createQueryClient,
  QueryProvider,
  notifyManager,
} from '../packages/ui/src/lib/query';

notifyManager.setScheduler(queueMicrotask);

/** Each mounted test application owns its cache and clears it on unmount. */
export function UiTestProvider(props: DesignSystemProviderProps) {
  const [client] = useState(createQueryClient);
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryProvider client={client}>
      <DesignSystemProvider {...props} />
    </QueryProvider>
  );
}
