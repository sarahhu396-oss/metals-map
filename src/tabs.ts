export type Tab = 'supply' | 'customers';

const TABS: { id: Tab; label: string }[] = [
  { id: 'supply', label: 'Supply' },
  { id: 'customers', label: 'Customers' },
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
  for (const t of TABS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.testid = `tab-${t.id}`;
    b.textContent = t.label;
    b.addEventListener('click', () => {
      select(t.id);
      const url = new URL(window.location.href);
      if (t.id === 'customers') url.searchParams.set('tab', 'customers');
      else url.searchParams.delete('tab');
      window.history.replaceState(null, '', url);
      onChange(t.id);
    });
    buttons.set(t.id, b);
    el.append(b);
  }
  select(readTab(window.location.search));
}
