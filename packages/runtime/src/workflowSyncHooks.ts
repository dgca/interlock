import type { Store } from '@interlock/storage';

/** Observes publication for the optional repository folder sync. */
export interface PublishObserver {
  /** Called before publication; the returned callback runs after it. */
  publishing(): () => void;
}

const observers = new WeakMap<Store, PublishObserver>();

export function observePublishes(store: Store, observer?: PublishObserver) {
  if (observer) observers.set(store, observer);
  else observers.delete(store);
}

export const publishObserver = (store: Store) => observers.get(store);
