import type { DomesticData } from '../../shared/demand';
import type { ProductGroup } from '../../shared/types';
import { importShare, importShareSeries } from '../data/domestic';
import { h } from './dom';
import { PRODUCT_LABELS, formatShare } from './format';

export type DomesticState = DomesticData | 'loading' | 'error';

const NS = 'http://www.w3.org/2000/svg';
const W = 320;
const H = 110;
const PAD = { top: 16, right: 8, bottom: 18, left: 8 };

function svg(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Small yearly bar chart; neutral gray, since supply has no direction. */
export function shareBars(series: { year: number; share: number | null }[]): SVGSVGElement {
  const root = svg('svg', {
    class: 'chart share-bars', viewBox: `0 0 ${W} ${H}`, width: W, height: H,
    role: 'img', 'aria-label': 'Import share of US supply by year',
  }) as SVGSVGElement;
  const max = Math.max(0.01, ...series.map((p) => p.share ?? 0));
  const slot = (W - PAD.left - PAD.right) / Math.max(1, series.length);
  const barW = slot * 0.6;
  const base = H - PAD.bottom;
  series.forEach((p, i) => {
    const x = PAD.left + i * slot + (slot - barW) / 2;
    const cx = x + barW / 2;
    if (p.share !== null) {
      const bh = Math.max(1, (p.share / max) * (base - PAD.top));
      root.append(
        svg('rect', { class: 'share-bar', x, y: base - bh, width: barW, height: bh }),
        svg('text', { x: cx, y: base - bh - 3, 'text-anchor': 'middle' }, formatShare(p.share)));
    } else {
      root.append(svg('text', { x: cx, y: base - 3, 'text-anchor': 'middle' }, 'no data'));
    }
    root.append(svg('text', { x: cx, y: H - 4, 'text-anchor': 'middle' }, String(p.year)));
  });
  root.append(svg('line', { class: 'chart-axis', x1: PAD.left, x2: W - PAD.right, y1: base, y2: base }));
  return root;
}

const BASIS = 'By value, calendar years. US mill data ends in 2016.';

function body(dom: DomesticData, product: ProductGroup | 'all'): (Node | false)[] {
  const last = dom.years[dom.years.length - 1];
  if (product === 'all') {
    const rows = (Object.keys(dom.products) as ProductGroup[]).map((g) =>
      h('tr', {},
        h('th', { scope: 'row' }, PRODUCT_LABELS[g]),
        h('td', {}, formatShare(importShare(dom, g, last)))));
    return [
      h('p', {}, `US supply, ${last}: imports by product`),
      h('table', { class: 'share-table' }, h('tbody', {}, ...rows)),
      h('p', { class: 'basis' }, BASIS),
    ];
  }
  const p = dom.products[product];
  if (!p) {
    return [
      h('p', {}, 'No domestic match for this product, so no import share.'),
      h('p', { class: 'basis' }, BASIS),
    ];
  }
  const share = importShare(dom, product, last);
  return [
    h('p', {}, `US supply, ${last}: imports `,
      h('strong', { class: 'share-value', 'data-testid': 'import-share-value' }, formatShare(share))),
    shareBars(importShareSeries(dom, product)),
    !!p.note && h('p', { class: 'basis' }, p.note),
    h('p', { class: 'basis' }, BASIS),
  ];
}

export function importShareCard(state: DomesticState, product: ProductGroup | 'all'): HTMLElement {
  const content: (Node | false)[] =
    state === 'error' ? [h('p', { class: 'empty' }, 'Domestic data could not be loaded')]
      : state === 'loading' ? [h('p', { class: 'empty' }, 'Loading domestic data…')]
        : body(state, product);
  return h('section', { class: 'import-share', 'data-testid': 'import-share' },
    h('h3', {}, 'Import share of US supply'),
    ...content);
}
