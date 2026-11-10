import { expect, test } from 'vitest';
import type { CountyDemand, IndustryGroup } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import {
  RINGS_MI,
  byGroup,
  classes,
  countyValue,
  miles,
  territories,
  topCounties,
  total,
  within,
} from '../../src/demand/query';

function zero<T>(v: T): Record<IndustryGroup, T> {
  return Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, v])) as Record<IndustryGroup, T>;
}
function county(
  fips: string,
  lat: number,
  lon: number,
  estab: Partial<Record<IndustryGroup, number>> = {},
  emp: Partial<Record<IndustryGroup, number | null>> = {},
): CountyDemand {
  return {
    fips,
    name: fips,
    lat,
    lon,
    estab: { ...zero(0), ...estab },
    emp: { ...zero<number | null>(0), ...emp },
  };
}
const DEG_PER_MI = 180 / (Math.PI * 3958.8);

test('rings', () => {
  expect([...RINGS_MI]).toEqual([150, 300, 500]);
});

test('miles Detroit to Chicago', () => {
  expect(Math.abs(miles([-83.0458, 42.3314], [-87.6298, 41.8781]) - 237)).toBeLessThanOrEqual(2);
});

test('within includes 149.9 mi and excludes 150.1 mi', () => {
  const site = { name: 's', lat: 0, lon: 0 };
  const a = county('A', 0, 149.9 * DEG_PER_MI);
  const b = county('B', 0, 150.1 * DEG_PER_MI);
  expect(within([a, b], site, 150).map((c) => c.fips)).toEqual(['A']);
});

test('territories: identical sites and ties go to the first site', () => {
  const s = { name: 's', lat: 40, lon: -80 };
  const cs = [county('A', 41, -81), county('B', 35, -90)];
  const t = territories(cs, [s, { ...s, name: 't' }]);
  expect(t[0].map((c) => c.fips)).toEqual(['A', 'B']);
  expect(t[1]).toEqual([]);
  const tie = territories([county('M', 0, 5)], [
    { name: 'w', lat: 0, lon: 0 },
    { name: 'e', lat: 0, lon: 10 },
  ]);
  expect(tie[0]).toHaveLength(1);
  expect(tie[1]).toHaveLength(0);
});

test('territories with no sites is empty; nearer site wins', () => {
  expect(territories([county('A', 0, 0)], [])).toEqual([]);
  const t = territories([county('A', 0, 9)], [
    { name: 'w', lat: 0, lon: 0 },
    { name: 'e', lat: 0, lon: 10 },
  ]);
  expect(t[1]).toHaveLength(1);
});

test('withheld county is reported and excluded from emp, not from estab', () => {
  const ok = county('A', 0, 0, { auto: 2 }, { auto: 100 });
  const w = county('B', 0, 0, { auto: 3 }, { auto: null });
  expect(total([ok, w], ['auto'], 'emp')).toEqual({ value: 100, withheldCounties: 1 });
  expect(total([ok, w], ['auto'], 'estab')).toEqual({ value: 5, withheldCounties: 0 });
  expect(byGroup([ok, w], ['auto', 'aero'], 'emp').auto).toEqual({ value: 100, withheldCounties: 1 });
  expect(byGroup([ok, w], ['auto', 'aero'], 'emp').aero).toEqual({ value: 0, withheldCounties: 0 });
  expect(countyValue(w, ['auto'], 'emp')).toBeNull();
  expect(countyValue(w, ['aero'], 'emp')).toBe(0);
  expect(countyValue(w, ['auto'], 'estab')).toBe(3);
});

test('a county with two withheld groups counts once in total', () => {
  const w = county('B', 0, 0, {}, { auto: null, aero: null, hvac: 4 });
  expect(total([w], ['auto', 'aero', 'hvac'], 'emp')).toEqual({ value: 4, withheldCounties: 1 });
});

test('empty groups give zeros, no NaN', () => {
  const c = county('A', 0, 0, { auto: 2 }, { auto: null });
  expect(total([c], [], 'emp')).toEqual({ value: 0, withheldCounties: 0 });
  expect(countyValue(c, [], 'emp')).toBe(0);
  expect(classes([], 5)).toEqual([]);
});

test('classes', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  const b = classes(v, 5);
  expect(b).toHaveLength(4);
  expect([...b].sort((x, y) => x - y)).toEqual(b);
  expect(classes([7, 7, 7, 7], 5)).toEqual([7]);
  expect(classes([0, 0, 0], 5)).toEqual([]);
  expect(classes([0, 0, 1, 2, 3, 4, 5], 2)).toHaveLength(1);
});

test('topCounties sorts desc, nulls last, ties by fips', () => {
  const cs = [
    county('03', 0, 0, { auto: 5 }),
    county('02', 0, 0, { auto: 5 }),
    county('01', 0, 0, { auto: 9 }),
    county('00', 0, 0, { auto: 1 }, { auto: null }),
  ];
  const r = topCounties(cs, ['auto'], 'emp', 10);
  expect(r.map((x) => x.county.fips)).toEqual(['01', '02', '03', '00']);
  const e = topCounties(cs, ['auto'], 'estab', 3);
  expect(e.map((x) => x.county.fips)).toEqual(['01', '02', '03']);
  const m = topCounties(
    [county('1', 0, 0, {}, { auto: null }), county('2', 0, 0, {}, { auto: 3 })],
    ['auto'],
    'emp',
    5,
  );
  expect(m.map((x) => x.county.fips)).toEqual(['2', '1']);
  expect(m[1].value).toBeNull();
});
