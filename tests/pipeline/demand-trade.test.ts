import { describe, expect, test } from 'vitest';
import { sumTrade } from '../../pipeline/demand/trade';
import type { RawRow } from '../../pipeline/census';
import type { GroupMap } from '../../pipeline/transform';

const row = (commodity: string, value: number): RawRow => ({
  month: '2016-01', dir: 'imports', ctyCode: '-', ctyName: 'TOTAL', commodity, description: '',
  qtyKg: null, unit: 'KG', value, duty: null,
});
const groups: GroupMap = { '7606110000': 'plate', '7606120000': 'sheet', '7601100000': 'unwrought' };
const H = (heading: string, ...rows: RawRow[]) => ({ heading, rows });
const empty = ['7601', '7604', '7606', '7607', '7608'].map((h) => H(h));

describe('sumTrade', () => {
  test('sums mapped codes by product group', () => {
    const r = sumTrade([H('7601', row('7601100000', 5), row('7601100000', 7)), H('7606', row('7606110000', 3), row('7606120000', 4))], groups)!;
    expect(r.unwrought).toBe(12);
    expect(r.plate).toBe(3);
    expect(r.sheet).toBe(4);
    expect(r.foil).toBe(0);
  });
  test.each([
    ['7601', 'unwrought'], ['7604', 'bar_rod_profiles'], ['7607', 'foil'], ['7608', 'tube'],
  ])('unmapped %s code falls back to %s', (heading, group) => {
    const r = sumTrade([H(heading, row(`${heading}999999`, 9))], groups)!;
    expect(r[group as keyof typeof r]).toBe(9);
    expect(r.plate).toBe(0);
  });
  test.each([
    ['unmapped first', [row('7606999999', 5), row('7606110000', 3), row('7606120000', 4)]],
    ['unmapped last', [row('7606110000', 3), row('7606120000', 4), row('7606999999', 5)]],
    ['unmapped between', [row('7606110000', 3), row('7606999999', 5), row('7606120000', 4)]],
  ])('unmapped 7606 with value nulls plate and sheet (%s)', (_n, rows) => {
    const r = sumTrade([H('7601', row('7601100000', 1)), H('7606', ...rows)], groups)!;
    expect(r.plate).toBeNull();
    expect(r.sheet).toBeNull();
    expect(r.unwrought).toBe(1);
  });
  test('unmapped 7606 with zero value does not null them', () => {
    const r = sumTrade([H('7606', row('7606999999', 0), row('7606110000', 3))], groups)!;
    expect(r.plate).toBe(3);
    expect(r.sheet).toBe(0);
  });
  test('no rows at all → null', () => {
    expect(sumTrade(empty, groups)).toBeNull();
  });
});
