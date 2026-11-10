import type { Cell } from './group';

const BASE = 'https://api.census.gov/data';

function url(path: string, params: Record<string, string>, apiKey?: string): string {
  const q = new URLSearchParams(params);
  if (apiKey) q.set('key', apiKey);
  // Census wants literal commas and colons in `get=` and `for=`.
  return `${BASE}/${path}?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%2A/g, '*')}`;
}

function table(body: string): Record<string, string>[] {
  if (!body.trim()) return [];
  const [head, ...rows] = JSON.parse(body) as string[][];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

export function cbpUrl(year: number, naics: string, apiKey?: string): string {
  return url(`${year}/cbp`, {
    get: 'NAME,ESTAB,EMP,EMP_N_F', for: 'county:*', NAICS2017: naics, EMPSZES: '001',
  }, apiKey);
}

/** Establishments and employment per county (fips = state + county). D and N withhold employment. */
export function parseCbp(body: string): Map<string, Cell & { name: string }> {
  const out = new Map<string, Cell & { name: string }>();
  for (const r of table(body)) {
    const withheld = r.EMP_N_F === 'D' || r.EMP_N_F === 'N';
    out.set(r.state + r.county, { name: r.NAME, estab: Number(r.ESTAB), emp: withheld ? null : Number(r.EMP) });
  }
  return out;
}

/** The US-level row of the same series as cbpUrl. */
export function cbpUsUrl(year: number, naics: string, apiKey?: string): string {
  return url(`${year}/cbp`, {
    get: 'NAME,ESTAB,EMP,EMP_N_F', for: 'us:*', NAICS2017: naics, EMPSZES: '001',
  }, apiKey);
}

/** The national establishments and employment; null for an empty (204) response. */
export function parseCbpUs(body: string): Cell | null {
  const r = table(body)[0];
  if (!r) return null;
  return { estab: Number(r.ESTAB), emp: r.EMP_N_F === 'D' || r.EMP_N_F === 'N' ? null : Number(r.EMP) };
}

/** 2020 decennial (PL 94-171) population of every place. */
export function popUrl(apiKey?: string): string {
  return url('2020/dec/pl', { get: 'P1_001N', for: 'place:*', in: 'state:*' }, apiKey);
}

/** Population by state+place FIPS. */
export function parsePopulation(body: string): Map<string, number> {
  return new Map(table(body).map((r) => [r.state + r.place, Number(r.P1_001N)]));
}

export function geoinfoUrl(year: number, level: 'county' | 'place', apiKey?: string): string {
  return url(`${year}/geoinfo`, { get: 'NAME,INTPTLAT,INTPTLON', for: `${level}:*` }, apiKey);
}

export function parsePoints(body: string, level: 'county' | 'place'): { id: string; name: string; lat: number; lon: number }[] {
  return table(body).map((r) => ({
    id: r.state + r[level], name: r.NAME, lat: Number(r.INTPTLAT), lon: Number(r.INTPTLON),
  }));
}

export function asmUrl(year: number, apiKey?: string): string {
  return url('timeseries/asm/product', { get: 'PSCODE,PRODVAL', for: 'us:*', YEAR: String(year) }, apiKey);
}

/** Product shipments in dollars (the API reports thousands). */
export function parseAsm(body: string): Map<string, number> {
  return new Map(table(body).map((r) => [r.PSCODE, Number(r.PRODVAL) * 1000]));
}

/**
 * Probe for latestCbpYear: true when the year has CBP data. An error marked fatal (a bad key)
 * is rethrown; any other error counts as no data for that year. Every probed year is logged.
 */
export function cbpYearProbe(
  get: (url: string) => Promise<string>,
  apiKey: string,
  log: (msg: string) => void = () => {},
): (year: number) => Promise<boolean> {
  return async (year) => {
    try {
      const ok = (await get(cbpUrl(year, '3364', apiKey))).trim() !== '';
      log(`CBP ${year}: ${ok ? 'data' : 'no data'}`);
      return ok;
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      log(`CBP ${year}: error, treated as no data (${(err as Error).message.replace(/key=[^&\s]+/g, 'key=***')})`);
      return false;
    }
  };
}

/** Newest year, searching back from `from` (at most five years), for which the probe succeeds. */
export async function latestCbpYear(probe: (year: number) => Promise<boolean>, from: number): Promise<number> {
  for (let y = from; y >= from - 5; y--) if (await probe(y)) return y;
  throw new Error(`No CBP data found for ${from - 5}–${from}`);
}
