import type { Selection } from '../shared/types';

export function defaultSelection(latestMonth: string): Selection {
  return {
    product: 'plate',
    direction: 'imports',
    measure: 'tonnes',
    month: latestMonth,
    window: 't12',
    country: null,
  };
}

export function createStore(initial: Selection) {
  let current = initial;
  const subscribers = new Set<(s: Selection) => void>();
  return {
    get(): Selection {
      return current;
    },
    /** Merge a patch; subscribers are told only if something changed. */
    set(patch: Partial<Selection>): void {
      const next = { ...current, ...patch };
      const changed = (Object.keys(next) as (keyof Selection)[])
        .some((k) => next[k] !== current[k]);
      if (!changed) return;
      current = next;
      for (const fn of subscribers) fn(current);
    },
    subscribe(fn: (s: Selection) => void): () => void {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
