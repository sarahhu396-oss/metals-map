import {
  PRODUCT_GROUPS,
  type Direction, type Flow, type Measure, type ProductGroup, type Selection,
} from '../../shared/types';
import type { Dataset } from './load';

/** Arc endpoint for the United States, [lon, lat] */
export const US: [number, number] = [-98.5, 39.8];

export interface Totals {
  /** 0 when there was no trade; null when there was trade but no reported quantity */
  tonnes: number | null;
  value: number;
  duty: number | null;
  /** Value of the flows that reported a quantity; the numerator for price */
  pricedValue: number;
}

type Acc = Totals & { n: number; qty: number; hasQty: boolean };

function emptyAcc(): Acc {
  return { tonnes: 0, value: 0, duty: null, pricedValue: 0, n: 0, qty: 0, hasQty: false };
}

function add(acc: Acc, f: Flow): void {
  acc.n++;
  acc.value += f.value;
  if (f.tonnes !== null) {
    acc.qty += f.tonnes;
    acc.hasQty = true;
    acc.pricedValue += f.value;
  }
  if (f.duty !== null) acc.duty = (acc.duty ?? 0) + f.duty;
}

function finish(acc: Acc): Totals {
  return {
    tonnes: acc.n === 0 ? 0 : acc.hasQty ? acc.qty : null,
    value: acc.value,
    duty: acc.duty,
    pricedValue: acc.pricedValue,
  };
}

function combine(a: Totals, b: Totals): Totals {
  return {
    tonnes: a.tonnes === null && b.tonnes === null ? null : (a.tonnes ?? 0) + (b.tonnes ?? 0),
    value: a.value + b.value,
    duty: a.duty === null && b.duty === null ? null : (a.duty ?? 0) + (b.duty ?? 0),
    pricedValue: a.pricedValue + b.pricedValue,
  };
}

const byMonthCache = new WeakMap<Flow[], Map<string, Flow[]>>();

function flowsByMonth(ds: Dataset): Map<string, Flow[]> {
  let idx = byMonthCache.get(ds.flows);
  if (!idx) {
    idx = new Map();
    for (const f of ds.flows) {
      const list = idx.get(f.month);
      if (list) list.push(f);
      else idx.set(f.month, [f]);
    }
    byMonthCache.set(ds.flows, idx);
  }
  return idx;
}

export function windowMonths(
  months: string[], month: string, window: 'month' | 't12',
): string[] | null {
  const i = months.indexOf(month);
  if (i < 0) return null;
  if (window === 'month') return [month];
  if (i < 11) return null;
  return months.slice(i - 11, i + 1);
}

function selectedDirections(sel: Selection): Direction[] {
  return sel.direction === 'both' ? ['imports', 'exports'] : [sel.direction];
}

interface Filter {
  product: ProductGroup | 'all';
  dirs: Direction[];
  cty?: string;
}

/** Totals per country and direction over the given months. */
function accumulate(ds: Dataset, months: string[], filter: Filter): Map<string, Record<Direction, Acc>> {
  const idx = flowsByMonth(ds);
  const out = new Map<string, Record<Direction, Acc>>();
  for (const m of months) {
    for (const f of idx.get(m) ?? []) {
      if (filter.product !== 'all' && f.group !== filter.product) continue;
      if (!filter.dirs.includes(f.dir)) continue;
      if (filter.cty !== undefined && f.cty !== filter.cty) continue;
      let rec = out.get(f.cty);
      if (!rec) {
        rec = { imports: emptyAcc(), exports: emptyAcc() };
        out.set(f.cty, rec);
      }
      add(rec[f.dir], f);
    }
  }
  return out;
}

/** One Totals over the given months, across countries (or one country) and directions. */
function total(ds: Dataset, months: string[], filter: Filter): Totals {
  const acc = emptyAcc();
  const idx = flowsByMonth(ds);
  for (const m of months) {
    for (const f of idx.get(m) ?? []) {
      if (filter.product !== 'all' && f.group !== filter.product) continue;
      if (!filter.dirs.includes(f.dir)) continue;
      if (filter.cty !== undefined && f.cty !== filter.cty) continue;
      add(acc, f);
    }
  }
  return finish(acc);
}

export function totalsByCountry(
  ds: Dataset, sel: Selection,
): Map<string, Record<Direction, Totals>> {
  const out = new Map<string, Record<Direction, Totals>>();
  const months = windowMonths(ds.months, sel.month, sel.window);
  if (!months) return out;
  const accs = accumulate(ds, months, { product: sel.product, dirs: selectedDirections(sel) });
  for (const [cty, rec] of accs) {
    out.set(cty, { imports: finish(rec.imports), exports: finish(rec.exports) });
  }
  return out;
}

export function measureOf(t: Totals, measure: Measure): number | null {
  if (measure === 'value') return t.value;
  if (measure === 'tonnes') return t.tonnes;
  if (t.tonnes === null || t.tonnes <= 0) return null;
  return t.pricedValue / t.tonnes;
}

/** The selected measure for a Totals, honouring the rule that price needs one direction. */
function measureFor(t: Totals, sel: Selection): number | null {
  if (sel.measure === 'price' && sel.direction === 'both') return null;
  return measureOf(t, sel.measure);
}

export interface Ranked {
  cty: string;
  value: number | null;
  share: number | null;
}

export function rankings(ds: Dataset, sel: Selection): Ranked[] {
  const rows: Ranked[] = [];
  for (const [cty, rec] of totalsByCountry(ds, sel)) {
    const t = sel.direction === 'both' ? combine(rec.imports, rec.exports) : rec[sel.direction];
    rows.push({ cty, value: measureFor(t, sel), share: null });
  }
  if (sel.measure !== 'price') {
    const sum = rows.reduce((s, r) => s + (r.value ?? 0), 0);
    if (sum > 0) {
      for (const r of rows) r.share = r.value === null ? null : r.value / sum;
    }
  }
  rows.sort((a, b) => {
    if (a.value === null && b.value === null) return a.cty.localeCompare(b.cty);
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value || a.cty.localeCompare(b.cty);
  });
  return rows;
}

/** Combined share of the three largest partners, 0..1. */
export function concentration(ranked: Ranked[]): number | null {
  const shares = ranked.map((r) => r.share).filter((s): s is number => s !== null);
  if (shares.length === 0) return null;
  return shares.slice(0, 3).reduce((s, x) => s + x, 0);
}

export interface Arc {
  cty: string;
  dir: Direction;
  from: [number, number];
  to: [number, number];
  value: number;
}

export function arcs(ds: Dataset, sel: Selection): Arc[] {
  const out: Arc[] = [];
  for (const [cty, rec] of totalsByCountry(ds, sel)) {
    const c = ds.countries.get(cty);
    if (!c) continue;
    const here: [number, number] = [c.lon, c.lat];
    for (const dir of selectedDirections(sel)) {
      const value = measureFor(rec[dir], sel);
      if (value === null || value <= 0) continue;
      out.push(dir === 'imports'
        ? { cty, dir, from: here, to: US, value }
        : { cty, dir, from: US, to: here, value });
    }
  }
  return out;
}

function windowValue(ds: Dataset, sel: Selection, month: string, cty?: string): number | null {
  const months = windowMonths(ds.months, month, sel.window);
  if (!months) return null;
  const t = total(ds, months, { product: sel.product, dirs: selectedDirections(sel), cty });
  return measureFor(t, sel);
}

export function timeSeries(
  ds: Dataset, sel: Selection, cty?: string,
): { month: string; value: number | null }[] {
  return ds.months.map((month) => ({ month, value: windowValue(ds, sel, month, cty) }));
}

export function productMix(
  ds: Dataset, sel: Selection, cty: string,
): { group: ProductGroup; value: number | null }[] {
  return PRODUCT_GROUPS.map((group) => ({
    group,
    value: windowValue(ds, { ...sel, product: group }, sel.month, cty),
  }));
}

export function yoyChange(ds: Dataset, sel: Selection, cty?: string): number | null {
  const i = ds.months.indexOf(sel.month);
  if (i < 12) return null;
  const now = windowValue(ds, sel, sel.month, cty);
  const then = windowValue(ds, sel, ds.months[i - 12], cty);
  if (now === null || then === null || then === 0) return null;
  return (now - then) / then;
}

/** Calculated duty divided by customs value, imports only. */
export function dutyRate(ds: Dataset, sel: Selection, cty?: string): number | null {
  const months = windowMonths(ds.months, sel.month, sel.window);
  if (!months) return null;
  const t = total(ds, months, { product: sel.product, dirs: ['imports'], cty });
  if (t.duty === null || t.value <= 0) return null;
  return t.duty / t.value;
}
