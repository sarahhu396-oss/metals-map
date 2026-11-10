import type { DomesticData } from '../../shared/demand';
import type { ProductGroup } from '../../shared/types';

/** Imports ÷ (domestic + imports − exports), dollars, one calendar year. */
export function importShare(dom: DomesticData, product: ProductGroup, year: number): number | null {
  const p = dom.products[product];
  if (!p) return null;
  const key = String(year);
  const d = p.domestic[key];
  const i = p.imports[key];
  const e = p.exports[key];
  if (d == null || i == null || e == null) return null;
  const supply = d + i - e;
  return supply > 0 ? i / supply : null;
}

export function importShareSeries(
  dom: DomesticData, product: ProductGroup,
): { year: number; share: number | null }[] {
  return dom.years.map((year) => ({ year, share: importShare(dom, product, year) }));
}
