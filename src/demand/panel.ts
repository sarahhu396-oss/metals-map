import type { CountyDemand, DemandData, IndustryGroup } from '../../shared/demand';
import { MEASURE_LABELS } from './controls';
import { RINGS_MI, byGroup, countyValue, territories, topCounties, total, within, type Amount } from './query';
import { areaName, formatCount, type CustomerState } from './usmap';

export const EMPTY_NOTE = 'Select at least one industry to see customers.';
export const OMITTED_NOTE =
  'Census leaves out county figures where an industry has only a few establishments, including some large plants, so county and ring totals are lower bounds.';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...kids);
  return e;
}

/** "N noun", or "at least N noun (M counties withheld)"; with `bare` a plain number when nothing is withheld. */
function amountText(a: Amount, noun: string, bare = false): string {
  const base = formatCount(a.value);
  const m = a.withheldCounties;
  if (m > 0) return `at least ${base} ${noun} (${m} ${m === 1 ? 'county' : 'counties'} withheld)`;
  return bare ? base : `${base} ${noun}`;
}

/** Share of the US total covered, one decimal; null when the US total is missing or zero. */
function pct(part: number, whole: number | null | undefined): string | null {
  return whole ? `${((100 * part) / whole).toFixed(1)}%` : null;
}

export function coverageText(d: DemandData, groups: IndustryGroup[]): string | null {
  let usEmp = 0;
  let usEstab = 0;
  let empOk = true;
  for (const g of groups) {
    const t = d.usTotals?.[g];
    if (!t) return null;
    usEstab += t.estab;
    if (t.emp === null) empOk = false;
    else usEmp += t.emp;
  }
  const emp = empOk ? pct(total(d.counties, groups, 'emp').value, usEmp) : null;
  const estab = pct(total(d.counties, groups, 'estab').value, usEstab);
  if (!emp && !estab) return null;
  const what = emp && estab ? `${emp} of US employees (${estab} of establishments)` : emp ? `${emp} of US employees` : `${estab} of US establishments`;
  return `Counties shown account for ${what} in the selected industries.`;
}

export interface PanelOptions {
  onCounty(fips: string | null): void;
  /** Data counties behind a map area; a merged area has several */
  areaCounties(d: DemandData, fips: string): CountyDemand[];
}

export function mountCustomerPanel(el: HTMLElement, opts: PanelOptions) {
  el.classList.add('customer-panel');

  function row(label: string, cs: CountyDemand[], s: CustomerState, d: DemandData): HTMLElement {
    const det = h('details', 'amount-row');
    const sum = h('summary');
    const vals = h('span', 'row-value');
    vals.append(
      h('span', 'v-emp', amountText(total(cs, s.groups, 'emp'), 'employees')),
      h('span', 'v-estab', `${formatCount(total(cs, s.groups, 'estab').value)} establishments`),
    );
    sum.append(h('span', 'row-label', label), vals);
    det.append(sum);
    const emp = byGroup(cs, s.groups, 'emp');
    const est = byGroup(cs, s.groups, 'estab');
    const ul = h('ul', 'by-group');
    for (const g of s.groups) {
      const name = d.groups.find((x) => x.id === g)?.label ?? g;
      ul.append(h('li', '', h('span', '', name), h('span', '', `${amountText(emp[g], 'emp')} · ${formatCount(est[g].value)} estab`)));
    }
    det.append(ul);
    return det;
  }

  function coverage(d: DemandData, s: CustomerState): HTMLElement[] {
    const t = coverageText(d, s.groups as IndustryGroup[]);
    return t ? [h('p', 'note coverage', t)] : [];
  }

  function overview(d: DemandData, s: CustomerState): HTMLElement {
    const box = h('section', 'overview');
    box.append(
      h('h2', '', 'Customers'),
      h('div', 'stat-label', `${MEASURE_LABELS[s.measure]} in the selected industries, US total (${d.year})`),
      h('div', 'stat-value', amountText(total(d.counties, s.groups, s.measure), s.measure === 'emp' ? 'employees' : 'establishments', true)),
      h('p', 'note', OMITTED_NOTE),
      ...coverage(d, s),
      h('h3', '', 'Top 10 counties'),
    );
    const ol = h('ol', 'ranking');
    for (const { county, value } of topCounties(d.counties, s.groups, s.measure, 10)) {
      const b = h('button', 'rank-row');
      b.type = 'button';
      b.append(h('span', 'rank-name', county.name), h('span', 'rank-value', value === null ? 'withheld' : formatCount(value)));
      b.addEventListener('click', () => opts.onCounty(county.fips));
      ol.append(h('li', '', b));
    }
    box.append(ol);
    return box;
  }

  function siteCards(d: DemandData, s: CustomerState): HTMLElement {
    const box = h('section', 'site-cards');
    const terr = territories(d.counties, s.sites);
    s.sites.forEach((site, i) => {
      const card = h('article', 'site-card');
      card.dataset.testid = 'site-card';
      card.append(h('h3', '', site.name));
      for (const r of RINGS_MI) card.append(row(`Within ${r} mi`, within(d.counties, site, r), s, d));
      card.append(row('Territory (nearest site)', terr[i], s, d));
      box.append(card);
    });
    if (s.sites.length) box.prepend(h('h3', 'section-title', 'Employees and establishments by site'));
    return box;
  }

  function detail(d: DemandData, s: CustomerState): HTMLElement {
    const cs = opts.areaCounties(d, s.county!);
    const box = h('section', 'county-detail');
    const back = h('button', 'back', '‹ All customers');
    back.type = 'button';
    back.addEventListener('click', () => opts.onCounty(null));
    if (!cs.length) {
      box.append(back, h('p', 'empty', 'No data for this area.'));
      return box;
    }
    const merged = cs.length > 1;
    box.append(back, h('h2', '', areaName(cs, s.county!)));
    if (merged) box.append(h('p', 'note', `Sum of ${cs.length} data areas: ${cs.map((c) => c.name.split(', ')[0]).join(', ')}.`));
    const table = h('table', 'detail-table');
    const head = h('tr');
    head.append(h('th', '', 'Industry'), h('th', '', 'Establishments'), h('th', '', 'Employees'));
    table.append(head);
    const cell = (a: Amount | null, withheld: boolean) =>
      withheld ? 'withheld' : a ? formatCount(a.value) : '';
    for (const g of s.groups as IndustryGroup[]) {
      const e = byGroup(cs, [g], 'estab')[g];
      const m = byGroup(cs, [g], 'emp')[g];
      const tr = h('tr');
      tr.append(h('td', '', d.groups.find((x) => x.id === g)?.label ?? g), h('td', '', cell(e, false)), h('td', '', cell(m, m.withheldCounties > 0)));
      table.append(tr);
    }
    const tot = h('tr', 'total');
    const te = total(cs, s.groups, 'estab');
    const tm = total(cs, s.groups, 'emp');
    tot.append(h('td', '', 'Selected total'), h('td', '', formatCount(te.value)), h('td', '', tm.withheldCounties ? `${formatCount(tm.value)} + withheld` : formatCount(tm.value)));
    table.append(tot);
    box.append(table);
    if (cs.some((c) => countyValue(c, s.groups, 'emp') === null)) box.append(h('p', 'note', 'Employment is withheld for some industries in this county.'));
    return box;
  }

  function render(d: DemandData, s: CustomerState): void {
    if (!s.groups.length) {
      const msg = h('p', 'empty', EMPTY_NOTE);
      msg.dataset.testid = 'empty-selection';
      el.replaceChildren(h('h2', '', 'Customers'), msg);
      return;
    }
    el.replaceChildren(...(s.county ? [detail(d, s), siteCards(d, s)] : [overview(d, s), siteCards(d, s)]));
  }
  return { render };
}
