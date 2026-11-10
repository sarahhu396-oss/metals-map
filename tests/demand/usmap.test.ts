// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { CountyDemand, DemandData, IndustryGroup } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import { createUsMap, ctMerged, type UsShapes } from '../../src/demand/usmap';

function zero<T>(v: T): Record<IndustryGroup, T> {
  return Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, v])) as Record<IndustryGroup, T>;
}
function county(fips: string, name: string, lat: number, lon: number, emp: number | null, estab = 1): CountyDemand {
  return { fips, name, lat, lon, estab: zero(estab), emp: zero<number | null>(emp) };
}
function rect(id: string, lon: number, lat: number, w = 0.4, h = 0.4): Feature<Polygon> {
  return {
    type: 'Feature',
    id,
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat]]],
    },
  };
}
function demand(counties: CountyDemand[]): DemandData {
  return { year: 2023, groups: INDUSTRY_GROUPS.map((id) => ({ id, label: id, add: [], subtract: [] })), counties,
    usTotals: Object.fromEntries(INDUSTRY_GROUPS.map((g) => [g, { estab: 1, emp: 1 }])) as DemandData['usTotals'] };
}
const noop = { onCounty() {}, onMapClick() {} };
const state = (over = {}) => ({ groups: [...INDUSTRY_GROUPS], measure: 'emp' as const, sites: [], county: null, ...over });

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.replaceChildren(el);
});

test('renders a path per shape, a site marker and three dashed rings', () => {
  const shapes: UsShapes = {
    counties: [rect('26163', -83.4, 42.1), rect('26125', -83.4, 42.6)],
    borders: null,
  };
  const d = demand([county('26163', 'Wayne County, Michigan', 42.3, -83.2, 500), county('26125', 'Oakland County, Michigan', 42.8, -83.2, null)]);
  const map = createUsMap(el, { ...noop, shapes });
  map.render(d, state({ sites: [{ name: 'Detroit, MI', lat: 42.38, lon: -83.1 }] }));
  expect(el.querySelectorAll('path.county')).toHaveLength(2);
  expect(el.querySelectorAll('circle.site')).toHaveLength(1);
  const rings = [...el.querySelectorAll('path.ring')];
  expect(rings.map((r) => r.getAttribute('data-mi'))).toEqual(['150', '300', '500']);
  expect(el.querySelector('path.county[data-fips="26125"]')!.classList.contains('withheld')).toBe(true);
  expect(el.querySelector('path.county[data-fips="26163"]')!.classList.contains('withheld')).toBe(false);
});

test('Connecticut shapes merge into one area titled as a state total', () => {
  const shapes: UsShapes = { counties: [rect('09001', -73.4, 41.2), rect('09003', -72.8, 41.6), rect('26163', -83.4, 42.1)], borders: null };
  const ct = ['09110', '09120', '09130', '09140', '09150', '09160', '09170', '09180', '09190'].map((f, i) =>
    county(f, `Region ${i}, Connecticut`, 41.5, -72.7, 10),
  );
  const d = demand([...ct, county('26163', 'Wayne County, Michigan', 42.3, -83.2, 5)]);
  const map = createUsMap(el, { ...noop, shapes });
  map.render(d, state());
  const cts = [...el.querySelectorAll('path.county[data-fips="09"]')];
  expect(cts).toHaveLength(2);
  expect(cts[0].querySelector('title')!.textContent).toContain('state total');
  expect(cts[0].querySelector('title')!.textContent).toContain('720');
});

test('shapes with no data are marked, not hidden', () => {
  const shapes: UsShapes = { counties: [rect('26163', -83.4, 42.1), rect('99999', -100, 40)], borders: null };
  const map = createUsMap(el, { ...noop, shapes });
  map.render(demand([county('26163', 'Wayne County, Michigan', 42.3, -83.2, 5)]), state());
  const p = el.querySelector('path.county[data-fips="99999"]')!;
  expect(p.classList.contains('nodata')).toBe(true);
  expect(p.querySelector('title')!.textContent).toContain('No data');
});

test('ctMerged sums the nine planning regions and withholds if any is null', () => {
  const regions = ['09110', '09120', '09130', '09140', '09150', '09160', '09170', '09180', '09190'];
  const ct = regions.map((f, i) => county(f, `R${i}, Connecticut`, 41.5, -72.7, i + 1));
  const d = demand([...ct, county('26163', 'Wayne County, Michigan', 42.3, -83.2, 5)]);
  const m = ctMerged(d);
  expect(m.get('09')).toBe(360);
  expect(m.get('26163')).toBe(40);
  expect(m.has('09110')).toBe(false);
  ct[3].emp.aero = null;
  expect(ctMerged(demand([...ct])).get('09')).toBeNull();
});

test('selected county is outlined and onCounty fires on click', () => {
  const shapes: UsShapes = { counties: [rect('26163', -83.4, 42.1)], borders: null };
  const hits: (string | null)[] = [];
  const map = createUsMap(el, { ...noop, shapes, onCounty: (f) => hits.push(f) });
  map.render(demand([county('26163', 'Wayne County, Michigan', 42.3, -83.2, 5)]), state({ county: '26163' }));
  const p = el.querySelector('path.county[data-fips="26163"]')!;
  expect(p.classList.contains('selected')).toBe(true);
  p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(hits).toEqual(['26163']);
});
