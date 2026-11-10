import type { DemandData, IndustryGroup, Site } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import { mountCustomerControls } from './controls';
import { mountCustomerPanel } from './panel';
import { encodeSites, loadSites, saveSites } from './sites';
import { createUsMap, type CustomerState, type UsShapes } from './usmap';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Builds the Customers tab UI into `root`; state lives here, views are pure renders. */
export function mountCustomers(root: HTMLElement, d: DemandData, shapes: UsShapes): void {
  root.className = 'customers';
  root.dataset.testid = 'customers-ready';
  const controlsEl = document.createElement('div');
  const mapEl = document.createElement('div');
  mapEl.className = 'customers-map';
  const panelEl = document.createElement('aside');
  root.replaceChildren(controlsEl, mapEl, panelEl);

  let s: CustomerState = {
    groups: [...INDUSTRY_GROUPS],
    measure: 'emp',
    sites: [...loadSites(window.location.search, storage())],
    county: null,
  };

  const writeUrl = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('sites', encodeSites(s.sites));
    window.history.replaceState(null, '', url);
  };
  const siteKey = (x: Site): string => `${x.name}@${encodeSites([{ ...x, name: '' }])}`;

  const set = (patch: Partial<CustomerState>): void => {
    s = { ...s, ...patch };
    if (patch.sites) {
      saveSites(s.sites, storage());
      writeUrl();
    }
    draw();
  };

  const controls = mountCustomerControls(controlsEl, d, {
    onGroups: (groups: IndustryGroup[]) => set({ groups }),
    onMeasure: (measure) => set({ measure }),
    onAddSite: (site: Site) => {
      if (s.sites.some((x) => siteKey(x) === siteKey(site))) return;
      set({ sites: [...s.sites, site] });
    },
    onRemoveSite: (i) => set({ sites: s.sites.filter((_, j) => j !== i) }),
  });
  const map = createUsMap(mapEl, {
    shapes,
    placing: () => controls.isPlacing(),
    onCounty: (fips) => set({ county: fips === s.county ? null : fips }),
    onMapClick: (ll) => void controls.promptName(ll),
  });
  const panel = mountCustomerPanel(panelEl, { onCounty: (county) => set({ county }), areaCounties: (dd, f) => map.areaCounties(dd, f) });

  function draw(): void {
    controls.update(s);
    map.render(d, s);
    panel.render(d, s);
  }
  writeUrl();
  draw();
}
