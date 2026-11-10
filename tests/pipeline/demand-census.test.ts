import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  asmUrl, cbpUrl, geoinfoUrl, latestCbpYear, parseAsm, parseCbp, parsePoints,
} from '../../pipeline/demand/census';
import { cleanPlace } from '../../pipeline/demand/places';
import { fetchText } from '../../pipeline/fetch';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../pipeline/demand/fixtures', name), 'utf8');

describe('urls', () => {
  test('cbpUrl asks for all counties, the all-sizes class and the NAICS code', () => {
    const u = new URL(cbpUrl(2023, '3364'));
    expect(u.pathname).toBe('/data/2023/cbp');
    expect(u.searchParams.get('get')).toBe('NAME,ESTAB,EMP,EMP_N_F');
    expect(u.searchParams.get('for')).toBe('county:*');
    expect(u.searchParams.get('NAICS2017')).toBe('3364');
    expect(u.searchParams.get('EMPSZES')).toBe('001');
  });
  test('geoinfoUrl by level', () => {
    const c = new URL(geoinfoUrl(2023, 'county'));
    expect(c.pathname).toBe('/data/2023/geoinfo');
    expect(c.searchParams.get('for')).toBe('county:*');
    expect(c.searchParams.get('get')).toBe('NAME,INTPTLAT,INTPTLON');
    expect(new URL(geoinfoUrl(2023, 'place')).searchParams.get('for')).toBe('place:*');
  });
  test('asmUrl asks for US-level product values', () => {
    const u = new URL(asmUrl(2016));
    expect(u.pathname).toBe('/data/timeseries/asm/product');
    expect(u.searchParams.get('get')).toBe('PSCODE,PRODVAL');
    expect(u.searchParams.get('for')).toBe('us:*');
    expect(u.searchParams.get('YEAR')).toBe('2016');
  });
  test('the key appears only when given', () => {
    for (const make of [(k?: string) => cbpUrl(2023, '3364', k), (k?: string) => geoinfoUrl(2023, 'county', k), (k?: string) => asmUrl(2016, k)]) {
      expect(make()).not.toContain('key=');
      expect(new URL(make('abc')).searchParams.get('key')).toBe('abc');
    }
  });
});

describe('parseCbp', () => {
  test('Michigan aerospace fixture: Macomb', () => {
    const m = parseCbp(fixture('cbp-2023-3364-mi.json'));
    expect(m.get('26099')).toEqual({ name: 'Macomb County, Michigan', estab: 10, emp: 844 });
  });
  test('D and N withhold employment; G, H and J keep the number', () => {
    const body = JSON.stringify([
      ['NAME', 'ESTAB', 'EMP', 'EMP_N_F', 'NAICS2017', 'EMPSZES', 'state', 'county'],
      ['A', '3', '0', 'D', '333', '001', '09', '001'],
      ['B', '4', '0', 'N', '333', '001', '09', '003'],
      ['C', '5', '100', 'G', '333', '001', '09', '005'],
      ['D', '6', '200', 'H', '333', '001', '09', '007'],
      ['E', '7', '300', 'J', '333', '001', '09', '009'],
    ]);
    const m = parseCbp(body);
    expect(m.get('09001')!.emp).toBeNull();
    expect(m.get('09003')!.emp).toBeNull();
    expect(m.get('09001')!.estab).toBe(3);
    expect(m.get('09005')!.emp).toBe(100);
    expect(m.get('09007')!.emp).toBe(200);
    expect(m.get('09009')!.emp).toBe(300);
  });
  test('empty body (204) is an empty map', () => {
    expect(parseCbp('').size).toBe(0);
  });
});

describe('parsePoints', () => {
  test('county fixture: Capitol Planning Region', () => {
    const p = parsePoints(fixture('geoinfo-2023-county-09.json'), 'county').find((x) => x.id === '09110')!;
    expect(p.name).toBe('Capitol Planning Region, Connecticut');
    expect(p.lat).toBeCloseTo(41.81697, 5);
    expect(p.lon).toBeCloseTo(-72.5758861, 6);
  });
  test('place fixture: ids are state+place and Detroit is present', () => {
    const p = parsePoints(fixture('geoinfo-2023-place-26.json'), 'place');
    const d = p.find((x) => x.name.startsWith('Detroit city'))!;
    expect(d.id).toMatch(/^26\d{5}$/);
    expect(d.lat).toBeGreaterThan(42);
    expect(d.lon).toBeLessThan(-82);
  });
});

describe('parseAsm', () => {
  test('values are converted from thousands to dollars', () => {
    expect(parseAsm(fixture('asm-2016-33131.json')).get('3313151')).toBe(1_693_573_000);
  });
});

describe('latestCbpYear', () => {
  test('walks back to the newest year the probe accepts', async () => {
    expect(await latestCbpYear(async (y) => y <= 2023, 2026)).toBe(2023);
  });
  test('rejects when no year is available', async () => {
    await expect(latestCbpYear(async () => false, 2026)).rejects.toThrow(/CBP/);
  });
});

describe('cleanPlace', () => {
  test.each([
    ['Abbeville city, Alabama', 'Abbeville', 'AL'],
    ['Abanda CDP, Alabama', 'Abanda', 'AL'],
    ['Nashville-Davidson metropolitan government (balance), Tennessee', 'Nashville-Davidson', 'TN'],
    ['Mayagüez municipio, Puerto Rico', 'Mayagüez', 'PR'],
    ['Washington city, District of Columbia', 'Washington', 'DC'],
    ['Fort Wayne city, Indiana', 'Fort Wayne', 'IN'],
  ])('%s', (raw, name, state) => {
    expect(cleanPlace(raw)).toEqual({ name, state });
  });
});

describe('fetchText', () => {
  const res = (status: number, body: string | null = null) => new Response(body, { status });
  test('204 resolves to an empty string', async () => {
    expect(await fetchText('https://x/y', { fetchImpl: async () => res(204) })).toBe('');
  });
  test('redirect is fatal and not retried', async () => {
    let n = 0;
    await expect(fetchText('https://x/y?key=s', { retryDelayMs: 0, fetchImpl: async () => (n++, res(302)) })).rejects.toThrow(/CENSUS_API_KEY/);
    expect(n).toBe(1);
  });
  test('retries then masks the key', async () => {
    let n = 0;
    const err = (await fetchText('https://x/y?key=secret&a=1', { retryDelayMs: 0, fetchImpl: async () => (n++, res(500)) }).catch((e) => e)) as Error;
    expect(n).toBe(4);
    expect(err.message).toContain('key=***');
    expect(err.message).not.toContain('secret');
  });
});
