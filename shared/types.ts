export type Direction = 'imports' | 'exports';

export type ProductGroup =
  | 'plate_sheet'
  | 'bar_rod_profiles'
  | 'unwrought'
  | 'tube'
  | 'foil';

export interface Flow {
  /** 'YYYY-MM' */
  month: string;
  dir: Direction;
  group: ProductGroup;
  /** Census 4-digit country code */
  cty: string;
  /** Metric tonnes; null when no quantity was reported in kilograms */
  tonnes: number | null;
  /** US dollars */
  value: number;
  /** US dollars of calculated duty; null for exports */
  duty: number | null;
}

export interface Country {
  code: string;
  name: string;
  iso2: string;
  lat: number;
  lon: number;
}

export interface Meta {
  latestMonth: string;
  fetchedAt: string;
  source: string;
}

export interface TariffEvent {
  date: string;
  label: string;
  url: string;
}

export type Measure = 'tonnes' | 'value' | 'price';

export interface Selection {
  product: ProductGroup | 'all';
  direction: Direction | 'both';
  measure: Measure;
  month: string;
  window: 'month' | 't12';
  country: string | null;
}

export const PRODUCT_GROUPS: ProductGroup[] = [
  'plate_sheet',
  'bar_rod_profiles',
  'unwrought',
  'tube',
  'foil',
];
