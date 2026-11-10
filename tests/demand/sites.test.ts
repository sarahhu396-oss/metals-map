import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Place, Site } from '../../shared/demand';
import {
  DEFAULT_SITES,
  decodeSites,
  encodeSites,
  loadSites,
  saveSites,
  searchPlaces,
} from '../../src/demand/sites';

const KEY = 'metals-map.sites';
const label = (p: Place) => `${p[0]}, ${p[1]}`;

test('default site is Detroit, MI', () => {
  expect(DEFAULT_SITES).toEqual([{ name: 'Detroit, MI', lat: 42.3830375, lon: -83.1022365 }]);
});

test('encode produces name@lat,lon joined by semicolons', () => {
  const s: Site[] = [
    { name: 'Detroit, MI', lat: 42.3314, lon: -83.0458 },
    { name: 'Los Angeles, CA', lat: 34.05, lon: -118.24 },
  ];
  expect(encodeSites(s)).toBe('Detroit, MI@42.3314,-83.0458;Los Angeles, CA@34.05,-118.24');
});

test('round trip with commas, non-ASCII and reserved characters', () => {
  const s: Site[] = [
    { name: 'Mayagüez, PR', lat: 18.2011, lon: -67.1397 },
    { name: 'Odd@name;100% [x]', lat: 40.1234, lon: -100.5 },
  ];
  expect(decodeSites(encodeSites(s))).toEqual(s);
});

test('encode rounds coordinates to 4 decimals', () => {
  expect(encodeSites(DEFAULT_SITES)).toBe('Detroit, MI@42.383,-83.1022');
});

test('decode returns null when absent', () => {
  expect(decodeSites(null)).toBeNull();
});

test('decode drops malformed entries and collapses duplicates', () => {
  const got = decodeSites(
    [
      'A, XX@91,10', // lat out of range
      'B, XX@10,181', // lon out of range
      'C, XX@abc,10', // not a number
      'D, XX@10', // missing lon
      '@10,10', // empty name
      '   @10,10', // blank name
      'E, XX@,10', // empty lat
      'noat',
      'Toronto, ON@43.6532,-79.3832', // Canada is valid
      'Toronto, ON@43.6532,-79.3832', // exact duplicate
    ].join(';'),
  );
  expect(got).toEqual([{ name: 'Toronto, ON', lat: 43.6532, lon: -79.3832 }]);
});

function mem(initial: Record<string, string> = {}) {
  const m = { ...initial };
  return {
    getItem: (k: string) => (k in m ? m[k] : null),
    setItem: (k: string, v: string) => {
      m[k] = v;
    },
    m,
  };
}

test('loadSites: URL wins over storage', () => {
  const st = mem({ [KEY]: 'Stored, XX@1,1' });
  expect(loadSites('?sites=' + encodeURIComponent('Url, XX@2,2'), st)).toEqual([
    { name: 'Url, XX', lat: 2, lon: 2 },
  ]);
});

test('loadSites: storage used when no URL param', () => {
  const st = mem({ [KEY]: 'Stored, XX@1,1' });
  expect(loadSites('', st)).toEqual([{ name: 'Stored, XX', lat: 1, lon: 1 }]);
});

test('loadSites: invalid URL list falls through to storage, then defaults', () => {
  const st = mem({ [KEY]: 'Stored, XX@1,1' });
  expect(loadSites('?sites=garbage', st)).toEqual([{ name: 'Stored, XX', lat: 1, lon: 1 }]);
  expect(loadSites('?sites=garbage', mem())).toEqual(DEFAULT_SITES);
});

test('loadSites: throwing or missing storage gives defaults', () => {
  const bad = {
    getItem: () => {
      throw new Error('denied');
    },
  };
  expect(loadSites('', bad)).toEqual(DEFAULT_SITES);
  expect(loadSites('', null)).toEqual(DEFAULT_SITES);
});

test('saveSites writes the encoded list and swallows errors', () => {
  const st = mem();
  saveSites(DEFAULT_SITES, st);
  expect(st.m[KEY]).toBe(encodeSites(DEFAULT_SITES));
  expect(() =>
    saveSites(DEFAULT_SITES, {
      setItem: () => {
        throw new Error('quota');
      },
    }),
  ).not.toThrow();
  expect(() => saveSites(DEFAULT_SITES, null)).not.toThrow();
});

const small: Place[] = [
  ['Mount San Jose', 'XX', 1, 1, 10],
  ['San Jose', 'CA', 37.3, -121.9, 1_000_000],
  ['San Jose', 'IL', 40.3, -89.5, 600],
  ['Mayagüez', 'PR', 18.2, -67.1, 73_000],
  ['St. Louis', 'MO', 38.6, -90.2, 300_000],
  ['Saint Louis', 'MI', 43.4, -84.6, 7_000],
  ['Louisville', 'KY', 38.2, -85.7, 600_000],
];

test('searchPlaces basics', () => {
  expect(searchPlaces(small, '')).toEqual([]);
  expect(searchPlaces(small, '   ')).toEqual([]);
  expect(searchPlaces(small, 'zzz')).toEqual([]);
});

test('within a rank, larger places come first, then name, then state', () => {
  const ps: Place[] = [
    ['Springfield', 'AL', 0, 0, 0],
    ['Springfield', 'MO', 0, 0, 169_000],
    ['Springfield', 'IL', 0, 0, 114_000],
    ['Springfield', 'AK', 0, 0, 0],
    ['Springfield Gardens', 'NY', 0, 0, 0],
  ];
  expect(searchPlaces(ps, 'springfield').map(label)).toEqual([
    'Springfield, MO', 'Springfield, IL', 'Springfield, AK', 'Springfield, AL', 'Springfield Gardens, NY',
  ]);
});

test('a partial saint ("sai", "sain") matches St. names; shorter prefixes do not', () => {
  expect(searchPlaces(small, 'sai louis').map(label).sort()).toEqual(['Saint Louis, MI', 'St. Louis, MO']);
  expect(searchPlaces(small, 'sain louis').map(label).sort()).toEqual(['Saint Louis, MI', 'St. Louis, MO']);
  expect(searchPlaces(small, 'sa louis')).toEqual([]);
});

test('prefix matches rank before infix, ties by name then state', () => {
  const got = searchPlaces(small, 'san jose').map(label);
  expect(got).toEqual(['San Jose, CA', 'San Jose, IL', 'Mount San Jose, XX']);
});

test('state code can match a token', () => {
  expect(searchPlaces(small, 'san jose ca').map(label)).toEqual(['San Jose, CA']);
});

test('accents, st / st. / saint are equivalent', () => {
  expect(searchPlaces(small, 'mayaguez').map(label)).toEqual(['Mayagüez, PR']);
  const want = ['Saint Louis, MI', 'St. Louis, MO'];
  expect(searchPlaces(small, 'st louis').map(label).sort()).toEqual(want);
  expect(searchPlaces(small, 'st. louis').map(label).sort()).toEqual(want);
  expect(searchPlaces(small, 'saint louis').map(label).sort()).toEqual(want);
});

test('limit defaults to 8 and is adjustable', () => {
  const many: Place[] = Array.from({ length: 20 }, (_, i) => ['Springfield', 'S' + String(i).padStart(2, '0'), 0, 0, 0]);
  expect(searchPlaces(many, 'spring')).toHaveLength(8);
  expect(searchPlaces(many, 'spring', 3)).toHaveLength(3);
});

const real: Place[] = JSON.parse(readFileSync('public/data/places.json', 'utf8'));

test('real places: san jose, mayaguez, st/saint louis', () => {
  expect(searchPlaces(real, 'san jose').map(label)).toContain('San Jose, CA');
  expect(searchPlaces(real, 'mayaguez').map(label)).toContain('Mayagüez, PR');
  expect(searchPlaces(real, 'st louis', 20).map(label)).toContain('St. Louis, MO');
  expect(searchPlaces(real, 'saint louis', 20).map(label)).toContain('St. Louis, MO');
});

test('real places: the big city wins an ambiguous name', () => {
  const first = (q: string) => label(searchPlaces(real, q)[0]);
  expect(first('detroit')).toBe('Detroit, MI');
  expect(first('houston')).toBe('Houston, TX');
  expect(first('san jose')).toBe('San Jose, CA');
  expect(first('portland')).toBe('Portland, OR');
  const sp = searchPlaces(real, 'springfield', 8).map(label);
  expect(sp).toContain('Springfield, MO');
  expect(sp).toContain('Springfield, IL');
});

test('real places: every place carries a population', () => {
  expect(real.every((p) => p.length === 5 && Number.isFinite(p[4]))).toBe(true);
  expect(real.find((p) => p[0] === 'Detroit' && p[1] === 'MI')![4]).toBeGreaterThan(600_000);
});
