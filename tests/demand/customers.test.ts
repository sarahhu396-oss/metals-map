// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { CountyDemand, DemandData, IndustryGroup, Place } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import { mountCustomers } from '../../src/demand/customers';
import { mountCustomerControls } from '../../src/demand/controls';
import { mountCustomerPanel } from '../../src/demand/panel';
import { createUsMap } from '../../src/demand/usmap';

vi.mock('../../src/demand/load', () => ({
  loadPlaces: async (): Promise<Place[]> => [
    ['Springfield A', 'IL', 39.8, -89.6, 300],
    ['Springfield B', 'MO', 37.2, -93.3, 200],
    ['Springfield C', 'MA', 42.1, -72.6, 100],
  ],
}));

function zero<T>(v: T): Record<IndustryGroup, T> {
  return Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, v])) as Record<IndustryGroup, T>;
}
const c: CountyDemand = { fips: '26163', name: 'Wayne County, Michigan', lat: 42.3, lon: -83.2, estab: zero(2), emp: zero<number | null>(10) };
const d: DemandData = {
  year: 2023, groups: INDUSTRY_GROUPS.map((id) => ({ id, label: id, add: [], subtract: [] })), counties: [c],
  usTotals: Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, { estab: 8, emp: 40 }])) as DemandData['usTotals'],
};
const site = { name: 'Detroit, MI', lat: 42.38, lon: -83.1 };

beforeEach(() => { document.body.replaceChildren(); });

test('no groups selected: empty-state message, no top list, no NaN, map lightest', () => {
  const el = document.createElement('div');
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render(d, { groups: [], measure: 'emp', sites: [site], county: null });
  expect(el.textContent).toContain('Select at least one industry');
  expect(el.querySelector('.ranking')).toBeNull();
  expect(el.querySelector('[data-testid=site-card]')).toBeNull();
  expect(el.textContent).not.toContain('NaN');
  const m = document.createElement('div');
  const shapes = { counties: [{ type: 'Feature' as const, id: '26163', properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[-83.4, 42.1], [-83, 42.1], [-83, 42.5], [-83.4, 42.1]]] } }], borders: null };
  createUsMap(m, { shapes, onCounty() {}, onMapClick() {} }).render(d, { groups: [], measure: 'emp', sites: [], county: null });
  expect(m.querySelector('path.county')!.getAttribute('fill')).toBe('#f1f1ef');
});

test('site cards show employees and establishments for every ring', () => {
  const el = document.createElement('div');
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render(d, { groups: [...INDUSTRY_GROUPS], measure: 'estab', sites: [site], county: null });
  const rows = [...el.querySelectorAll('[data-testid=site-card] .amount-row')];
  expect(rows).toHaveLength(4);
  expect(rows[0].textContent).toContain('80 employees');
  expect(rows[0].textContent).toContain('16 establishments');
});

test('Enter adds the suggestion chosen with the arrow keys', async () => {
  const el = document.createElement('div');
  document.body.append(el);
  const added: string[] = [];
  mountCustomerControls(el, d, { onGroups() {}, onMeasure() {}, onAddSite: (s) => added.push(s.name), onRemoveSite() {} });
  const input = el.querySelector<HTMLInputElement>('[data-testid=site-input]')!;
  input.value = 'springfield';
  input.dispatchEvent(new Event('input'));
  await new Promise((r) => setTimeout(r, 250));
  expect(el.querySelectorAll('.suggestions li')).toHaveLength(3);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await new Promise((r) => setTimeout(r, 20));
  expect(added).toHaveLength(1);
  expect(added[0]).toBe('Springfield C, MA');
});

test('map click converts through the screen matrix, so letterboxing does not shift the point', () => {
  const m = document.createElement('div');
  const shapes = { counties: [], borders: null };
  const got: [number, number][] = [];
  createUsMap(m, { shapes, onCounty() {}, onMapClick: (ll) => got.push(ll) });
  const svg = m.querySelector('svg')! as SVGSVGElement;
  // Wide window: 975x610 viewBox drawn at scale 1 and centred with a 300px left offset.
  (svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({ a: 1, d: 1, e: -300, f: 0 }) });
  (svg as unknown as { createSVGPoint: () => unknown }).createSVGPoint = () => {
    const pt = { x: 0, y: 0, matrixTransform: (mx: { e: number; f: number }) => ({ x: pt.x + mx.e, y: pt.y + mx.f }) };
    return pt;
  };
  svg.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, clientX: 300 + 487.5, clientY: 305 }));
  expect(got).toHaveLength(1);
  expect(got[0][0]).toBeGreaterThan(-100); // near the projection centre, not stretched off
  expect(got[0][0]).toBeLessThan(-90);
});

const panelEl = () => document.createElement('div');
const all = { groups: [...INDUSTRY_GROUPS], measure: 'emp' as const, sites: [site], county: null };

test('overview explains omitted cells as a lower bound and shows national coverage', () => {
  const el = panelEl();
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render(d, all);
  expect(el.textContent).toContain('Census leaves out county figures where an industry has only a few establishments, including some large plants, so county and ring totals are lower bounds.');
  expect(el.textContent).not.toContain('show as none');
  // 80 employees of 320 = 25.0%; 16 of 64 = 25.0%
  expect(el.querySelector('.coverage')!.textContent).toBe('Counties shown account for 25.0% of US employees (25.0% of establishments) in the selected industries.');
});

test('coverage uses only the selected industries and drops a percentage with no US total', () => {
  const el = panelEl();
  const dd: DemandData = { ...d, usTotals: { ...d.usTotals, auto: { estab: 4, emp: null }, aero: { estab: 0, emp: 20 } } };
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render(dd, { ...all, groups: ['auto'] });
  expect(el.querySelector('.coverage')!.textContent).toBe('Counties shown account for 50.0% of US establishments in the selected industries.');
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render(dd, { ...all, groups: ['aero'] });
  expect(el.querySelector('.coverage')!.textContent).toBe('Counties shown account for 50.0% of US employees in the selected industries.');
});

test('totals with withheld counties read "at least N employees (M counties withheld)"', () => {
  const w2: CountyDemand = { ...c, fips: '26099', name: 'Macomb County, Michigan', emp: zero<number | null>(null) };
  const e2 = panelEl();
  mountCustomerPanel(e2, { onCounty() {}, areaCounties: () => [] }).render({ ...d, counties: [c, { ...w2 }, { ...w2, fips: '26125' }] }, all);
  expect(e2.querySelector('.stat-value')!.textContent).toBe('at least 80 employees (2 counties withheld)');
  const w: CountyDemand = { ...c, fips: '26125', name: 'Oakland County, Michigan', emp: zero<number | null>(null) };
  const el = panelEl();
  mountCustomerPanel(el, { onCounty() {}, areaCounties: () => [] }).render({ ...d, counties: [c, w] }, all);
  expect(el.querySelector('.stat-value')!.textContent).toBe('at least 80 employees (1 county withheld)');
});

test('a merged county area is titled like the map tooltip', () => {
  const mk = (fips: string, name: string): CountyDemand => ({ ...c, fips, name });
  const render = (cs: CountyDemand[], county: string) => {
    const el = panelEl();
    mountCustomerPanel(el, { onCounty() {}, areaCounties: () => cs }).render(d, { ...all, county });
    return el.querySelector('.county-detail h2')!.textContent;
  };
  expect(render([mk('09110', 'Capitol Planning Region, Connecticut'), mk('09120', 'Greater Bridgeport Planning Region, Connecticut')], '09')).toBe('Connecticut: state total');
  expect(render([mk('02063', 'Chugach Census Area, Alaska'), mk('02066', 'Copper River Census Area, Alaska')], '02261')).toBe('Chugach Census Area + Copper River Census Area, Alaska (combined)');
  expect(render([c], '26163')).toBe('Wayne County, Michigan');
});

async function mountOn(search: string) {
  window.history.replaceState(null, '', `/${search}`);
  const root = document.createElement('div');
  document.body.append(root);
  mountCustomers(root, d, { counties: [], borders: null });
  return root;
}

test('mounting writes the site list to the URL and keeps other params', async () => {
  await mountOn('?tab=customers');
  const p = new URLSearchParams(window.location.search);
  expect(p.get('tab')).toBe('customers');
  expect(p.get('sites')).toBe('Detroit, MI@42.383,-83.1022');
});

test('mounting keeps an existing sites param as it is', async () => {
  await mountOn('?tab=customers&sites=Gary%2C%20IN@41.5933,-87.3464');
  expect(new URLSearchParams(window.location.search).get('sites')).toBe('Gary, IN@41.5933,-87.3464');
});

test('onAddSite ignores a site equal to an existing one after 4-decimal rounding', async () => {
  const root = await mountOn('?tab=customers&sites=Gary%2C%20IN@41.5933,-87.3464');
  const input = root.querySelector<HTMLInputElement>('[data-testid=site-input]')!;
  const add = async (q: string) => {
    input.value = q;
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 250));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((r) => setTimeout(r, 20));
  };
  await add('springfield');
  expect(root.querySelectorAll('.chip')).toHaveLength(2);
  await add('springfield');
  expect(root.querySelectorAll('.chip')).toHaveLength(2);
});
