import { beforeEach, expect, test, vi } from 'vitest';
import { loadDemand, loadDomestic, loadPlaces, resetDemandCache } from '../../src/demand/load';

function stub(failing?: string) {
  return vi.fn(async (url: string) => {
    if (failing && url.endsWith(failing)) return new Response('no', { status: 404 });
    return new Response(JSON.stringify({ file: url }), { status: 200 });
  });
}

beforeEach(() => {
  resetDemandCache();
  vi.unstubAllGlobals();
});

test('loadDemand rejects naming the failing file', async () => {
  vi.stubGlobal('fetch', stub('demand.json'));
  await expect(loadDemand('data/')).rejects.toThrow(/demand\.json/);
});

test('loadDemand is memoised: one fetch per file', async () => {
  const f = stub();
  vi.stubGlobal('fetch', f);
  await loadDemand('data/');
  await loadDemand('data/');
  expect(f).toHaveBeenCalledTimes(2);
  const urls = f.mock.calls.map((c) => c[0]).sort();
  expect(urls).toEqual(['data/demand.json', 'data/domestic.json']);
});

test('loadPlaces is separate and memoised', async () => {
  const f = stub();
  vi.stubGlobal('fetch', f);
  await loadPlaces('data/');
  await loadPlaces('data/');
  expect(f).toHaveBeenCalledTimes(1);
  expect(f.mock.calls[0][0]).toBe('data/places.json');
});

test('loadDomestic shares its fetch with loadDemand', async () => {
  const f = stub();
  vi.stubGlobal('fetch', f);
  await loadDomestic('data/');
  await loadDemand('data/');
  expect(f).toHaveBeenCalledTimes(2);
});

test('a failed load can be retried', async () => {
  vi.stubGlobal('fetch', stub('demand.json'));
  await expect(loadDemand('data/')).rejects.toThrow();
  const f = stub();
  vi.stubGlobal('fetch', f);
  await expect(loadDemand('data/')).resolves.toBeTruthy();
});
