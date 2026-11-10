import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Country, Flow, Selection } from '../../shared/types';
import { loadDataset, type Dataset } from '../../src/data/load';
import {
  US, arcs, concentration, dutyRate, measureOf, productMix, rankings,
  timeSeries, totalsByCountry, windowMonths, yoyChange,
} from '../../src/data/query';

function monthList(start: string, n: number): string[] {
  let [y, m] = start.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const MONTHS = monthList('2023-01', 26); // 2023-01 .. 2025-02
const LAST = MONTHS[25];

const COUNTRIES: Country[] = [
  { code: '1220', name: 'Canada', iso2: 'CA', lat: 56, lon: -106 },
  { code: '5700', name: 'China', iso2: 'CN', lat: 35, lon: 104 },
  { code: '4280', name: 'Germany', iso2: 'DE', lat: 51, lon: 10 },
  { code: '5330', name: 'India', iso2: 'IN', lat: 21, lon: 78 },
];

function ds(flows: Flow[]): Dataset {
  return {
    flows,
    countries: new Map(COUNTRIES.map((c) => [c.code, c])),
    meta: { latestMonth: LAST, fetchedAt: '2025-04-10T00:00:00Z', source: 'test' },
    events: [],
    months: MONTHS,
  };
}

function flow(p: Partial<Flow>): Flow {
  return { month: LAST, dir: 'imports', group: 'plate', cty: '1220', tonnes: 1, value: 1, duty: 0, ...p };
}

const SEL: Selection = {
  product: 'plate', direction: 'imports', measure: 'tonnes',
  month: LAST, window: 'month', country: null,
};

describe('windowMonths', () => {
  test('t12 returns the 12 months ending at the given month', () => {
    const w = windowMonths(MONTHS, '2024-03', 't12');
    expect(w).toHaveLength(12);
    expect(w![0]).toBe('2023-04');
    expect(w![11]).toBe('2024-03');
  });
  test('t12 is null inside the first 11 months', () => {
    expect(windowMonths(MONTHS, '2023-11', 't12')).toBeNull();
    expect(windowMonths(MONTHS, '2023-12', 't12')).not.toBeNull();
  });
  test('month returns just that month', () => {
    expect(windowMonths(MONTHS, '2024-03', 'month')).toEqual(['2024-03']);
  });
  test('unknown month is null', () => {
    expect(windowMonths(MONTHS, '2030-01', 'month')).toBeNull();
  });
});

describe('rankings and concentration', () => {
  const d = ds([
    flow({ cty: '1220', tonnes: 40 }),
    flow({ cty: '5700', tonnes: 30 }),
    flow({ cty: '4280', tonnes: 20 }),
    flow({ cty: '5330', tonnes: 10 }),
  ]);

  test('orders by tonnes with shares summing to 1', () => {
    const r = rankings(d, SEL);
    expect(r.map((x) => x.cty)).toEqual(['1220', '5700', '4280', '5330']);
    expect(r[0].share).toBeCloseTo(0.4);
    expect(r.reduce((s, x) => s + (x.share ?? 0), 0)).toBeCloseTo(1);
  });

  test('a country with unknown quantity ranks last with null share', () => {
    const r = rankings(ds([
      flow({ cty: '1220', tonnes: null, value: 999 }),
      flow({ cty: '5700', tonnes: 5 }),
    ]), SEL);
    expect(r.map((x) => x.cty)).toEqual(['5700', '1220']);
    expect(r[1].value).toBeNull();
    expect(r[1].share).toBeNull();
    expect(r[0].share).toBeCloseTo(1);
  });

  test('concentration is the top-3 share', () => {
    expect(concentration(rankings(d, SEL))).toBeCloseTo(0.9);
  });

  test('share and concentration are null for price', () => {
    const r = rankings(d, { ...SEL, measure: 'price' });
    expect(r.every((x) => x.share === null)).toBe(true);
    expect(concentration(r)).toBeNull();
  });

  test('both directions rank by imports plus exports', () => {
    const r = rankings(ds([
      flow({ cty: '1220', tonnes: 10 }),
      flow({ cty: '1220', dir: 'exports', tonnes: 25, duty: null }),
      flow({ cty: '5700', tonnes: 30 }),
    ]), { ...SEL, direction: 'both' });
    expect(r[0]).toMatchObject({ cty: '1220', value: 35 });
  });

  test('product all sums groups; a single product excludes others', () => {
    const d2 = ds([
      flow({ tonnes: 3 }),
      flow({ group: 'foil', tonnes: 4 }),
    ]);
    expect(rankings(d2, { ...SEL, product: 'all' })[0].value).toBe(7);
    expect(rankings(d2, SEL)[0].value).toBe(3);
  });

  test('t12 sums the trailing twelve months only', () => {
    const d2 = ds(MONTHS.map((m) => flow({ month: m, tonnes: 1 })));
    expect(rankings(d2, { ...SEL, window: 't12' })[0].value).toBe(12);
  });

  test('t12 with too little history gives no rankings', () => {
    const d2 = ds(MONTHS.map((m) => flow({ month: m, tonnes: 1 })));
    expect(rankings(d2, { ...SEL, window: 't12', month: '2023-05' })).toEqual([]);
  });
});

describe('price per tonne', () => {
  const price = (flows: Flow[], sel: Partial<Selection> = {}) =>
    rankings(ds(flows), { ...SEL, measure: 'price', ...sel })[0].value;

  test('is value divided by tonnes', () => {
    expect(price([flow({ value: 3000, tonnes: 2 })])).toBe(1500);
  });
  test('is null when quantity is missing', () => {
    expect(price([flow({ value: 3000, tonnes: null })])).toBeNull();
  });
  test('is null when quantity is zero', () => {
    expect(price([flow({ value: 3000, tonnes: 0 })])).toBeNull();
  });
  test('ignores value from flows without quantity', () => {
    expect(price([
      flow({ value: 3000, tonnes: 2 }),
      flow({ group: 'foil', value: 9000, tonnes: null }),
    ], { product: 'all' })).toBe(1500);
  });
  test('is null for both directions', () => {
    expect(price([flow({ value: 3000, tonnes: 2 })], { direction: 'both' })).toBeNull();
  });
  test('measureOf never returns Infinity or NaN', () => {
    expect(measureOf({ tonnes: 0, value: 5, duty: null, pricedValue: 5 }, 'price')).toBeNull();
    expect(measureOf({ tonnes: null, value: 5, duty: null, pricedValue: 0 }, 'price')).toBeNull();
  });
});

describe('totalsByCountry', () => {
  test('keeps directions separate', () => {
    const t = totalsByCountry(ds([
      flow({ tonnes: 10, value: 100, duty: 5 }),
      flow({ dir: 'exports', tonnes: 4, value: 40, duty: null }),
    ]), { ...SEL, direction: 'both' });
    expect(t.get('1220')!.imports).toMatchObject({ tonnes: 10, value: 100, duty: 5 });
    expect(t.get('1220')!.exports).toMatchObject({ tonnes: 4, value: 40, duty: null });
  });
});

describe('arcs', () => {
  const flows = [
    flow({ cty: '1220', tonnes: 10 }),
    flow({ cty: '1220', dir: 'exports', tonnes: 4, duty: null }),
    flow({ cty: '5700', tonnes: 0 }),
    flow({ cty: '9999', tonnes: 50 }),
  ];
  test('imports run from the country to the US', () => {
    const a = arcs(ds(flows), SEL);
    expect(a).toEqual([{ cty: '1220', name: 'Canada', dir: 'imports', from: [-106, 56], to: US, value: 10 }]);
  });
  test('exports run from the US to the country', () => {
    const a = arcs(ds(flows), { ...SEL, direction: 'exports' });
    expect(a).toEqual([{ cty: '1220', name: 'Canada', dir: 'exports', from: US, to: [-106, 56], value: 4 }]);
  });
  test('both yields one arc per direction', () => {
    const a = arcs(ds(flows), { ...SEL, direction: 'both' });
    expect(a.filter((x) => x.cty === '1220').map((x) => x.dir).sort()).toEqual(['exports', 'imports']);
  });

  describe('top partners only', () => {
    // 25 countries; country i imports i+1 tonnes and exports 100-i tonnes
    const many: Country[] = Array.from({ length: 25 }, (_, i) => ({
      code: String(2000 + i), name: `C${i}`, iso2: 'XX', lat: i, lon: i,
    }));
    const manyFlows = many.flatMap((c, i) => [
      flow({ cty: c.code, tonnes: i + 1 }),
      flow({ cty: c.code, dir: 'exports', tonnes: 100 - i, duty: null }),
    ]);
    const big: Dataset = { ...ds(manyFlows), countries: new Map(many.map((c) => [c.code, c])) };

    test('keeps the 20 largest partners, largest first', () => {
      const a = arcs(big, SEL);
      expect(a).toHaveLength(20);
      expect(a[0]).toMatchObject({ cty: '2024', value: 25 });
      expect(a.map((x) => x.value)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
    });

    test('both directions keep their own top 20', () => {
      const a = arcs(big, { ...SEL, direction: 'both' });
      const imp = a.filter((x) => x.dir === 'imports').map((x) => x.cty);
      const exp = a.filter((x) => x.dir === 'exports').map((x) => x.cty);
      expect(imp).toHaveLength(20);
      expect(exp).toHaveLength(20);
      expect(imp).toContain('2024');
      expect(imp).not.toContain('2004');
      expect(exp).toContain('2000');
      expect(exp).not.toContain('2024');
    });

    test('a custom limit is honoured', () => {
      expect(arcs(big, SEL, 3).map((x) => x.cty)).toEqual(['2024', '2023', '2022']);
    });

    test('ties are broken by country code so the cut is stable', () => {
      const tied = many.map((c) => flow({ cty: c.code, tonnes: 5 }));
      const a = arcs({ ...big, flows: tied }, SEL, 2);
      expect(a.map((x) => x.cty)).toEqual(['2000', '2001']);
    });
  });
});

describe('timeSeries', () => {
  const d = ds(MONTHS.map((m, i) => flow({ month: m, tonnes: i + 1 })));
  test('has one point per month', () => {
    const s = timeSeries(d, SEL);
    expect(s).toHaveLength(26);
    expect(s[0]).toEqual({ month: '2023-01', value: 1 });
  });
  test('t12 is null for the first 11 months', () => {
    const s = timeSeries(d, { ...SEL, window: 't12' });
    expect(s.slice(0, 11).every((p) => p.value === null)).toBe(true);
    expect(s[11].value).toBe(78); // 1+...+12
  });
  test('filters to a country and reports zero for months without trade', () => {
    const s = timeSeries(d, SEL, '5700');
    expect(s.every((p) => p.value === 0)).toBe(true);
  });
});

describe('productMix', () => {
  test('lists every group for the country', () => {
    const mix = productMix(ds([flow({ tonnes: 3 }), flow({ group: 'foil', tonnes: 4 })]), SEL, '1220');
    expect(mix).toHaveLength(6);
    expect(mix.find((m) => m.group === 'plate')!.value).toBe(3);
    expect(mix.find((m) => m.group === 'foil')!.value).toBe(4);
    expect(mix.find((m) => m.group === 'tube')!.value).toBe(0);
  });
});

describe('yoyChange', () => {
  const prior = MONTHS[13]; // 2024-02
  test('is the relative change against a year earlier', () => {
    const d = ds([flow({ tonnes: 120 }), flow({ month: prior, tonnes: 100 })]);
    expect(yoyChange(d, SEL)).toBeCloseTo(0.2);
  });
  test('is null when the earlier period is zero', () => {
    expect(yoyChange(ds([flow({ tonnes: 120 })]), SEL)).toBeNull();
  });
  test('is null when the earlier window is unavailable', () => {
    const d = ds(MONTHS.map((m) => flow({ month: m, tonnes: 1 })));
    expect(yoyChange(d, { ...SEL, window: 't12', month: MONTHS[20] })).toBeNull();
    expect(yoyChange(d, { ...SEL, window: 't12', month: MONTHS[23] })).toBeCloseTo(0);
  });
  test('filters to a country', () => {
    const d = ds([
      flow({ tonnes: 50 }), flow({ month: prior, tonnes: 100 }),
      flow({ cty: '5700', tonnes: 500 }), flow({ cty: '5700', month: prior, tonnes: 100 }),
    ]);
    expect(yoyChange(d, SEL, '1220')).toBeCloseTo(-0.5);
  });
});

describe('dutyRate', () => {
  test('is duty over value for imports', () => {
    expect(dutyRate(ds([flow({ value: 1000, duty: 250 })]), SEL)).toBeCloseTo(0.25);
  });
  test('is null when value is zero', () => {
    expect(dutyRate(ds([flow({ value: 0, duty: 0 })]), SEL)).toBeNull();
    expect(dutyRate(ds([]), SEL)).toBeNull();
  });
  test('ignores export flows and the direction selection', () => {
    const d = ds([
      flow({ value: 1000, duty: 250 }),
      flow({ dir: 'exports', value: 9000, duty: null }),
    ]);
    expect(dutyRate(d, { ...SEL, direction: 'exports' })).toBeCloseTo(0.25);
  });
  test('filters to a country', () => {
    const d = ds([flow({ value: 1000, duty: 250 }), flow({ cty: '5700', value: 1000, duty: 500 })]);
    expect(dutyRate(d, SEL, '5700')).toBeCloseTo(0.5);
  });
});

describe('loadDataset', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('names the file that failed to load', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('flows-sheet.json')
        ? new Response('nope', { status: 404 })
        : new Response('[]', { status: 200 }));
    await expect(loadDataset('data/')).rejects.toThrow(/flows-sheet\.json/);
  });

  test('loads one flows file per product group and builds months and the country index', async () => {
    const files: Record<string, unknown> = {
      'flows-plate.json': [flow({ month: '2024-02' })],
      'flows-sheet.json': [flow({ month: '2024-01', group: 'sheet' })],
      'flows-bar_rod_profiles.json': [],
      'flows-unwrought.json': [],
      'flows-tube.json': [],
      'flows-foil.json': [],
      'countries.json': COUNTRIES,
      'meta.json': { latestMonth: '2024-02', fetchedAt: 'x', source: 'y' },
      'tariff-events.json': [],
    };
    vi.stubGlobal('fetch', async (url: string) =>
      new Response(JSON.stringify(files[url.split('/').pop()!]), { status: 200 }));
    const d = await loadDataset('data/');
    expect(d.months).toEqual(['2024-01', '2024-02']);
    expect(d.flows.map((f) => f.group).sort()).toEqual(['plate', 'sheet']);
    expect(d.countries.get('1220')!.name).toBe('Canada');
  });
});
