export type Tab = 'supply' | 'customers';

const TABS: { id: Tab; label: string; panel: string }[] = [
  { id: 'supply', label: 'Supply', panel: 'map' },
  { id: 'customers', label: 'Customers', panel: 'customers' },
];

export function readTab(search: string): Tab {
  return new URLSearchParams(search).get('tab') === 'customers' ? 'customers' : 'supply';
}

export function mountTabs(el: HTMLElement, onChange: (t: Tab) => void): void {
  el.setAttribute('role', 'tablist');
  const buttons = new Map<Tab, HTMLButtonElement>();
  const select = (tab: Tab) => {
    for (const [id, b] of buttons) {
      b.setAttribute('aria-selected', String(id === tab));
      b.tabIndex = id === tab ? 0 : -1;
    }
  };
  const activate = (t: Tab) => {
    select(t);
    const url = new URL(window.location.href);
    if (t === 'customers') url.searchParams.set('tab', 'customers');
    else url.searchParams.delete('tab');
    window.history.replaceState(null, '', url);
    onChange(t);
  };
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.testid = `tab-${t.id}`;
    b.id = `tabbtn-${t.id}`;
    b.setAttribute('aria-controls', t.panel);
    b.textContent = t.label;
    b.addEventListener('click', () => activate(t.id));
    b.addEventListener('keydown', (ev) => {
      const i = TABS.findIndex((x) => x.id === t.id);
      const next =
        ev.key === 'ArrowRight' ? (i + 1) % TABS.length
        : ev.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length
        : ev.key === 'Home' ? 0
        : ev.key === 'End' ? TABS.length - 1
        : -1;
      if (next < 0) return;
      ev.preventDefault();
      buttons.get(TABS[next].id)!.focus();
      activate(TABS[next].id);
    });
    buttons.set(t.id, b);
    el.append(b);
  }
  select(readTab(window.location.search));
}
