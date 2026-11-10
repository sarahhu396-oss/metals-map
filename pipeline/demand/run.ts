/**
 * Yearly demand refresh: CBP counties by industry group, Census place points, and ASM domestic
 * shipments with trade totals → validate → atomically replace the three demand files in public/data.
 *
 *   npm run pipeline:demand           # needs CENSUS_API_KEY
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_GROUPS, type Direction, type ProductGroup } from '../../shared/types';
import {
  INDUSTRY_GROUPS, type CountyDemand, type DemandData, type DomesticData, type DomesticProduct, type GroupDef, type Place,
} from '../../shared/demand';
import { buildUrl, parseResponse } from '../census';
import { fetchText } from '../fetch';
import type { GroupMap } from '../transform';
import { asmUrl, cbpUrl, geoinfoUrl, latestCbpYear, parseAsm, parseCbp, parsePoints } from './census';
import { groupCounty, type Cell } from './group';
import { cleanPlace } from './places';
import { validateDemand } from './validate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/data');
const CONCURRENCY = 4;
const YEARS = [2012, 2013, 2014, 2015, 2016];
const HEADINGS = ['7601', '7604', '7606', '7607', '7608'];
/** Group for HS10 codes missing from product-groups.json (pre-2015 codes), by heading. 7606 has no fallback. */
const HEADING_FALLBACK: Record<string, ProductGroup> = {
  '7601': 'unwrought', '7604': 'bar_rod_profiles', '7607': 'foil', '7608': 'tube',
};

const DOMESTIC_CODES: Record<ProductGroup, { codes: string[]; note: string | null }> = {
  plate: { codes: ['3313151'], note: 'Domestic plate is 0.25 in. (6.35 mm) and over; imports split at 6.3 mm' },
  sheet: { codes: ['3313153'], note: null },
  foil: { codes: ['3313155'], note: 'Excludes backed foil, which is in the import figures' },
  bar_rod_profiles: { codes: ['3313181', '3313187'], note: null },
  tube: { codes: ['3313183', '3313157'], note: null },
  unwrought: { codes: ['3313133', '3313142'], note: null },
};

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

async function pool<T>(tasks: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

type YearTotals = Record<Direction, Record<string, Record<ProductGroup, number | null> | null>>;

/** Dollar totals per product group and year, from the all-countries rows. */
async function tradeTotals(groups: GroupMap, apiKey: string): Promise<YearTotals> {
  const dirs: Direction[] = ['imports', 'exports'];
  const jobs = YEARS.flatMap((y) => dirs.flatMap((dir) => HEADINGS.map((h) => async () => {
    const body = await fetchText(buildUrl(dir, h, `${y}-01`, `${y}-12`, apiKey, '-'));
    return { y, dir, h, rows: parseResponse(dir, body).filter((r) => r.ctyCode === '-') };
  })));
  const results = await pool(jobs, CONCURRENCY);
  const out: YearTotals = { imports: {}, exports: {} };
  for (const dir of dirs) {
    for (const y of YEARS) {
      const mine = results.filter((r) => r.y === y && r.dir === dir);
      if (mine.every((r) => r.rows.length === 0)) { out[dir][String(y)] = null; continue; }
      const sums = Object.fromEntries(PRODUCT_GROUPS.map((g) => [g, 0])) as Record<ProductGroup, number | null>;
      for (const { h, rows } of mine) {
        for (const r of rows) {
          const g = groups[r.commodity] ?? HEADING_FALLBACK[h];
          if (g) sums[g] = (sums[g] ?? 0) + r.value;
          else if (r.value !== 0) { sums.plate = null; sums.sheet = null; }
        }
      }
      out[dir][String(y)] = sums;
    }
  }
  return out;
}

async function domesticData(groups: GroupMap, apiKey: string): Promise<DomesticData> {
  const asm = await pool(YEARS.map((y) => async () => parseAsm(await fetchText(asmUrl(y, apiKey)))), CONCURRENCY);
  const trade = await tradeTotals(groups, apiKey);
  const products: DomesticData['products'] = {};
  for (const g of PRODUCT_GROUPS) {
    const { codes, note } = DOMESTIC_CODES[g];
    const p: DomesticProduct = { codes, domestic: {}, imports: {}, exports: {}, note };
    YEARS.forEach((y, i) => {
      const vals = codes.map((c) => asm[i].get(c));
      p.domestic[String(y)] = vals.some((v) => v === undefined || !Number.isFinite(v)) ? null : (vals as number[]).reduce((a, b) => a + b, 0);
      p.imports[String(y)] = trade.imports[String(y)]?.[g] ?? null;
      p.exports[String(y)] = trade.exports[String(y)]?.[g] ?? null;
    });
    products[g] = p;
  }
  return { years: YEARS, products };
}

async function main(): Promise<number> {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) throw new Error('CENSUS_API_KEY is not set (the Census API rejects keyless requests)');
  const defs = readJson<GroupDef[]>(join(ROOT, 'pipeline/industries.json'));
  const groups = readJson<GroupMap>(join(ROOT, 'pipeline/product-groups.json'));
  const problems: string[] = [];

  const year = await latestCbpYear(async (y) => {
    try { return (await fetchText(cbpUrl(y, '3364', apiKey))).trim() !== ''; } catch { return false; }
  }, new Date().getUTCFullYear() - 1);
  console.log(`CBP year ${year}`);

  const naics = [...new Set(defs.flatMap((d) => [...d.add, ...d.subtract]))].sort();
  const bodies = await pool(naics.map((code) => async () => ({ code, body: await fetchText(cbpUrl(year, code, apiKey)) })), CONCURRENCY);
  const cbp = new Map<string, Map<string, Cell & { name: string }>>();
  for (const { code, body } of bodies) {
    const m = parseCbp(body);
    if (m.size === 0) {
      // Some codes are suppressed at county level (332993); accept them only if the code exists nationally.
      const us = await fetchText(cbpUrl(year, code, apiKey).replace('for=county:*', 'for=us:*'));
      if (us.trim() === '') problems.push(`NAICS ${code} returned no data`);
      else console.warn(`note: NAICS ${code} has no county-level data; counted as zero in every county`);
    }
    cbp.set(code, m);
  }

  const points = new Map(parsePoints(await fetchText(geoinfoUrl(year, 'county', apiKey)), 'county').map((p) => [p.id, p]));
  const placeRows = parsePoints(await fetchText(geoinfoUrl(year, 'place', apiKey)), 'place');
  const places: Place[] = placeRows
    .map((p) => { const c = cleanPlace(p.name); return [c.name, c.state, p.lat, p.lon] as Place; })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));

  const missingPoints = [...new Set([...cbp.values()].flatMap((m) => [...m.keys()]))].filter((f) => !points.has(f)).sort();
  const counties: CountyDemand[] = [...points.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((pt) => {
    const cells = new Map<string, Cell>();
    for (const [code, m] of cbp) { const c = m.get(pt.id); if (c) cells.set(code, c); }
    const estab = {} as CountyDemand['estab'];
    const emp = {} as CountyDemand['emp'];
    for (const def of defs) {
      const c = groupCounty(cells, def);
      estab[def.id] = c.estab;
      emp[def.id] = c.emp;
    }
    return { fips: pt.id, name: pt.name, lat: pt.lat, lon: pt.lon, estab, emp };
  });
  const demand: DemandData = { year, groups: INDUSTRY_GROUPS.map((id) => defs.find((d) => d.id === id)!), counties };

  const domestic = await domesticData(groups, apiKey);
  problems.push(...validateDemand(demand, domestic, missingPoints));

  if (problems.length) {
    for (const p of problems) console.error(`problem ${p}`);
    console.error(`${problems.length} problem(s); public/data left unchanged`);
    return 1;
  }

  const files: Record<string, string> = {
    'demand.json': `${JSON.stringify(demand)}\n`,
    'places.json': `[\n${places.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`,
    'domestic.json': `${JSON.stringify(domestic, null, 1)}\n`,
  };
  const tmp = join(ROOT, 'public/.demand-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(tmp, name), text);
  for (const name of Object.keys(files)) renameSync(join(tmp, name), join(OUT, name));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`wrote ${counties.length} counties (${year}), ${places.length} places, ${Object.keys(domestic.products).length} domestic products`);
  return 0;
}

main().then((code) => process.exit(code), (err) => {
  console.error((err as Error).message);
  process.exit(1);
});
