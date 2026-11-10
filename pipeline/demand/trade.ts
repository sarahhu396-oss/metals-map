import { PRODUCT_GROUPS, type ProductGroup } from '../../shared/types';
import type { RawRow } from '../census';
import type { GroupMap } from '../transform';

/** Group for HS10 codes missing from product-groups.json (pre-2015 codes), by heading. 7606 has no fallback. */
export const HEADING_FALLBACK: Record<string, ProductGroup> = {
  '7601': 'unwrought', '7604': 'bar_rod_profiles', '7607': 'foil', '7608': 'tube',
};

/**
 * Dollar totals per product group for one year and direction. `byHeading` holds each heading's
 * all-countries rows. No rows at all → null (the API does not serve the year). An unmapped 7606
 * code with nonzero value makes plate and sheet null, whatever the row order.
 */
export function sumTrade(
  byHeading: { heading: string; rows: RawRow[] }[],
  groups: GroupMap,
): Record<ProductGroup, number | null> | null {
  if (byHeading.every((h) => h.rows.length === 0)) return null;
  const sums = Object.fromEntries(PRODUCT_GROUPS.map((g) => [g, 0])) as Record<ProductGroup, number | null>;
  const poisoned = new Set<ProductGroup>();
  for (const { heading, rows } of byHeading) {
    for (const r of rows) {
      const g = groups[r.commodity] ?? HEADING_FALLBACK[heading];
      if (g) sums[g] = (sums[g] ?? 0) + r.value;
      else if (r.value !== 0) { poisoned.add('plate'); poisoned.add('sheet'); }
    }
  }
  for (const g of poisoned) sums[g] = null;
  return sums;
}
