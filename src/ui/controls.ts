import {
  PRODUCT_GROUPS,
  type Direction, type Measure, type ProductGroup, type Selection,
} from '../../shared/types';
import type { Dataset } from '../data/load';
import type { Store } from '../state';
import { h } from './dom';
import { DIRECTION_LABELS, MEASURE_LABELS, PRODUCT_LABELS, formatMonth } from './format';

const PLAY_INTERVAL_MS = 600;

function select<T extends string>(
  testid: string, label: string, options: [T, string][], onChange: (v: T) => void,
): { root: HTMLElement; input: HTMLSelectElement } {
  const input = h('select', {
    'data-testid': testid,
    onChange: () => onChange(input.value as T),
  }, ...options.map(([value, text]) => h('option', { value }, text)));
  return { root: h('label', { class: 'control' }, h('span', {}, label), input), input };
}

export function mountControls(el: HTMLElement, store: Store, ds: Dataset): void {
  const months = ds.months;

  const product = select<ProductGroup | 'all'>(
    'product', 'Product',
    [...PRODUCT_GROUPS.map((g): [ProductGroup, string] => [g, PRODUCT_LABELS[g]]), ['all', PRODUCT_LABELS.all]],
    (v) => store.set({ product: v }),
  );
  const direction = select<Direction | 'both'>(
    'direction', 'Direction',
    (['imports', 'exports', 'both'] as const).map((d): [Direction | 'both', string] => [d, DIRECTION_LABELS[d]]),
    (v) => {
      // Price per tonne needs a single direction
      const sel = store.get();
      store.set(v === 'both' && sel.measure === 'price' ? { direction: v, measure: 'tonnes' } : { direction: v });
    },
  );
  const measure = select<Measure>(
    'measure', 'Measure',
    (['tonnes', 'value', 'price'] as const).map((m): [Measure, string] => [m, MEASURE_LABELS[m]]),
    (v) => {
      const sel = store.get();
      store.set(v === 'price' && sel.direction === 'both' ? { measure: v, direction: 'imports' } : { measure: v });
    },
  );
  const windowSel = select<Selection['window']>(
    'window', 'Period',
    [['t12', 'Trailing 12 months'], ['month', 'Single month']],
    (v) => {
      // Trailing 12 months needs 11 earlier months of history
      const sel = store.get();
      const floor = months[Math.min(11, months.length - 1)];
      store.set(v === 't12' && sel.month < floor ? { window: v, month: floor } : { window: v });
    },
  );

  let timer: number | null = null;
  const stop = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    play.textContent = 'Play';
    play.setAttribute('aria-pressed', 'false');
  };
  const play = h('button', {
    type: 'button', 'data-testid': 'play', 'aria-pressed': 'false',
    onClick: () => {
      if (timer !== null) return stop();
      // Restart from the beginning when already at the end
      if (store.get().month === months[months.length - 1]) {
        store.set({ month: months[Number(slider.min)] });
      }
      play.textContent = 'Pause';
      play.setAttribute('aria-pressed', 'true');
      timer = window.setInterval(() => {
        const i = months.indexOf(store.get().month);
        if (i < 0 || i >= months.length - 1) return stop();
        store.set({ month: months[i + 1] });
      }, PLAY_INTERVAL_MS);
    },
  }, 'Play');

  const monthLabel = h('output', { class: 'month-label', 'data-testid': 'month-label' });
  const slider = h('input', {
    type: 'range', 'data-testid': 'month', min: 0, max: Math.max(0, months.length - 1), step: 1,
    'aria-label': 'Month',
    onInput: () => store.set({ month: months[Number(slider.value)] }),
  });

  el.replaceChildren(
    product.root, direction.root, measure.root, windowSel.root,
    h('div', { class: 'control timeline' }, play, slider, monthLabel),
  );

  const sync = (sel: Selection) => {
    product.input.value = sel.product;
    direction.input.value = sel.direction;
    measure.input.value = sel.measure;
    windowSel.input.value = sel.window;
    slider.min = String(sel.window === 't12' ? Math.min(11, months.length - 1) : 0);
    slider.value = String(Math.max(0, months.indexOf(sel.month)));
    monthLabel.textContent = sel.window === 't12'
      ? `12 months to ${formatMonth(sel.month)}`
      : formatMonth(sel.month);
  };
  store.subscribe(sync);
  sync(store.get());
}
