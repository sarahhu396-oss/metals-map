import type { DemandData, DomesticData, Place } from '../../shared/demand';
import { getJson } from '../data/load';

export interface DemandBundle {
  demand: DemandData;
  domestic: DomesticData;
}

// One memoised promise per file; a failure is dropped so a retry refetches.
const cache = new Map<string, Promise<unknown>>();

function once<T>(base: string, file: string): Promise<T> {
  const key = base + file;
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = getJson<T>(base, file);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function resetDemandCache(): void {
  cache.clear();
}

export function loadDomestic(base = 'data/'): Promise<DomesticData> {
  return once<DomesticData>(base, 'domestic.json');
}

export async function loadDemand(base = 'data/'): Promise<DemandBundle> {
  const [demand, domestic] = await Promise.all([once<DemandData>(base, 'demand.json'), loadDomestic(base)]);
  return { demand, domestic };
}

export function loadPlaces(base = 'data/'): Promise<Place[]> {
  return once<Place[]>(base, 'places.json');
}
