import type { DemandData, IndustryGroup, Place, Site } from '../../shared/demand';
import { INDUSTRY_GROUPS } from '../../shared/demand';
import { loadPlaces } from './load';
import { miles, type DemandMeasure } from './query';
import { searchPlaces } from './sites';
import type { CustomerState } from './usmap';

export const MEASURE_LABELS: Record<DemandMeasure, string> = { emp: 'Employees', estab: 'Establishments' };

export interface ControlHandlers {
  onGroups(groups: IndustryGroup[]): void;
  onMeasure(m: DemandMeasure): void;
  onAddSite(site: Site): void;
  onRemoveSite(index: number): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { 'data-testid'?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'data-testid') e.dataset.testid = v as string;
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  e.append(...kids);
  return e;
}

const siteName = (p: Place) => `${p[0]}, ${p[1]}`;

export function nearestPlace(places: Place[], lonLat: [number, number]): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const p of places) {
    const d = miles(lonLat, [p[3], p[2]]);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function mountCustomerControls(el: HTMLElement, d: DemandData, handlers: ControlHandlers) {
  el.classList.add('customer-controls');
  let state: CustomerState | null = null;
  let placing = false;
  let places: Place[] | null = null;
  let placesPromise: Promise<Place[]> | null = null;
  const ensurePlaces = (): Promise<Place[]> => {
    placesPromise ??= loadPlaces().then(
      (p) => (places = p),
      (err: Error) => {
        placesPromise = null;
        status.textContent = err.message;
        throw err;
      },
    );
    return placesPromise;
  };

  // Industry groups
  const boxes = new Map<IndustryGroup, HTMLInputElement>();
  const groupSet = h('fieldset', { className: 'group-set' }, h('legend', {}, 'Industries'));
  for (const g of INDUSTRY_GROUPS) {
    const input = h('input', { type: 'checkbox', checked: true, 'data-testid': `group-${g}` });
    input.addEventListener('change', () =>
      handlers.onGroups(INDUSTRY_GROUPS.filter((x) => boxes.get(x)!.checked)),
    );
    boxes.set(g, input);
    groupSet.append(h('label', { className: 'check' }, input, d.groups.find((x) => x.id === g)?.label ?? g));
  }

  // Measure
  const measureSet = h('fieldset', { className: 'measure-set' }, h('legend', {}, 'Measure'));
  const radios = new Map<DemandMeasure, HTMLInputElement>();
  for (const m of ['emp', 'estab'] as DemandMeasure[]) {
    const r = h('input', { type: 'radio', name: 'demand-measure', value: m, 'data-testid': `measure-${m}` });
    r.addEventListener('change', () => r.checked && handlers.onMeasure(m));
    radios.set(m, r);
    measureSet.append(h('label', { className: 'check' }, r, MEASURE_LABELS[m]));
  }

  // Add a site: search box with suggestions
  const status = h('span', { className: 'site-status', role: 'status' });
  const input = h('input', { type: 'text', placeholder: 'Add a site: type a place name', autocomplete: 'off', 'data-testid': 'site-input' });
  input.setAttribute('aria-label', 'Add a site');
  const list = h('ul', { className: 'suggestions', role: 'listbox', hidden: true });
  let hits: Place[] = [];
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const showHits = () => {
    list.replaceChildren(
      ...hits.map((p, i) => {
        const li = h('li', { role: 'option', className: i === active ? 'active' : '' }, siteName(p));
        li.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          pick(p);
        });
        return li;
      }),
    );
    list.hidden = hits.length === 0;
  };
  const pick = (p: Place) => {
    handlers.onAddSite({ name: siteName(p), lat: p[2], lon: p[3] });
    input.value = '';
    hits = [];
    showHits();
  };
  const search = async () => {
    try {
      const all = places ?? (await ensurePlaces());
      hits = searchPlaces(all, input.value);
      active = 0;
      showHits();
    } catch {
      // status already shows the error
    }
  };
  input.addEventListener('focus', () => void ensurePlaces().catch(() => {}));
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 120);
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (hits.length) active = (active + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      showHits();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      clearTimeout(timer);
      void (async () => {
        await search();
        if (hits[active]) pick(hits[active]);
      })();
    } else if (ev.key === 'Escape') {
      hits = [];
      showHits();
    }
  });
  input.addEventListener('blur', () => {
    hits = [];
    showHits();
  });

  const pickBtn = h('button', { type: 'button', className: 'pick-map', 'data-testid': 'pick-on-map' }, 'Pick on map');
  pickBtn.addEventListener('click', () => {
    placing = !placing;
    pickBtn.setAttribute('aria-pressed', String(placing));
    status.textContent = placing ? 'Click the map to place a site.' : '';
  });
  pickBtn.setAttribute('aria-pressed', 'false');

  const addBox = h('div', { className: 'add-site' }, h('label', {}, h('span', {}, 'Sites'), input), list, pickBtn, status);

  // Naming a clicked point
  const nameForm = h('form', { className: 'name-site', hidden: true, 'data-testid': 'name-site' });
  const nameInput = h('input', { type: 'text', 'data-testid': 'name-site-input' });
  nameInput.setAttribute('aria-label', 'Name this site');
  const addBtn = h('button', { type: 'submit' }, 'Add');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  nameForm.append(h('span', {}, 'Name this site'), nameInput, addBtn, cancel);
  let pending: [number, number] | null = null;
  const closeName = () => {
    pending = null;
    nameForm.hidden = true;
  };
  nameForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = nameInput.value.trim();
    if (pending && name) handlers.onAddSite({ name, lat: pending[1], lon: pending[0] });
    closeName();
  });
  cancel.addEventListener('click', closeName);
  nameForm.addEventListener('keydown', (ev) => ev.key === 'Escape' && closeName());

  const chips = h('ul', { className: 'chips', 'data-testid': 'site-chips' });
  el.append(groupSet, measureSet, addBox, nameForm, chips);

  function update(s: CustomerState): void {
    state = s;
    for (const [g, b] of boxes) b.checked = s.groups.includes(g);
    for (const [m, r] of radios) r.checked = s.measure === m;
    chips.replaceChildren(
      ...s.sites.map((site, i) => {
        const rm = h('button', { type: 'button' }, '×');
        rm.setAttribute('aria-label', `Remove ${site.name}`);
        rm.addEventListener('click', () => handlers.onRemoveSite(i));
        return h('li', { className: 'chip' }, site.name, rm);
      }),
    );
  }

  /** Called after a map click: offer the nearest place's name. */
  async function promptName(lonLat: [number, number]): Promise<void> {
    placing = false;
    pickBtn.setAttribute('aria-pressed', 'false');
    status.textContent = '';
    pending = lonLat;
    nameInput.value = '';
    nameForm.hidden = false;
    nameInput.focus();
    try {
      const near = nearestPlace(await ensurePlaces(), lonLat);
      if (near && pending === lonLat && !nameInput.value) {
        nameInput.value = siteName(near);
        nameInput.select();
      }
    } catch {
      // place names unavailable; the user types one
    }
  }

  return { update, promptName, isPlacing: () => placing, get state() { return state; } };
}
