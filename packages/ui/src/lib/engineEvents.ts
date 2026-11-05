const eventChannel = 'interlock-engine-events';

export function subscribeToEngineEvents({
  onChange,
  onConnect,
  onError,
}: {
  onChange: () => void;
  onConnect: () => void;
  onError: () => void;
}) {
  // Browsers share HTTP connections across tabs. One stream leaves room for API
  // requests, while tabs without coordination can still refresh by polling.
  if (!navigator.locks) return () => {};

  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel === 'function')
      channel = new BroadcastChannel(eventChannel);
  } catch {
    // Storage restrictions can prevent broadcasts. Polling still refreshes.
  }
  channel?.addEventListener('message', (event) => {
    if (event.data === 'change') onChange();
  });

  const controller = new AbortController();
  const { signal } = controller;
  let stream: EventSource | undefined;
  void navigator.locks
    .request(eventChannel, { signal }, async () => {
      if (signal.aborted) return;
      stream = new EventSource('/events');
      stream.addEventListener('change', () => {
        onChange();
        channel?.postMessage('change');
      });
      stream.addEventListener('connected', onConnect);
      stream.onerror = onError;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    })
    .catch(() => {
      // Closing a tab cancels its queued lock request. If access is denied,
      // the normal polling refresh still runs.
    });

  return () => {
    stream?.close();
    controller.abort();
    channel?.close();
  };
}
