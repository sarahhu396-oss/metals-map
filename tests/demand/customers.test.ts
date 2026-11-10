// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { CountyDemand, DemandData, IndustryGroup, Place } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import { mountCustomerControls } from '../../src/demand/controls';
import { mountCustomerPanel } from '../../src/demand/panel';
import { createUsMap } from '../../src/demand/usmap';

vi.mock('../../src/demand/load', () => ({
  loadPlaces: async (): Promise<Place[]> => [
    ['Springfield A', 'IL', 39.8, -89.6],
    ['Springfield B', 'MO', 37.2, -93.3],
    ['Springfield C', 'MA', 42.1, -72.6],
  ],
}));

function zero<T>(v: T): Record<IndustryGroup, T> {
  return Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, v])) as Record<IndustryGroup, T>;
}
const c: CountyDemand = { fips: '26163', name: 'Wayne County, Michigan', lat: 42.3, lon: -83.2, estab: zero(2), emp: zero<number | null>(10) };
const d: DemandData = { year: 2023, groups: INDUSTRY_GROUPS.map((id) => ({ id, label: id, add: [], subtract: [] })), counties: [c] };
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
