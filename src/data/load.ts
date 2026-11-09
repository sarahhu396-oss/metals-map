import type { Country, Flow, Meta, TariffEvent } from '../../shared/types';

export interface Dataset {
  flows: Flow[];
  countries: Map<string, Country>;
  meta: Meta;
  events: TariffEvent[];
  /** Every month present in flows, ascending */
  months: string[];
}

async function getJson<T>(base: string, file: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + file);
  } catch (err) {
    throw new Error(`Could not load ${file}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${file}: HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`Could not load ${file}: not valid JSON`);
  }
}

export async function loadDataset(base = 'data/'): Promise<Dataset> {
  const [flows, countries, meta, events] = await Promise.all([
    getJson<Flow[]>(base, 'flows.json'),
    getJson<Country[]>(base, 'countries.json'),
    getJson<Meta>(base, 'meta.json'),
    getJson<TariffEvent[]>(base, 'tariff-events.json'),
  ]);
  const months = [...new Set(flows.map((f) => f.month))].sort();
  return {
    flows,
    countries: new Map(countries.map((c) => [c.code, c])),
    meta,
    events,
    months,
  };
}
