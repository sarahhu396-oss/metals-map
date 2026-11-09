import { Deck, _GlobeView as GlobeView } from '@deck.gl/core';
import { ArcLayer, GeoJsonLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { Arc } from '../data/query';
import { US } from '../data/query';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

interface Theme {
  ocean: RGB;
  land: RGB;
  border: RGB;
  imports: RGB;
  exports: RGB;
}

const LIGHT: Theme = {
  ocean: [236, 238, 240], land: [208, 212, 216], border: [246, 247, 248],
  imports: [42, 120, 214], exports: [235, 104, 52],
};
const DARK: Theme = {
  ocean: [34, 36, 38], land: [66, 70, 74], border: [34, 36, 38],
  imports: [57, 135, 229], exports: [217, 89, 38],
};

function theme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

const WHOLE_WORLD: [number, number][][] = [
  [[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]],
];

export interface GlobeOptions {
  onHover(cty: string | null): void;
  onSelect(cty: string | null): void;
}

export interface Globe {
  setArcs(arcs: Arc[], format: (a: Arc) => string): void;
  setSelected(cty: string | null): void;
}

export function createGlobe(el: HTMLElement, opts: GlobeOptions): Globe {
  const t = theme();
  const topology = world as unknown as Topology;
  const all = feature(topology, topology.objects.countries) as unknown as GeoJSON.FeatureCollection;
  // Antarctica's polygon wraps the pole and renders as a ring artefact on a globe
  const countries = { ...all, features: all.features.filter((f) => f.id !== '010') };

  const tooltip = document.createElement('div');
  tooltip.className = 'map-tooltip';
  tooltip.hidden = true;
  el.appendChild(tooltip);

  let arcs: Arc[] = [];
  let format: (a: Arc) => string = (a) => a.cty;
  let selected: string | null = null;

  const baseLayers = [
    new SolidPolygonLayer({
      id: 'ocean',
      data: WHOLE_WORLD,
      getPolygon: (d: [number, number][]) => d,
      getFillColor: t.ocean,
      stroked: false,
    }),
    new GeoJsonLayer({
      id: 'land',
      data: countries as never,
      filled: true,
      stroked: true,
      getFillColor: t.land,
      getLineColor: t.border,
      lineWidthUnits: 'pixels',
      getLineWidth: 0.6,
    }),
  ];

  const deck = new Deck({
    parent: el as HTMLDivElement,
    views: new GlobeView({ id: 'globe' }),
    initialViewState: { longitude: US[0], latitude: US[1], zoom: 1.2 },
    controller: true,
    parameters: { cullMode: 'back' },
    layers: baseLayers,
    getCursor: ({ isDragging, isHovering }) =>
      isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    onClick: (info) => {
      if (!info.object) opts.onSelect(null);
    },
  });

  function color(a: Arc, alpha: number): RGBA {
    const base = a.dir === 'imports' ? t.imports : t.exports;
    const dim = selected !== null && a.cty !== selected;
    return [base[0], base[1], base[2], dim ? 40 : alpha];
  }

  function render(): void {
    const max = arcs.reduce((m, a) => Math.max(m, a.value), 0);
    deck.setProps({
      layers: [
        ...baseLayers,
        new ArcLayer<Arc>({
          id: 'flows',
          data: arcs,
          greatCircle: true,
          // Arc ribbons face either way; culling them hides the near side of the globe
          parameters: { cullMode: 'none' },
          numSegments: 64,
          getHeight: 0.12,
          pickable: true,
          widthUnits: 'pixels',
          getSourcePosition: (a) => a.from,
          getTargetPosition: (a) => a.to,
          getWidth: (a) => 1 + 11 * Math.sqrt(max > 0 ? a.value / max : 0),
          getSourceColor: (a) => color(a, 110),
          getTargetColor: (a) => color(a, 235),
          updateTriggers: {
            getSourceColor: [selected],
            getTargetColor: [selected],
            getWidth: [max],
          },
          onHover: (info) => {
            const a = info.object as Arc | undefined;
            if (a) {
              tooltip.textContent = format(a);
              tooltip.style.left = `${info.x + 12}px`;
              tooltip.style.top = `${info.y + 12}px`;
            }
            tooltip.hidden = !a;
            opts.onHover(a ? a.cty : null);
          },
          onClick: (info) => {
            const a = info.object as Arc | undefined;
            if (a) opts.onSelect(a.cty);
            return true;
          },
        }),
      ],
    });
    el.dataset.arcCount = String(arcs.length);
  }

  return {
    setArcs(next, fmt) {
      arcs = next;
      format = fmt;
      render();
    },
    setSelected(cty) {
      if (cty === selected) return;
      selected = cty;
      render();
    },
  };
}
