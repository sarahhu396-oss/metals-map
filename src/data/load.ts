import { PRODUCT_GROUPS, type Country, type Flow, type Meta, type TariffEvent } from '../../shared/types';

export interface Dataset {
  flows: Flow[];
  countries: Map<string, Country>;
  meta: Meta;
  events: TariffEvent[];
  /** Every month present in flows, ascending */
  months: string[];
}

export async function getJson<T>(base: string, file: string): Promise<T> {
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
  // Flows are split into one file per product group to keep each file small.
  const [flowParts, countries, meta, events] = await Promise.all([
    Promise.all(PRODUCT_GROUPS.map((g) => getJson<Flow[]>(base, `flows-${g}.json`))),
    getJson<Country[]>(base, 'countries.json'),
    getJson<Meta>(base, 'meta.json'),
    getJson<TariffEvent[]>(base, 'tariff-events.json'),
  ]);
  const flows = flowParts.flat();
  const months = [...new Set(flows.map((f) => f.month))].sort();
  return {
    flows,
    countries: new Map(countries.map((c) => [c.code, c])),
    meta,
    events,
    months,
  };
}
