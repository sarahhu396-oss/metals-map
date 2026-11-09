import { expect, test } from 'vitest';
import { formatChange, formatMeasure, formatMonth, formatShare } from '../../src/ui/format';

test('tonnes are grouped integers', () => {
  expect(formatMeasure(1234.5, 'tonnes')).toBe('1,235 t');
});
test('value is abbreviated dollars', () => {
  expect(formatMeasure(1_250_000, 'value')).toBe('$1.25M');
  expect(formatMeasure(3_400_000_000, 'value')).toBe('$3.40B');
  expect(formatMeasure(45_600, 'value')).toBe('$45.6K');
  expect(formatMeasure(950, 'value')).toBe('$950');
});
test('price is dollars per tonne', () => {
  expect(formatMeasure(2875.4, 'price')).toBe('$2,875/t');
});
test('null is "no data" for every measure', () => {
  expect(formatMeasure(null, 'tonnes')).toBe('no data');
  expect(formatMeasure(null, 'value')).toBe('no data');
  expect(formatMeasure(null, 'price')).toBe('no data');
});
test('share is a percentage with one decimal', () => {
  expect(formatShare(0.123)).toBe('12.3%');
  expect(formatShare(null)).toBe('—');
});
test('change is signed', () => {
  expect(formatChange(0.2)).toBe('+20.0%');
  expect(formatChange(-0.054)).toBe('−5.4%');
  expect(formatChange(null)).toBe('—');
});
test('month is short month and year', () => {
  expect(formatMonth('2025-08')).toBe('Aug 2025');
});
