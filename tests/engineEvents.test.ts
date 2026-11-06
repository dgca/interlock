import { expect, it, vi } from 'vitest';
import { subscribeToEngineEvents } from '../packages/ui/src/lib/engineEvents';

it('shares stream health across tabs and detects a silent or closed stream', () => {
  vi.useFakeTimers();
  const channels = new Set<TestChannel>();
  class TestChannel extends EventTarget {
    constructor() {
      super();
      channels.add(this);
    }
    postMessage(data: string) {
      for (const channel of channels)
        if (channel !== this)
          channel.dispatchEvent(new MessageEvent('message', { data }));
    }
    close() {
      channels.delete(this);
    }
  }
  const stream = Object.assign(new EventTarget(), { close: vi.fn() });
  vi.stubGlobal('BroadcastChannel', TestChannel);
  vi.stubGlobal(
    'EventSource',
    vi.fn(function () {
      return stream;
    }),
  );
  vi.stubGlobal('navigator', {
    locks: {
      request: vi
        .fn()
        .mockImplementationOnce((_name, _options, run) => run())
        .mockResolvedValue(undefined),
    },
  });
  const callbacks = () => ({
    onConnect: vi.fn(),
    onChange: vi.fn(),
    onError: vi.fn(),
  });
  const leader = callbacks();
  const follower = callbacks();
  const stopLeader = subscribeToEngineEvents(leader);
  const stopFollower = subscribeToEngineEvents(follower);
  try {
    stream.dispatchEvent(new Event('connected'));
    vi.advanceTimersByTime(20_000);
    stream.dispatchEvent(new Event('heartbeat'));
    vi.advanceTimersByTime(20_000);
    for (const tab of [leader, follower]) {
      expect(tab.onConnect).toHaveBeenCalledTimes(1);
      expect(tab.onError).not.toHaveBeenCalled();
      expect(tab.onChange).not.toHaveBeenCalled();
    }

    stream.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(35_000);
    for (const tab of [leader, follower]) {
      expect(tab.onChange).toHaveBeenCalledTimes(1);
      expect(tab.onError).toHaveBeenCalledTimes(1);
    }

    stream.dispatchEvent(new Event('connected'));
    expect(follower.onConnect).toHaveBeenCalledTimes(2);
    stopLeader();
    expect(stream.close).toHaveBeenCalledOnce();
    expect(follower.onError).toHaveBeenCalledTimes(2);
  } finally {
    if (!stream.close.mock.calls.length) stopLeader();
    stopFollower();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
