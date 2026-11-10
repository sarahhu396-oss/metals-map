import { describe, expect, test } from 'vitest';
import type { DomesticData } from '../../shared/demand';
import { importShare, importShareSeries } from '../../src/data/domestic';

const dom: DomesticData = {
  years: [2015, 2016, 2017],
  products: {
    plate: {
      codes: ['x'],
      domestic: { '2015': 80, '2016': 80, '2017': null },
      imports: { '2015': 30, '2016': 30, '2017': 30 },
      exports: { '2015': 10, '2016': 10, '2017': 10 },
      note: null,
    },
    foil: {
      codes: ['y'],
      domestic: { '2015': 5, '2016': 5 },
      imports: { '2015': 1, '2016': 1 },
      exports: { '2015': 20, '2016': 5 },
      note: null,
    },
  },
};

describe('importShare', () => {
  test('imports over domestic plus imports minus exports', () => {
    expect(importShare(dom, 'plate', 2016)).toBeCloseTo(0.3);
  });
  test('null when the denominator is zero or negative', () => {
    expect(importShare(dom, 'foil', 2015)).toBeNull(); // 5+1-20 < 0
    expect(importShare(dom, 'foil', 2016)).toBeCloseTo(1); // 5+1-5 = 1 is positive
  });
  test('null when any term is missing', () => {
    expect(importShare(dom, 'plate', 2017)).toBeNull();
    expect(importShare(dom, 'plate', 1999)).toBeNull();
  });
  test('null for a product with no domestic entry', () => {
    expect(importShare(dom, 'tube', 2016)).toBeNull();
  });
});

describe('importShareSeries', () => {
  test('follows dom.years in order', () => {
    const s = importShareSeries(dom, 'plate');
    expect(s.map((p) => p.year)).toEqual([2015, 2016, 2017]);
    expect(s[2].share).toBeNull();
  });
});
