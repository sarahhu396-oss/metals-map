import type { Selection } from '../../shared/types';
import type { Dataset } from '../data/load';
import {
  concentration, dutyRate, productMix, rankings, timeSeries, yoyChange,
} from '../data/query';
import type { Store } from '../state';
import { lineChart } from './chart';
import { h } from './dom';
import {
  DIRECTION_LABELS, MEASURE_LABELS, PRODUCT_LABELS,
  formatChange, formatMeasure, formatMonth, formatShare,
} from './format';

const CHART = { width: 320, height: 110 };
const TOP_N = 15;

function countryName(ds: Dataset, cty: string): string {
  return ds.countries.get(cty)?.name ?? `Country ${cty}`;
}

function heading(sel: Selection): string {
  const period = sel.window === 't12' ? `12 months to ${formatMonth(sel.month)}` : formatMonth(sel.month);
  return `${PRODUCT_LABELS[sel.product]} · ${DIRECTION_LABELS[sel.direction]} · ${period}`;
}

function stat(label: string, value: string, testid?: string): HTMLElement {
  return h('div', { class: 'stat', ...(testid ? { 'data-testid': testid } : {}) },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value));
}

function chartBlock(title: string, chart: SVGSVGElement): HTMLElement {
  return h('section', { class: 'chart-block' }, h('h3', {}, title), chart);
}

function overview(ds: Dataset, sel: Selection, store: Store): (Node | false)[] {
  const ranked = rankings(ds, sel);
  if (ranked.length === 0) {
    return [h('p', { class: 'empty', 'data-testid': 'empty' }, 'No trade recorded for this selection.')];
  }
  const fmt = (v: number | null) => formatMeasure(v, sel.measure);
  const series = timeSeries(ds, sel);
  const total = series.find((p) => p.month === sel.month)?.value ?? null;
  const top3 = concentration(ranked);
  const maxValue = ranked[0].value ?? 0;

  const rows = ranked.slice(0, TOP_N).map((r, i) => {
    const width = r.value !== null && maxValue > 0 ? Math.max(1, (r.value / maxValue) * 100) : 0;
    return h('li', {},
      h('button', {
        type: 'button', class: 'rank-row', 'data-testid': `rank-${i + 1}`,
        onClick: () => store.set({ country: r.cty }),
      },
        h('span', { class: 'rank-name' }, countryName(ds, r.cty)),
        h('span', { class: 'rank-value' }, fmt(r.value)),
        h('span', { class: 'rank-share' }, sel.measure === 'price' ? '' : formatShare(r.share)),
        h('span', { class: 'rank-bar', style: `width:${width}%` })));
  });

  return [
    h('div', { class: 'stats' },
      stat(sel.measure === 'price' ? 'Average price' : `Total ${MEASURE_LABELS[sel.measure].toLowerCase()}`, fmt(total), 'total'),
      stat('Top 3 share', formatShare(top3), 'concentration'),
      stat('Change vs year earlier', formatChange(yoyChange(ds, sel)), 'yoy'),
      stat('Partner countries', String(ranked.length))),
    chartBlock(`${MEASURE_LABELS[sel.measure]} over time`,
      lineChart(series, { ...CHART, events: ds.events, current: sel.month, format: fmt })),
    h('section', {},
      h('h3', {}, ranked.length > TOP_N ? `Top ${TOP_N} of ${ranked.length} partners` : 'Partners'),
      h('ol', { class: 'ranking' }, ...rows)),
  ];
}

function country(ds: Dataset, sel: Selection, store: Store, cty: string): (Node | false)[] {
  const fmt = (v: number | null) => formatMeasure(v, sel.measure);
  const series = timeSeries(ds, sel, cty);
  const current = series.find((p) => p.month === sel.month)?.value ?? null;
  const ranked = rankings(ds, sel);
  const rank = ranked.findIndex((r) => r.cty === cty);
  const share = rank >= 0 ? ranked[rank].share : null;

  const priceSel: Selection = { ...sel, measure: 'price', direction: sel.direction === 'both' ? 'imports' : sel.direction };
  const priceSeries = timeSeries(ds, priceSel, cty);
  const mix = productMix(ds, sel, cty);
  const mixMax = Math.max(0, ...mix.map((m) => m.value ?? 0));

  return [
    h('button', { type: 'button', class: 'back', 'data-testid': 'back', onClick: () => store.set({ country: null }) },
      '← All countries'),
    h('h2', { 'data-testid': 'country-name' }, countryName(ds, cty)),
    h('div', { class: 'stats' },
      stat(MEASURE_LABELS[sel.measure], fmt(current), 'country-value'),
      stat('Share · rank', rank >= 0 && sel.measure !== 'price' ? `${formatShare(share)} · #${rank + 1}` : '—'),
      stat('Change vs year earlier', formatChange(yoyChange(ds, sel, cty))),
      stat('Effective duty rate (imports)', formatShare(dutyRate(ds, sel, cty)), 'duty-rate')),
    chartBlock(`${MEASURE_LABELS[sel.measure]} over time`,
      lineChart(series, { ...CHART, events: ds.events, current: sel.month, format: fmt })),
    sel.measure !== 'price' && chartBlock(
      `Price per tonne (${DIRECTION_LABELS[priceSel.direction].toLowerCase()})`,
      lineChart(priceSeries, {
        ...CHART, events: ds.events, current: sel.month,
        format: (v) => formatMeasure(v, 'price'),
      })),
    h('section', {},
      h('h3', {}, 'Product mix'),
      h('ul', { class: 'mix' }, ...mix.map((m) =>
        h('li', {},
          h('span', { class: 'rank-name' }, PRODUCT_LABELS[m.group]),
          h('span', { class: 'rank-value' }, fmt(m.value)),
          h('span', {
            class: 'rank-bar',
            style: `width:${m.value !== null && mixMax > 0 && sel.measure !== 'price' ? (m.value / mixMax) * 100 : 0}%`,
          }))))),
  ];
}

export function mountPanel(el: HTMLElement, store: Store, ds: Dataset): void {
  el.dataset.testid = 'panel';
  const render = (sel: Selection) => {
    el.replaceChildren(
      h('header', {},
        h('h1', {}, 'US aluminum trade'),
        h('p', { class: 'subhead' }, heading(sel))),
      ...(sel.country === null ? overview(ds, sel, store) : country(ds, sel, store, sel.country)),
      h('footer', {},
        h('p', {}, `Data through ${formatMonth(ds.meta.latestMonth)}. ${ds.meta.source}`),
        ds.events.length > 0 && h('details', {},
          h('summary', {}, 'Tariff events marked on charts'),
          h('ul', {}, ...ds.events.map((ev) =>
            h('li', {}, `${ev.date} — `, h('a', { href: ev.url, target: '_blank', rel: 'noopener' }, ev.label)))))),
    );
  };
  store.subscribe(render);
  render(store.get());
}
