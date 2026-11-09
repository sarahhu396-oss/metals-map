import type { Flow, ProductGroup } from '../shared/types';
import type { RawRow } from './census';

/** 10-digit code → group */
export type GroupMap = Record<string, ProductGroup>;

/** Countries have 4-digit codes 1000–9999; totals ('-'), groupings (0003…) and continents (1XXX…) do not. */
export function isCountryRow(ctyCode: string): boolean {
  return /^[1-9]\d{3}$/.test(ctyCode);
}

export function transform(rows: RawRow[], groups: GroupMap): {
  flows: Flow[];
  unmapped: string[];
  nonKg: { commodity: string; unit: string }[];
} {
  const unmapped = new Set<string>();
  const nonKg = new Map<string, { commodity: string; unit: string }>();
  const acc = new Map<string, Flow & { kg: number | null }>();

  for (const r of rows) {
    if (!isCountryRow(r.ctyCode)) continue;
    const group = groups[r.commodity];
    if (!group) {
      unmapped.add(r.commodity);
      continue;
    }
    if (r.qtyKg === null) nonKg.set(`${r.commodity}|${r.unit}`, { commodity: r.commodity, unit: r.unit });
    const key = `${r.month}|${r.dir}|${group}|${r.ctyCode}`;
    let f = acc.get(key);
    if (!f) {
      f = { month: r.month, dir: r.dir, group, cty: r.ctyCode, tonnes: null, value: 0, duty: r.dir === 'imports' ? 0 : null, kg: null };
      acc.set(key, f);
    }
    f.value += r.value;
    if (r.qtyKg !== null) f.kg = (f.kg ?? 0) + r.qtyKg;
    if (f.duty !== null) f.duty += r.duty ?? 0;
  }

  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const flows = [...acc.values()]
    .map(({ kg, ...f }) => ({ ...f, tonnes: kg === null ? null : kg / 1000 }))
    .sort((a, b) => cmp(a.month, b.month) || cmp(a.dir, b.dir) || cmp(a.group, b.group) || cmp(a.cty, b.cty));

  return { flows, unmapped: [...unmapped].sort(), nonKg: [...nonKg.values()] };
}
