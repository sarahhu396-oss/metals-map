import { expect, test, vi } from 'vitest';
import { createStore, defaultSelection } from '../src/state';

test('defaultSelection uses the spec defaults at the latest month', () => {
  expect(defaultSelection('2025-08')).toEqual({
    product: 'plate_sheet', direction: 'imports', measure: 'tonnes',
    month: '2025-08', window: 't12', country: null,
  });
});

test('set merges the patch and notifies once', () => {
  const store = createStore(defaultSelection('2025-08'));
  const fn = vi.fn();
  store.subscribe(fn);
  store.set({ measure: 'value', country: '1220' });
  expect(fn).toHaveBeenCalledTimes(1);
  expect(store.get()).toMatchObject({ measure: 'value', country: '1220', product: 'plate_sheet' });
  expect(fn.mock.calls[0][0]).toEqual(store.get());
});

test('a set that changes nothing does not notify', () => {
  const store = createStore(defaultSelection('2025-08'));
  const fn = vi.fn();
  store.subscribe(fn);
  store.set({ measure: 'tonnes' });
  expect(fn).not.toHaveBeenCalled();
});

test('unsubscribe stops notifications', () => {
  const store = createStore(defaultSelection('2025-08'));
  const fn = vi.fn();
  const off = store.subscribe(fn);
  off();
  store.set({ measure: 'value' });
  expect(fn).not.toHaveBeenCalled();
});
