import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildUrl, parseResponse } from '../../pipeline/census';
import { fetchRange } from '../../pipeline/fetch';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '../../pipeline/fixtures', name), 'utf8');

describe('buildUrl', () => {
  test('imports: heading wildcard, month range, HS10, and the import variables', () => {
    const url = new URL(buildUrl('imports', '7606', '2024-01', '2024-12'));
    expect(url.pathname).toBe('/data/timeseries/intltrade/imports/hs');
    expect(url.searchParams.get('I_COMMODITY')).toBe('7606*');
    expect(url.searchParams.get('time')).toBe('from 2024-01 to 2024-12');
    expect(url.searchParams.get('COMM_LVL')).toBe('HS10');
    expect(url.searchParams.get('get')).toContain('CAL_DUT_MO');
    expect(url.searchParams.has('key')).toBe(false);
  });

  test('exports use the export variables', () => {
    const url = new URL(buildUrl('exports', '7601', '2015-01', '2015-12'));
    expect(url.pathname).toBe('/data/timeseries/intltrade/exports/hs');
    expect(url.searchParams.get('E_COMMODITY')).toBe('7601*');
    expect(url.searchParams.get('get')).toContain('ALL_VAL_MO');
  });

  test('adds key only when one is given', () => {
    expect(new URL(buildUrl('imports', '7606', '2024-01', '2024-01', 'abc')).searchParams.get('key')).toBe('abc');
  });
});

describe('parseResponse', () => {
  const rows = parseResponse('imports', fixture('imports-7606-2024-01.json'));

  test('parses real import rows', () => {
    expect(rows.length).toBeGreaterThan(50);
    const china = rows.find((r) => r.ctyCode === '5700' && r.commodity === '7606113030')!;
    expect(china).toEqual({
      month: '2024-01', dir: 'imports', ctyCode: '5700', ctyName: 'CHINA',
      commodity: '7606113030', description: 'ALUM PLT SHT STRP REC/SQ NAL NT CLD OV 6.3MM THCK',
      qtyKg: 6880, unit: 'KG', value: 187386, duty: 38414,
    });
    for (const r of rows) expect(r.commodity).toMatch(/^\d{10}$/);
  });

  test('parses real export rows with null duty', () => {
    const ex = parseResponse('exports', fixture('exports-7606-2024-01.json'));
    expect(ex.length).toBeGreaterThan(50);
    expect(ex.every((r) => r.duty === null && r.dir === 'exports')).toBe(true);
    expect(ex.every((r) => typeof r.value === 'number' && !Number.isNaN(r.value))).toBe(true);
  });

  test('quantity is null when the unit is not KG', () => {
    const body = JSON.stringify([
      ['CTY_CODE', 'CTY_NAME', 'I_COMMODITY', 'I_COMMODITY_SDESC', 'CON_QY1_MO', 'UNIT_QY1', 'CON_VAL_MO', 'CAL_DUT_MO', 'time'],
      ['5700', 'CHINA', '7606113030', 'X', '12', 'NO', '500', '0', '2024-01'],
    ]);
    expect(parseResponse('imports', body)[0].qtyKg).toBeNull();
  });

  test('null, empty, and the real unpublished response give no rows', () => {
    expect(parseResponse('imports', null)).toEqual([]);
    expect(parseResponse('imports', '')).toEqual([]);
    expect(parseResponse('imports', fixture('imports-7606-unpublished.json'))).toEqual([]);
  });
});

/** Stub API: answers with one country row for each month in `has` inside the requested range. */
function stub(has: string[], opts: { status?: number } = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (opts.status) return new Response('error', { status: opts.status });
    const [, from, , to] = url.searchParams.get('time')!.split(' ');
    const months = has.filter((m) => m >= from && m <= to);
    if (months.length === 0) return new Response(null, { status: 204 });
    const imports = url.pathname.includes('/imports/');
    const header = imports
      ? ['CTY_CODE', 'CTY_NAME', 'I_COMMODITY', 'I_COMMODITY_SDESC', 'CON_QY1_MO', 'UNIT_QY1', 'CON_VAL_MO', 'CAL_DUT_MO', 'time']
      : ['CTY_CODE', 'CTY_NAME', 'E_COMMODITY', 'E_COMMODITY_SDESC', 'QTY_1_MO', 'UNIT_QY1', 'ALL_VAL_MO', 'time'];
    const rows = months.map((m) =>
      imports ? ['1220', 'CANADA', '7606113030', 'X', '1000', 'KG', '5000', '0', m]
              : ['1220', 'CANADA', '7606113030', 'X', '1000', 'KG', '5000', m]);
    return new Response(JSON.stringify([header, ...rows]), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'census-'));

describe('fetchRange', () => {
  test('range ends at the last month with data; raw files are written per year', async () => {
    const { impl } = stub(['2015-01', '2015-02', '2015-03']);
    const outDir = tmp();
    const res = await fetchRange({ start: '2015-01', headings: ['7606', '7604'], outDir, fetchImpl: impl, retryDelayMs: 0 });
    expect(res.latestMonth).toBe('2015-03');
    expect(res.months).toEqual(['2015-01', '2015-02', '2015-03']);
    expect(readdirSync(outDir).sort()).toContain('imports-7606-2015.json');
    expect(readdirSync(outDir)).toContain('exports-7604-2015.json');
  });

  test('walks into later years and stops at the first empty year', async () => {
    const { impl, calls } = stub(['2015-12', '2016-01']);
    const res = await fetchRange({ start: '2015-12', headings: ['7606'], outDir: tmp(), fetchImpl: impl, retryDelayMs: 0 });
    expect(res.latestMonth).toBe('2016-01');
    expect(res.months).toEqual(['2015-12', '2016-01']);
    expect(calls.some((c) => new URL(c).searchParams.get('time')!.includes('from 2015-12 to 2015-12'))).toBe(true);
    expect(calls.some((c) => new URL(c).searchParams.get('time')!.includes('from 2017-01 to 2017-12'))).toBe(true);
    expect(calls.some((c) => new URL(c).searchParams.get('time')!.includes('2018'))).toBe(false);
  });

  test('an empty month before the latest month rejects, naming it', async () => {
    const { impl } = stub(['2015-01', '2015-03']);
    await expect(
      fetchRange({ start: '2015-01', headings: ['7606'], outDir: tmp(), fetchImpl: impl, retryDelayMs: 0 }),
    ).rejects.toThrow(/2015-02/);
  });

  test('HTTP 500 rejects after retrying', async () => {
    const { impl, calls } = stub([], { status: 500 });
    await expect(
      fetchRange({ start: '2015-01', headings: ['7606'], outDir: tmp(), fetchImpl: impl, retryDelayMs: 0 }),
    ).rejects.toThrow(/500/);
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  test('no data at all rejects', async () => {
    const { impl } = stub([]);
    await expect(
      fetchRange({ start: '2015-01', headings: ['7606'], outDir: tmp(), fetchImpl: impl, retryDelayMs: 0 }),
    ).rejects.toThrow(/no data/i);
  });
});
