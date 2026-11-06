const eventChannel = 'interlock-engine-events';
// The engine sends a heartbeat every 15 seconds. Allow one missed heartbeat.
const heartbeatTimeout = 35_000;

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

  let healthy = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const disconnect = () => {
    clearTimeout(watchdog);
    if (!healthy) return;
    healthy = false;
    onError();
  };
  const heardFromStream = () => {
    if (!healthy) {
      healthy = true;
      onConnect();
    }
    clearTimeout(watchdog);
    watchdog = setTimeout(disconnect, heartbeatTimeout);
  };
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel === 'function')
      channel = new BroadcastChannel(eventChannel);
  } catch {
    // Storage restrictions can prevent broadcasts. Polling still refreshes.
  }
  channel?.addEventListener('message', (event) => {
    if (event.data === 'disconnected') disconnect();
    if (event.data === 'heartbeat' || event.data === 'change')
      heardFromStream();
    if (event.data === 'change') onChange();
  });

  const controller = new AbortController();
  const { signal } = controller;
  let stream: EventSource | undefined;
  void navigator.locks
    .request(eventChannel, { signal }, async () => {
      if (signal.aborted) return;
      stream = new EventSource('/events');
      const heartbeat = () => {
        heardFromStream();
        channel?.postMessage('heartbeat');
      };
      stream.addEventListener('change', () => {
        heardFromStream();
        onChange();
        channel?.postMessage('change');
      });
      stream.addEventListener('connected', heartbeat);
      stream.addEventListener('heartbeat', heartbeat);
      stream.onerror = () => {
        disconnect();
        channel?.postMessage('disconnected');
      };
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
    })
    .catch(() => {
      // Closing a tab cancels its queued lock request. If access is denied,
      // the normal polling refresh still runs.
    });

  return () => {
    clearTimeout(watchdog);
    if (stream) {
      stream.close();
      channel?.postMessage('disconnected');
    }
    controller.abort();
    channel?.close();
  };
}
