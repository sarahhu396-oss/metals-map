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

function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

test('arrow keys, Home and End move focus and activate (wrapping)', () => {
  window.history.replaceState(null, '', '/');
  const el = bar();
  document.body.append(el);
  const seen: string[] = [];
  mountTabs(el, (t) => seen.push(t));
  const sup = el.querySelector('[data-testid="tab-supply"]') as HTMLElement;
  const cus = el.querySelector('[data-testid="tab-customers"]') as HTMLElement;
  key(sup, 'ArrowRight');
  expect(document.activeElement).toBe(cus);
  expect(cus.getAttribute('aria-selected')).toBe('true');
  key(cus, 'ArrowRight');
  expect(document.activeElement).toBe(sup);
  key(sup, 'ArrowLeft');
  expect(document.activeElement).toBe(cus);
  key(cus, 'Home');
  expect(document.activeElement).toBe(sup);
  key(sup, 'End');
  expect(document.activeElement).toBe(cus);
  expect(seen).toEqual(['customers', 'supply', 'customers', 'supply', 'customers']);
  expect(window.location.search).toContain('tab=customers');
});

test('tabs carry ids and aria-controls pointing at their panels', () => {
  const el = bar();
  mountTabs(el, () => {});
  const sup = el.querySelector('[data-testid="tab-supply"]')!;
  const cus = el.querySelector('[data-testid="tab-customers"]')!;
  expect(sup.id).toBe('tabbtn-supply');
  expect(sup.getAttribute('aria-controls')).toBe('map');
  expect(cus.id).toBe('tabbtn-customers');
  expect(cus.getAttribute('aria-controls')).toBe('customers');
});

test('index.html panels are labelled by their tabs', async () => {
  const { readFileSync } = await import('node:fs');
  document.documentElement.innerHTML = readFileSync('index.html', 'utf8');
  for (const [id, tab] of [['map', 'supply'], ['customers', 'customers']]) {
    const p = document.getElementById(id)!;
    expect(p.getAttribute('role')).toBe('tabpanel');
    expect(p.getAttribute('aria-labelledby')).toBe(`tabbtn-${tab}`);
  }
});
