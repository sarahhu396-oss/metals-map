import type { Place, Site } from '../../shared/demand';

/** Census geoinfo point for Detroit city, MI (from public/data/places.json). */
export const DEFAULT_SITES: Site[] = [{ name: 'Detroit, MI', lat: 42.3830375, lon: -83.1022365 }];

const STORAGE_KEY = 'metals-map.sites';

/** Percent-encode only the characters the list format uses as separators. */
function escapeName(name: string): string {
  return name.replace(/[%@;]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function unescapeName(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * `name@lat,lon` entries joined by `;`. Coordinates are rounded to 4 decimals
 * (about 10 m), which keeps URLs short. `%`, `@` and `;` inside a name are
 * percent-encoded. The caller URL-encodes the whole string for the query.
 */
export function encodeSites(sites: Site[]): string {
  const r = (n: number) => String(Math.round(n * 1e4) / 1e4);
  return sites.map((s) => `${escapeName(s.name)}@${r(s.lat)},${r(s.lon)}`).join(';');
}

function num(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** null when `s` is absent; malformed entries and exact duplicates are dropped. */
export function decodeSites(s: string | null): Site[] | null {
  if (s === null) return null;
  const out: Site[] = [];
  const seen = new Set<string>();
  for (const entry of s.split(';')) {
    const at = entry.lastIndexOf('@');
    if (at < 0) continue;
    const name = unescapeName(entry.slice(0, at))?.trim();
    const parts = entry.slice(at + 1).split(',');
    if (!name || parts.length !== 2) continue;
    const lat = num(parts[0]);
    const lon = num(parts[1]);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const key = `${name}@${lat},${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat, lon });
  }
  return out;
}

/** Query string first, then storage, then the default. Empty/invalid lists fall through. */
export function loadSites(search: string, storage: Pick<Storage, 'getItem'> | null): Site[] {
  const fromUrl = decodeSites(new URLSearchParams(search).get('sites'));
  if (fromUrl && fromUrl.length) return fromUrl;
  try {
    const fromStore = decodeSites(storage ? storage.getItem(STORAGE_KEY) : null);
    if (fromStore && fromStore.length) return fromStore;
  } catch {
    // storage unavailable
  }
  return DEFAULT_SITES;
}

export function saveSites(sites: Site[], storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(STORAGE_KEY, encodeSites(sites));
  } catch {
    // storage unavailable or full
  }
}

function tokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => (t === 'saint' ? 'st' : t));
}

const SAINT = 'saint';

/**
 * Every query token must prefix a name token (or equal the state code). Full-name prefixes rank
 * first; within a rank larger places come first, then name, then state. A query token that is
 * at least 3 letters of "saint" also matches "St.".
 */
export function searchPlaces(places: Place[], query: string, limit = 8): Place[] {
  const q = tokens(query).map((t) => ({ t, saint: t.length >= 3 && t.length < SAINT.length && SAINT.startsWith(t) }));
  if (!q.length) return [];
  const qs = q.map((x) => (x.saint ? 'st' : x.t)).join(' ');
  const hits: { p: Place; rank: number; name: string; state: string }[] = [];
  for (const p of places) {
    const nt = tokens(p[0]);
    const state = p[1].toLowerCase();
    if (!q.every(({ t, saint }) => t === state || nt.some((n) => n.startsWith(t) || (saint && n === 'st')))) continue;
    hits.push({ p, rank: nt.join(' ').startsWith(qs) ? 0 : 1, name: nt.join(' '), state });
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.p[4] - a.p[4] ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.state < b.state ? -1 : a.state > b.state ? 1 : 0),
  );
  return hits.slice(0, limit).map((h) => h.p);
}
