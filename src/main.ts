import './style.css';
import { loadDataset } from './data/load';
import { arcs } from './data/query';
import { createGlobe } from './map/globe';
import { createStore, defaultSelection } from './state';
import { mountControls } from './ui/controls';
import { DIRECTION_LABELS, formatMeasure } from './ui/format';
import { mountPanel } from './ui/panel';

async function start(): Promise<void> {
  const ds = await loadDataset();
  const store = createStore(defaultSelection(ds.meta.latestMonth));

  const globe = createGlobe(document.getElementById('map')!, {
    onHover: () => {},
    onSelect: (cty) => store.set({ country: cty }),
  });
  mountControls(document.getElementById('controls')!, store, ds);
  mountPanel(document.getElementById('panel')!, store, ds);

  const render = () => {
    const sel = store.get();
    globe.setArcs(arcs(ds, sel), (a) => {
      const name = ds.countries.get(a.cty)?.name ?? a.cty;
      return `${name} · ${DIRECTION_LABELS[a.dir]} · ${formatMeasure(a.value, sel.measure)}`;
    });
    globe.setSelected(sel.country);
  };
  store.subscribe(render);
  render();
}

start().catch((err: Error) => {
  const box = document.createElement('p');
  box.className = 'load-error';
  box.setAttribute('role', 'alert');
  box.textContent = err.message;
  document.body.replaceChildren(box);
});
