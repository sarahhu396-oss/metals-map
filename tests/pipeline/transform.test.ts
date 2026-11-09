import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseResponse, type RawRow } from '../../pipeline/census';
import groupsJson from '../../pipeline/product-groups.json';
import { isCountryRow, transform, type GroupMap } from '../../pipeline/transform';

const groups = groupsJson as GroupMap;

function row(p: Partial<RawRow>): RawRow {
  return {
    month: '2024-01', dir: 'imports', ctyCode: '1220', ctyName: 'CANADA',
    commodity: '7606123035', description: 'x', qtyKg: 1000, unit: 'KG', value: 1, duty: 0, ...p,
  };
}

describe('transform', () => {
  test('sums codes of one group for the same month, direction, and country', () => {
    const { flows } = transform([
      row({ commodity: '7606123035', qtyKg: 1500, value: 10, duty: 1 }),
      row({ commodity: '7606123025', qtyKg: 500, value: 5, duty: 2 }),
    ], groups);
    expect(flows).toEqual([
      { month: '2024-01', dir: 'imports', group: 'plate', cty: '1220', tonnes: 2, value: 15, duty: 3 },
    ]);
  });

  test('null quantity is skipped in tonnes and reported; all-null gives null tonnes', () => {
    const mixed = transform([
      row({ commodity: '7606123035', qtyKg: null, unit: 'NO', value: 4 }),
      row({ commodity: '7606123025', qtyKg: 1000, value: 6 }),
    ], groups);
    expect(mixed.flows[0]).toMatchObject({ tonnes: 1, value: 10 });
    expect(mixed.nonKg).toEqual([{ commodity: '7606123035', unit: 'NO' }]);

    const none = transform([row({ qtyKg: null, unit: 'NO' }), row({ commodity: '7606123025', qtyKg: null, unit: 'NO' })], groups);
    expect(none.flows[0].tonnes).toBeNull();
  });

  test('exports have null duty; imports sum duty', () => {
    const { flows } = transform([
      row({ dir: 'exports', duty: null }),
      row({ duty: 7 }),
      row({ commodity: '7606123025', duty: 3 }),
    ], groups);
    expect(flows.find((f) => f.dir === 'exports')!.duty).toBeNull();
    expect(flows.find((f) => f.dir === 'imports')!.duty).toBe(10);
  });

  test('an unmapped code is reported and contributes to no flow', () => {
    const { flows, unmapped } = transform([row({ commodity: '7606999999', value: 99 }), row({ value: 1 })], groups);
    expect(unmapped).toEqual(['7606999999']);
    expect(flows.reduce((s, f) => s + f.value, 0)).toBe(1);
  });

  test('plate and sheet split on the 6.3 mm break; clad codes are sheet', () => {
    expect(groups['7606123035']).toBe('plate');
    expect(groups['7606123096']).toBe('sheet');
    expect(groups['7606123045']).toBe('sheet');
    expect(groups['7606126000']).toBe('sheet');
    expect(groups['7604291090']).toBe('bar_rod_profiles');
  });

  test('aggregate rows from the real fixture are dropped; only country rows are summed', () => {
    const body = readFileSync(join(__dirname, '../../pipeline/fixtures/imports-7606-2024-01.json'), 'utf8');
    const rows = parseResponse('imports', body);
    for (const c of ['-', '0003', '0020', '1XXX', '5XXX']) {
      expect(rows.some((r) => r.ctyCode === c)).toBe(true);
      expect(isCountryRow(c)).toBe(false);
    }
    expect(isCountryRow('1220')).toBe(true);
    const { flows, unmapped } = transform(rows, groups);
    expect(unmapped).toEqual([]);
    const countryValue = rows.filter((r) => /^[1-9]\d{3}$/.test(r.ctyCode)).reduce((s, r) => s + r.value, 0);
    const total = rows.filter((r) => r.ctyCode === '-').reduce((s, r) => s + r.value, 0);
    expect(flows.reduce((s, f) => s + f.value, 0)).toBe(countryValue);
    expect(countryValue).toBe(total);
    expect(flows.every((f) => isCountryRow(f.cty))).toBe(true);
  });

  test('output is sorted by month, direction, group, country', () => {
    const { flows } = transform([
      row({ month: '2024-02', ctyCode: '1220' }),
      row({ month: '2024-01', ctyCode: '5700' }),
      row({ month: '2024-01', ctyCode: '1220', commodity: '7606123096' }),
      row({ month: '2024-01', ctyCode: '1220' }),
      row({ month: '2024-01', dir: 'exports', duty: null }),
    ], groups);
    expect(flows.map((f) => [f.month, f.dir, f.group, f.cty].join(' '))).toEqual([
      '2024-01 exports plate 1220',
      '2024-01 imports plate 1220',
      '2024-01 imports plate 5700',
      '2024-01 imports sheet 1220',
      '2024-02 imports plate 1220',
    ]);
  });
});
