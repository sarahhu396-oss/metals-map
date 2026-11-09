import type { TariffEvent } from '../../shared/types';
import { formatMonth } from './format';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export interface ChartOptions {
  width: number;
  height: number;
  events?: TariffEvent[];
  /** Month to mark as the current selection */
  current?: string;
  /** Formats a value for the hover readout */
  format?: (v: number | null) => string;
}

/** A single-series line chart with gaps at missing values. */
export function lineChart(
  points: { month: string; value: number | null }[], opts: ChartOptions,
): SVGSVGElement {
  const { width, height } = opts;
  const format = opts.format ?? ((v) => (v === null ? 'no data' : String(v)));
  const pad = { top: 18, right: 8, bottom: 18, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', class: 'chart', role: 'img' });

  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (values.length === 0) {
    const t = el('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'chart-empty' });
    t.textContent = 'no data';
    svg.appendChild(t);
    return svg;
  }

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.left + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => pad.top + innerH - ((v - min) / span) * innerH;

  svg.appendChild(el('line', {
    x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), class: 'chart-axis',
  }));

  // Tariff events: a tick on the month they fall in
  for (const ev of opts.events ?? []) {
    const i = points.findIndex((p) => p.month === ev.date.slice(0, 7));
    if (i < 0) continue;
    const mark = el('line', { x1: x(i), x2: x(i), y1: pad.top, y2: pad.top + innerH, class: 'event' });
    const title = el('title');
    title.textContent = `${ev.date}: ${ev.label}`;
    mark.appendChild(title);
    svg.appendChild(mark);
  }

  // One path per unbroken run; a lone point becomes a dot
  let run: number[] = [];
  const flush = () => {
    if (run.length === 1) {
      const i = run[0];
      svg.appendChild(el('circle', { cx: x(i), cy: y(points[i].value!), r: 2.5, class: 'point' }));
    } else if (run.length > 1) {
      const d = run
        .map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(points[i].value!).toFixed(1)}`)
        .join('');
      svg.appendChild(el('path', { d, class: 'line', fill: 'none' }));
    }
    run = [];
  };
  points.forEach((p, i) => {
    if (p.value === null) flush();
    else run.push(i);
  });
  flush();

  const currentIndex = opts.current ? points.findIndex((p) => p.month === opts.current) : -1;
  if (currentIndex >= 0 && points[currentIndex].value !== null) {
    svg.appendChild(el('circle', {
      cx: x(currentIndex), cy: y(points[currentIndex].value!), r: 4, class: 'current',
    }));
  }

  const first = el('text', { x: pad.left, y: height - 4, class: 'chart-label' });
  first.textContent = formatMonth(points[0].month);
  const last = el('text', { x: width - pad.right, y: height - 4, 'text-anchor': 'end', class: 'chart-label' });
  last.textContent = formatMonth(points[points.length - 1].month);
  const readout = el('text', { x: pad.left, y: 11, class: 'chart-readout' });
  const resting = `max ${format(max)}`;
  readout.textContent = resting;
  svg.append(first, last, readout);

  // Hover: crosshair and a readout of the nearest month
  const cross = el('line', { y1: pad.top, y2: pad.top + innerH, class: 'crosshair', visibility: 'hidden' });
  const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent' });
  hit.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    if (box.width === 0) return;
    const px = ((e.clientX - box.left) / box.width) * width;
    const i = Math.max(0, Math.min(points.length - 1,
      Math.round(((px - pad.left) / innerW) * (points.length - 1))));
    cross.setAttribute('x1', String(x(i)));
    cross.setAttribute('x2', String(x(i)));
    cross.setAttribute('visibility', 'visible');
    readout.textContent = `${formatMonth(points[i].month)}: ${format(points[i].value)}`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    readout.textContent = resting;
  });
  svg.append(cross, hit);
  return svg;
}
