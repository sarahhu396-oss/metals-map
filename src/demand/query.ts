import type { CountyDemand, IndustryGroup, Site } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';

export type DemandMeasure = 'emp' | 'estab';
export const RINGS_MI = [150, 300, 500] as const;

const EARTH_RADIUS_MI = 3958.8;

/** Great-circle (haversine) distance in miles between [lon, lat] points. */
export function miles(a: [lon: number, lat: number], b: [lon: number, lat: number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Amount {
  /** Sum of the non-withheld cells */
  value: number;
  /** Counties with at least one withheld selected cell */
  withheldCounties: number;
}

function cell(c: CountyDemand, g: IndustryGroup, m: DemandMeasure): number | null {
  return m === 'estab' ? c.estab[g] : c.emp[g];
}

export function countyValue(c: CountyDemand, groups: IndustryGroup[], m: DemandMeasure): number | null {
  let sum = 0;
  for (const g of groups) {
    const v = cell(c, g, m);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export function total(cs: CountyDemand[], groups: IndustryGroup[], m: DemandMeasure): Amount {
  let value = 0;
  let withheldCounties = 0;
  for (const c of cs) {
    let withheld = false;
    for (const g of groups) {
      const v = cell(c, g, m);
      if (v === null) withheld = true;
      else value += v;
    }
    if (withheld) withheldCounties++;
  }
  return { value, withheldCounties };
}

export function byGroup(
  cs: CountyDemand[],
  groups: IndustryGroup[],
  m: DemandMeasure,
): Record<IndustryGroup, Amount> {
  const out = {} as Record<IndustryGroup, Amount>;
  for (const g of INDUSTRY_GROUPS) {
    out[g] = groups.includes(g) ? total(cs, [g], m) : { value: 0, withheldCounties: 0 };
  }
  return out;
}

function dist(c: CountyDemand, s: Site): number {
  return miles([c.lon, c.lat], [s.lon, s.lat]);
}

export function within(cs: CountyDemand[], site: Site, radiusMi: number): CountyDemand[] {
  return cs.filter((c) => dist(c, site) <= radiusMi);
}

export function territories(cs: CountyDemand[], sites: Site[]): CountyDemand[][] {
  const out: CountyDemand[][] = sites.map(() => []);
  if (sites.length === 0) return out;
  for (const c of cs) {
    let best = 0;
    let bestD = Infinity;
    sites.forEach((s, i) => {
      const d = dist(c, s);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    out[best].push(c);
  }
  return out;
}

export function topCounties(
  cs: CountyDemand[],
  groups: IndustryGroup[],
  m: DemandMeasure,
  n: number,
): { county: CountyDemand; value: number | null }[] {
  return cs
    .map((county) => ({ county, value: countyValue(county, groups, m) }))
    .sort((a, b) => {
      if (a.value === null && b.value !== null) return 1;
      if (b.value === null && a.value !== null) return -1;
      if (a.value !== null && b.value !== null && a.value !== b.value) return b.value - a.value;
      return a.county.fips < b.county.fips ? -1 : a.county.fips > b.county.fips ? 1 : 0;
    })
    .slice(0, n);
}

/** Up to k-1 ascending, de-duplicated quantile breaks over the positive values. */
export function classes(values: number[], k: number): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0 || k < 2) return [];
  const breaks: number[] = [];
  for (let i = 1; i < k; i++) {
    const pos = (i / k) * (v.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const b = v[lo] + (v[hi] - v[lo]) * (pos - lo);
    if (breaks.length === 0 || b > breaks[breaks.length - 1]) breaks.push(b);
  }
  return breaks;
}
