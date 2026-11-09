// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { lineChart } from '../../src/ui/chart';

const OPTS = { width: 300, height: 120 };
const pts = (values: (number | null)[]) =>
  values.map((value, i) => ({ month: `2024-${String(i + 1).padStart(2, '0')}`, value }));

test('draws one line segment for unbroken data', () => {
  const svg = lineChart(pts([1, 2, 3, 4]), OPTS);
  expect(svg.querySelectorAll('path.line')).toHaveLength(1);
});

test('breaks the line at missing values', () => {
  const svg = lineChart(pts([1, 2, null, 4, 5]), OPTS);
  expect(svg.querySelectorAll('path.line')).toHaveLength(2);
});

test('an isolated point between gaps is drawn as a dot', () => {
  const svg = lineChart(pts([1, 2, null, 4, null, 6, 7]), OPTS);
  expect(svg.querySelectorAll('path.line')).toHaveLength(2);
  expect(svg.querySelectorAll('circle.point')).toHaveLength(1);
});

test('draws no line when every value is missing', () => {
  const svg = lineChart(pts([null, null, null]), OPTS);
  expect(svg.querySelectorAll('path.line')).toHaveLength(0);
  expect(svg.textContent).toContain('no data');
});

test('marks tariff events inside the range only', () => {
  const svg = lineChart(pts([1, 2, 3, 4]), {
    ...OPTS,
    events: [
      { date: '2024-02-15', label: 'in range', url: 'https://example.com' },
      { date: '2019-03-23', label: 'before', url: 'https://example.com' },
      { date: '2030-01-01', label: 'after', url: 'https://example.com' },
    ],
  });
  expect(svg.querySelectorAll('.event')).toHaveLength(1);
});

test('marks the current month when it is in range', () => {
  const svg = lineChart(pts([1, 2, 3]), { ...OPTS, current: '2024-02' });
  expect(svg.querySelectorAll('.current')).toHaveLength(1);
  expect(lineChart(pts([1, 2, 3]), { ...OPTS, current: '2031-02' }).querySelectorAll('.current')).toHaveLength(0);
});
