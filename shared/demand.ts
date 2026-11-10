import type { ProductGroup } from './types';

export type IndustryGroup =
  | 'aero'
  | 'auto'
  | 'trucks'
  | 'machinery'
  | 'semis'
  | 'electrical'
  | 'hvac'
  | 'shops';

/** Display order */
export const INDUSTRY_GROUPS: IndustryGroup[] = [
  'aero',
  'auto',
  'trucks',
  'machinery',
  'semis',
  'electrical',
  'hvac',
  'shops',
];

export interface GroupDef {
  id: IndustryGroup;
  label: string;
  /** NAICS codes summed */
  add: string[];
  /** NAICS codes contained in an added code and counted in another group */
  subtract: string[];
}

export interface CountyDemand {
  /** 5-digit state+county */
  fips: string;
  name: string;
  lat: number;
  lon: number;
  estab: Record<IndustryGroup, number>;
  /** null = withheld */
  emp: Record<IndustryGroup, number | null>;
}

export interface DemandData {
  year: number;
  groups: GroupDef[];
  counties: CountyDemand[];
}

export type Place = [name: string, state: string, lat: number, lon: number];

export interface DomesticProduct {
  /** ASM product codes summed */
  codes: string[];
  /** year → US mill shipments, dollars */
  domestic: Record<string, number | null>;
  /** year → imports for consumption, dollars */
  imports: Record<string, number | null>;
  /** year → total exports, dollars */
  exports: Record<string, number | null>;
  note: string | null;
}

export interface DomesticData {
  years: number[];
  products: Partial<Record<ProductGroup, DomesticProduct>>;
}

export interface Site {
  name: string;
  lat: number;
  lon: number;
}
