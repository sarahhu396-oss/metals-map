import { geoAlbersUsa, geoCircle, geoPath } from 'd3-geo';
import type { Feature, Geometry, MultiLineString } from 'geojson';
import { feature, mesh } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { CountyDemand, DemandData, IndustryGroup, Site } from '../../shared/demand';
import { RINGS_MI, classes, countyValue, total, type DemandMeasure } from './query';

export interface CustomerState {
  groups: IndustryGroup[];
  measure: DemandMeasure;
  sites: Site[];
  county: string | null;
}

export interface UsShapes {
  /** One feature per atlas county, id = 5-digit FIPS */
  counties: Feature<Geometry>[];
  /** Interior state borders */
  borders: MultiLineString | null;
}

/** Gray ramp, light to near-black. */
export const RAMP = ['#f1f1ef', '#d4d4d0', '#a3a39e', '#5c5c58', '#1a1a19'];
const W = 975;
const H = 610;
const MI_PER_DEG = 69.0468;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Loaded on first use so the Supply bundle does not carry the atlas. */
export async function loadUsShapes(): Promise<UsShapes> {
  const atlas = await import('us-atlas/counties-10m.json');
  const topo = (atlas.default ?? atlas) as unknown as Topology;
  const counties = feature(topo, topo.objects.counties as never) as unknown as { features: Feature<Geometry>[] };
  const borders = mesh(topo, topo.objects.states as never, (a: unknown, b: unknown) => a !== b) as MultiLineString;
  return { counties: counties.features.map((f) => ({ ...f, id: String(f.id) })), borders };
}

/**
 * The atlas predates some county changes (Connecticut planning regions,
 * Alaska's Valdez-Cordova split). Within a state that has both data counties
 * without a shape and shapes without data, all of them become one area whose
 * value is the sum of the data counties. A lone leftover shape keeps its id as
 * the area key; several shapes use the 2-digit state code.
 */
export function mergeAreas(shapeIds: string[], dataFips: string[]): { shapeArea: Map<string, string>; members: Map<string, string[]> } {
  const shapeSet = new Set(shapeIds);
  const dataSet = new Set(dataFips);
  const byState = new Map<string, { shapes: string[]; data: string[] }>();
  const slot = (f: string) => byState.get(f.slice(0, 2)) ?? byState.set(f.slice(0, 2), { shapes: [], data: [] }).get(f.slice(0, 2))!;
  for (const s of shapeIds) if (!dataSet.has(s)) slot(s).shapes.push(s);
  for (const f of dataFips) if (!shapeSet.has(f)) slot(f).data.push(f);
  const shapeArea = new Map<string, string>();
  const members = new Map<string, string[]>();
  for (const [st, g] of byState) {
    if (!g.shapes.length || !g.data.length) continue;
    const area = g.shapes.length === 1 ? g.shapes[0] : st;
    members.set(area, g.data);
    for (const s of g.shapes) shapeArea.set(s, area);
  }
  return { shapeArea, members };
}

function areaValues(
  d: DemandData,
  groups: IndustryGroup[],
  m: DemandMeasure,
  members: Map<string, string[]>,
): Map<string, number | null> {
  const merged = new Set([...members.values()].flat());
  const byFips = new Map(d.counties.map((c) => [c.fips, c]));
  const out = new Map<string, number | null>();
  for (const c of d.counties) if (!merged.has(c.fips)) out.set(c.fips, countyValue(c, groups, m));
  for (const [area, fips] of members) {
    let sum = 0;
    let withheld = false;
    for (const f of fips) {
      const v = countyValue(byFips.get(f)!, groups, m);
      if (v === null) withheld = true;
      else sum += v;
    }
    out.set(area, withheld ? null : sum);
  }
  return out;
}

/** Per-shape values with Connecticut's planning regions summed under '09'. */
export function ctMerged(
  d: DemandData,
  groups: IndustryGroup[] = d.groups.map((g) => g.id),
  m: DemandMeasure = 'emp',
): Map<string, number | null> {
  const ct = d.counties.filter((c) => c.fips.startsWith('09')).map((c) => c.fips);
  return areaValues(d, groups, m, ct.length ? new Map([['09', ct]]) : new Map());
}

/** Title of a map area: a county, Connecticut's "state total", or other merged areas "(combined)". */
export function areaName(cs: CountyDemand[], area: string): string {
  const state = cs[0].name.split(', ').pop();
  if (cs.length < 2) return cs[0].name;
  if (area.length === 2) return `${state}: state total`;
  return `${cs.map((c) => c.name.split(', ')[0]).join(' + ')}, ${state} (combined)`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
const unit = (m: DemandMeasure) => (m === 'emp' ? 'employees' : 'establishments');

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export interface UsMapOptions {
  onCounty(fips: string | null): void;
  onMapClick(lonLat: [number, number]): void;
  /** Shapes already in hand (tests); the app passes the result of loadUsShapes */
  shapes: UsShapes;
  /** When true a plain click places a site instead of selecting a county */
  placing?: () => boolean;
}

export function createUsMap(el: HTMLElement, opts: UsMapOptions) {
  const projection = geoAlbersUsa().scale(1300).translate([W / 2, H / 2]);
  const path = geoPath(projection);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'usmap', role: 'img', 'aria-label': 'US customer map' });
  const defs = svgEl('defs');
  const pat = svgEl('pattern', { id: 'withheld-hatch', width: '5', height: '5', patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  pat.append(svgEl('rect', { width: '5', height: '5', fill: '#fff' }), svgEl('line', { x1: '0', y1: '0', x2: '0', y2: '5', stroke: '#5c5c58', 'stroke-width': '2' }));
  defs.append(pat);
  const gCounties = svgEl('g', { class: 'counties' });
  const gBorders = svgEl('g', { class: 'borders' });
  const gSites = svgEl('g', { class: 'sites' });
  svg.append(defs, gCounties, gBorders, gSites);
  if (opts.shapes.borders) gBorders.append(svgEl('path', { class: 'state-border', d: path(opts.shapes.borders) ?? '' }));
  const legend = document.createElement('div');
  legend.className = 'usmap-legend';
  el.classList.add('usmap-wrap');
  el.replaceChildren(svg, legend);

  const shapeIds = opts.shapes.counties.map((f) => String(f.id));
  const nodes = new Map<SVGPathElement, string>();
  let areaOf = new Map<string, string>();
  let areaMembers = new Map<string, string[]>();
  let lastData: DemandData | null = null;

  for (const f of opts.shapes.counties) {
    const p = svgEl('path', { class: 'county', d: path(f) ?? '' });
    p.append(svgEl('title'));
    nodes.set(p, String(f.id));
    gCounties.append(p);
  }

  /** Client pixels to viewBox units, honouring letterboxing; falls back to a stretched box. */
  function clientToSvg(cx: number, cy: number): [number, number] | null {
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    if (ctm && typeof svg.createSVGPoint === 'function') {
      const pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      const p = pt.matrixTransform(ctm.inverse());
      return [p.x, p.y];
    }
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return [(cx - r.left) * (W / r.width), (cy - r.top) * (H / r.height)];
  }

  svg.addEventListener('click', (ev) => {
    if (opts.placing?.() || (ev as MouseEvent).shiftKey) {
      const me = ev as MouseEvent;
      const xy = clientToSvg(me.clientX, me.clientY);
      if (!xy) return;
      const ll = projection.invert?.(xy);
      if (ll) opts.onMapClick([ll[0], ll[1]]);
      return;
    }
    const t = (ev.target as Element).closest?.('path.county');
    const fips = t?.getAttribute('data-fips') ?? null;
    opts.onCounty(fips && !t!.classList.contains('nodata') ? fips : null);
  });

  function renderLegend(breaks: number[], m: DemandMeasure): void {
    const f = formatCount;
    const labels = RAMP.map((_, i) => {
      if (!breaks.length) return i === 0 ? 'none' : '';
      if (i === 0) return `under ${f(Math.ceil(breaks[0]))}`;
      if (i >= breaks.length) return `${f(Math.ceil(breaks[breaks.length - 1]))}+`;
      return `${f(Math.ceil(breaks[i - 1]))}–${f(Math.ceil(breaks[i]))}`;
    });
    const sw = (cls: string, color: string, label: string) =>
      `<span class="lg"><i class="${cls}" style="background:${color}"></i>${label}</span>`;
    legend.innerHTML =
      `<span class="lg-title">${m === 'emp' ? 'Employees' : 'Establishments'} per county</span>` +
      RAMP.map((c, i) => (labels[i] ? sw('', c, labels[i]) : '')).join('') +
      '<span class="lg"><i class="hatch"></i>employment withheld</span>' +
      '<span class="lg"><i class="nd"></i>no data</span>';
  }

  function render(d: DemandData, s: CustomerState): void {
    if (lastData !== d) {
      const merge = mergeAreas(shapeIds, d.counties.map((c) => c.fips));
      areaOf = merge.shapeArea;
      areaMembers = merge.members;
      lastData = d;
    }
    const values = areaValues(d, s.groups, s.measure, areaMembers);
    const breaks = classes([...values.values()].filter((v): v is number => v !== null), RAMP.length);
    const cls = (v: number) => breaks.filter((b) => v >= b).length;
    const byFips = new Map(d.counties.map((c) => [c.fips, c]));
    const estabOf = (cs: CountyDemand[]) => total(cs, s.groups, 'estab').value;
    let selected: SVGPathElement | null = null;
    for (const [p, id] of nodes) {
      const area = areaOf.get(id) ?? id;
      const members = areaMembers.get(area);
      const has = values.has(area);
      p.setAttribute('data-fips', area);
      const v = has ? values.get(area)! : null;
      const withheld = has && v === null;
      p.classList.toggle('nodata', !has);
      p.classList.toggle('withheld', withheld);
      const sel = area === s.county;
      p.classList.toggle('selected', sel);
      if (sel) selected = p;
      p.setAttribute('fill', !has ? '#f7f7f5' : withheld ? 'url(#withheld-hatch)' : RAMP[cls(v!)]);
      const cs = members ? members.map((f) => byFips.get(f)!) : [byFips.get(area)!];
      const valueText = withheld
        ? `employment withheld (${formatCount(estabOf(cs))} establishments)`
        : `${formatCount(v ?? 0)} ${unit(s.measure)}`;
      const name = !has ? 'No data' : areaName(cs, area);
      p.firstElementChild!.textContent = !has ? `${name}` : `${name}: ${valueText}`;
    }
    if (selected) gCounties.append(selected);

    gSites.replaceChildren();
    for (const site of s.sites) {
      const g = svgEl('g', { class: 'site-group' });
      for (const mi of RINGS_MI) {
        const ring = geoCircle().center([site.lon, site.lat]).radius(mi / MI_PER_DEG)();
        g.append(svgEl('path', { class: 'ring', 'data-mi': String(mi), d: path(ring) ?? '' }));
      }
      const xy = projection([site.lon, site.lat]);
      if (xy) {
        const c = svgEl('circle', { class: 'site', cx: String(xy[0]), cy: String(xy[1]), r: '5' });
        const label = svgEl('text', { class: 'site-label', x: String(xy[0] + 8), y: String(xy[1] + 4) });
        label.textContent = site.name;
        g.append(c, label);
      }
      gSites.append(g);
    }
    renderLegend(breaks, s.measure);
  }

  /** Data counties behind an area key (a merged area has several). */
  function areaCounties(d: DemandData, fips: string): CountyDemand[] {
    const ms = areaMembers.get(fips);
    return ms ? d.counties.filter((c) => ms.includes(c.fips)) : d.counties.filter((c) => c.fips === fips);
  }

  return { render, areaCounties };
}
