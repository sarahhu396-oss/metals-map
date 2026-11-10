// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { mountTabs, readTab } from '../src/tabs';

test('readTab picks customers from the query string', () => {
  expect(readTab('?tab=customers')).toBe('customers');
  expect(readTab('?a=1&tab=customers')).toBe('customers');
});

test('readTab defaults to supply', () => {
  expect(readTab('')).toBe('supply');
  expect(readTab('?tab=nope')).toBe('supply');
});

function bar(): HTMLElement {
  document.body.innerHTML = '<div id="tabs"></div>';
  return document.getElementById('tabs')!;
}

test('mountTabs renders two tabs and reflects the URL tab', () => {
  window.history.replaceState(null, '', '/?tab=customers');
  const el = bar();
  mountTabs(el, () => {});
  expect(el.getAttribute('role')).toBe('tablist');
  expect(el.querySelector('[data-testid="tab-customers"]')!.getAttribute('aria-selected')).toBe('true');
  expect(el.querySelector('[data-testid="tab-supply"]')!.getAttribute('aria-selected')).toBe('false');
});

test('clicking a tab notifies and updates the URL, keeping other params', () => {
  window.history.replaceState(null, '', '/?x=1');
  const el = bar();
  const seen: string[] = [];
  mountTabs(el, (t) => seen.push(t));
  (el.querySelector('[data-testid="tab-customers"]') as HTMLElement).click();
  expect(seen).toEqual(['customers']);
  expect(window.location.search).toContain('x=1');
  expect(window.location.search).toContain('tab=customers');
  (el.querySelector('[data-testid="tab-supply"]') as HTMLElement).click();
  expect(window.location.search).not.toContain('tab=customers');
  expect(window.location.search).toContain('x=1');
});
