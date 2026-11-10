import { describe, expect, test } from 'vitest';
import { validateDemand } from '../../pipeline/demand/validate';
import { INDUSTRY_GROUPS, type CountyDemand, type DemandData, type DomesticData, type DomesticProduct } from '../../shared/demand';

const zero = () => Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, 0])) as Record<(typeof INDUSTRY_GROUPS)[number], number>;

function demand(n: number, estabEach = 1): DemandData {
  const counties: CountyDemand[] = Array.from({ length: n }, (_, i) => ({
    fips: String(10000 + i), name: `C${i}`, lat: 0, lon: 0,
    estab: Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, estabEach])) as CountyDemand['estab'],
    emp: zero(),
  }));
  return { year: 2023, groups: [], counties };
}

const years = [2012, 2013, 2014, 2015, 2016];
const full = (v: number | null = 1) => Object.fromEntries(years.map((y) => [String(y), v]));
const product = (o: Partial<DomesticProduct> = {}): DomesticProduct => ({
  codes: ['1'], domestic: full(), imports: full(), exports: full(), note: null, ...o,
});
const domestic = (p: DomesticProduct = product()): DomesticData => ({ years, products: { plate: p } });

describe('validateDemand', () => {
  test('county count bounds', () => {
    expect(validateDemand(demand(3099), domestic(), [])).toHaveLength(1);
    expect(validateDemand(demand(3222), domestic(), [])).toEqual([]);
    expect(validateDemand(demand(3301), domestic(), [])).toHaveLength(1);
  });
  test('names CBP counties without a point', () => {
    const p = validateDemand(demand(3222), domestic(), ['99999']);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('99999');
  });
  test('names a group with no establishments', () => {
    const d = demand(3222);
    d.counties.forEach((c) => (c.estab.hvac = 0));
    const p = validateDemand(d, domestic(), []);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('hvac');
  });
  test('names a product and year missing domestic values', () => {
    const p = validateDemand(demand(3222), domestic(product({ domestic: { ...full(), '2014': null } })), []);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('plate');
    expect(p[0]).toContain('2014');
  });
  test('2016 imports must be present; earlier years may be null', () => {
    expect(validateDemand(demand(3222), domestic(product({ imports: { ...full(), '2013': null } })), [])).toEqual([]);
    const p = validateDemand(demand(3222), domestic(product({ imports: { ...full(), '2016': null } })), []);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('plate');
  });
});
