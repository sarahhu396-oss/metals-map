import type { Direction } from '../shared/types';

export interface RawRow {
  month: string;
  dir: Direction;
  ctyCode: string;
  ctyName: string;
  /** 10-digit code */
  commodity: string;
  description: string;
  /** null when the unit is not kg or the quantity is absent */
  qtyKg: number | null;
  unit: string;
  value: number;
  duty: number | null;
}

const BASE = 'https://api.census.gov/data/timeseries/intltrade';

const VARS = {
  imports: {
    commodity: 'I_COMMODITY', desc: 'I_COMMODITY_SDESC', qty: 'CON_QY1_MO',
    value: 'CON_VAL_MO', duty: 'CAL_DUT_MO',
  },
  exports: {
    commodity: 'E_COMMODITY', desc: 'E_COMMODITY_SDESC', qty: 'QTY_1_MO',
    value: 'ALL_VAL_MO', duty: null,
  },
} as const;

/** One request for every 10-digit code under `heading`, all countries, months `from`..`to` inclusive. */
export function buildUrl(dir: Direction, heading: string, from: string, to: string, apiKey?: string): string {
  const v = VARS[dir];
  const get = ['CTY_CODE', 'CTY_NAME', v.commodity, v.desc, v.qty, 'UNIT_QY1', v.value, ...(v.duty ? [v.duty] : [])];
  const params = new URLSearchParams({
    get: get.join(','),
    time: `from ${from} to ${to}`,
    COMM_LVL: 'HS10',
    [v.commodity]: `${heading}*`,
  });
  if (apiKey) params.set('key', apiKey);
  return `${BASE}/${dir}/hs?${params.toString()}`;
}

function num(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Parse an API body. The month of each row comes from its `time` column. Null/empty body → []. */
export function parseResponse(dir: Direction, body: string | null): RawRow[] {
  if (body === null || body.trim() === '') return [];
  const data = JSON.parse(body) as (string | null)[][];
  if (!Array.isArray(data) || data.length < 2) return [];
  const [header, ...rows] = data;
  const v = VARS[dir];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Census ${dir} response lacks column ${name}`);
    return i;
  };
  const c = {
    cty: col('CTY_CODE'), name: col('CTY_NAME'), commodity: col(v.commodity), desc: col(v.desc),
    qty: col(v.qty), unit: col('UNIT_QY1'), value: col(v.value), time: col('time'),
    duty: v.duty ? col(v.duty) : -1,
  };
  return rows.map((r) => {
    const unit = r[c.unit] ?? '';
    return {
      month: r[c.time] ?? '',
      dir,
      ctyCode: r[c.cty] ?? '',
      ctyName: r[c.name] ?? '',
      commodity: r[c.commodity] ?? '',
      description: r[c.desc] ?? '',
      qtyKg: unit === 'KG' ? num(r[c.qty]) : null,
      unit,
      value: num(r[c.value]) ?? 0,
      duty: c.duty >= 0 ? num(r[c.duty]) ?? 0 : null,
    };
  });
}
