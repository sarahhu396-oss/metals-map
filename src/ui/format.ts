import type { Direction, Measure, ProductGroup } from '../../shared/types';

export const PRODUCT_LABELS: Record<ProductGroup | 'all', string> = {
  plate: 'Plate (over 6.3 mm)',
  sheet: 'Sheet & strip',
  bar_rod_profiles: 'Bar, rod & profiles',
  unwrought: 'Unwrought',
  tube: 'Tube & pipe',
  foil: 'Foil',
  all: 'All products',
};

export const DIRECTION_LABELS: Record<Direction | 'both', string> = {
  imports: 'Imports',
  exports: 'Exports',
  both: 'Both',
};

export const MEASURE_LABELS: Record<Measure, string> = {
  tonnes: 'Tonnes',
  value: 'Value',
  price: 'Price per tonne',
};

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function dollars(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${integer.format(v)}`;
}

export function formatMeasure(v: number | null, measure: Measure): string {
  if (v === null) return 'no data';
  if (measure === 'tonnes') return `${integer.format(v)} t`;
  if (measure === 'value') return dollars(v);
  return `$${integer.format(v)}/t`;
}

export function formatShare(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

export function formatChange(v: number | null): string {
  if (v === null) return '—';
  const pct = (Math.abs(v) * 100).toFixed(1);
  return `${v < 0 ? '−' : '+'}${pct}%`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}
