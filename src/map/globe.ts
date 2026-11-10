import { Deck, _GlobeView as GlobeView } from '@deck.gl/core';
import { ArcLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import world from 'world-atlas/countries-110m.json';
import type { Arc } from '../data/query';
import { borderPaths, declutter, facesViewer, landDots, type Box } from './geo';

type RGB = [number, number, number];
type RGBA = [number, number, number, number];
type LonLat = [number, number];

interface Theme {
  background: string;
  sphere: RGB;
  dots: RGBA;
  border: RGBA;
  imports: RGB;
  exports: RGB;
}

const LIGHT: Theme = {
  background: '#ffffff',
  sphere: [244, 246, 248],
  dots: [40, 44, 52, 150],
  border: [0, 0, 0, 200],
  imports: [214, 40, 40],
  exports: [17, 17, 17],
};
const DARK: Theme = {
  background: '#121312',
  sphere: [30, 32, 34],
  dots: [200, 204, 210, 120],
  border: [225, 225, 225, 170],
  imports: [239, 83, 80],
  exports: [235, 235, 235],
};

function theme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

/** The globe opens over the Atlantic so routes from the US draw as visible curves. */
const START: LonLat = [-38, 28];
const DOT_SPACING = 1.4;
const ARC_WIDTH = 2;
const ARC_HEIGHT = 0.1;

/** The sphere sits a little below the surface so borders and dots drawn at the surface never flicker against it. */
const SPHERE_DEPTH = -40_000;
const WHOLE_WORLD: [number, number, number][][] = [
  [[-180, 90], [0, 90], [180, 90], [180, -90], [0, -90], [-180, -90]].map(
    ([lon, lat]) => [lon, lat, SPHERE_DEPTH] as [number, number, number]),
];

export interface GlobeOptions {
  onHover(cty: string | null): void;
  onSelect(cty: string | null): void;
}

export interface Globe {
  setArcs(arcs: Arc[], format: (a: Arc) => string): void;
  setSelected(cty: string | null): void;
}

/** The partner country's end of an arc. */
const partnerEnd = (a: Arc): LonLat => (a.dir === 'imports' ? a.from : a.to);

export function createGlobe(el: HTMLElement, opts: GlobeOptions): Globe {
  const t = theme();
  el.style.background = t.background;
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
  let center: LonLat = START;

  // Country names are HTML, placed over the canvas after each frame.
  const labelBox = document.createElement('div');
  labelBox.className = 'map-labels';
  el.appendChild(labelBox);
  let labelEls: HTMLSpanElement[] = [];
  let labelSize: { w: number; h: number }[] = [];
  /** Arc indices, largest value first: bigger partners win label space. */
  let labelOrder: number[] = [];

  const baseLayers = [
    new SolidPolygonLayer({
      id: 'sphere',
      data: WHOLE_WORLD,
      getPolygon: (d: [number, number, number][]) => d,
      getFillColor: t.sphere,
    }),
    new ScatterplotLayer<LonLat>({
      id: 'land-dots',
      data: landDots(countries, DOT_SPACING),
      getPosition: (d) => d,
      getFillColor: t.dots,
      radiusUnits: 'pixels',
      getRadius: 1.2,
    }),
    new PathLayer<number[][]>({
      id: 'borders',
      data: borderPaths(countries),
      getPath: (d) => d as [number, number][],
      getColor: t.border,
      widthUnits: 'pixels',
      getWidth: 1,
    }),
  ];

  const deck = new Deck({
    parent: el as HTMLDivElement,
    views: new GlobeView({ id: 'globe' }),
    initialViewState: { longitude: START[0], latitude: START[1], zoom: 1.2 },
    controller: true,
    parameters: { cullMode: 'back' },
    layers: baseLayers,
    getCursor: ({ isDragging, isHovering }) =>
      isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab',
    onClick: (info) => {
      if (!info.object) opts.onSelect(null);
    },
    onViewStateChange: ({ viewState }) => {
      const vs = viewState as { longitude: number; latitude: number };
      center = [vs.longitude, vs.latitude];
      return viewState;
    },
    onAfterRender: () => placeLabels(),
  });

  const colorOf = (a: Arc): RGB => (a.dir === 'imports' ? t.imports : t.exports);

  function color(a: Arc): RGBA {
    const dim = selected !== null && a.cty !== selected;
    const [r, g, b] = colorOf(a);
    return [r, g, b, dim ? 45 : 255];
  }

  function buildLabels(): void {
    labelEls = arcs.map((a) => {
      const span = document.createElement('span');
      span.className = `map-label ${a.dir}`;
      span.textContent = a.name;
      span.style.color = `rgb(${colorOf(a).join(',')})`;
      return span;
    });
    labelBox.replaceChildren(...labelEls);
    labelSize = labelEls.map((e) => ({ w: e.offsetWidth, h: e.offsetHeight }));
    labelOrder = arcs.map((_, i) => i).sort((a, b) => arcs[b].value - arcs[a].value);
  }

  /**
   * Move each label to its country's screen position. Labels on the far side of
   * the globe, and smaller partners' labels that would overlap a larger one's, are hidden.
   */
  function placeLabels(): void {
    const viewport = deck.getViewports()[0];
    if (!viewport) return;
    const candidates: { i: number; box: Box }[] = [];
    for (const i of labelOrder) {
      const at = partnerEnd(arcs[i]);
      if (!facesViewer(at, center)) continue;
      const [x, y] = viewport.project([at[0], at[1], 0]);
      const { w, h } = labelSize[i];
      candidates.push({ i, box: { x: x + 6, y: y - h / 2, w, h } });
    }
    const keep = declutter(candidates.map((c) => c.box));
    labelEls.forEach((span) => { span.hidden = true; });
    candidates.forEach(({ i, box }, k) => {
      if (!keep[k]) return;
      const span = labelEls[i];
      span.hidden = false;
      span.style.transform = `translate(${box.x}px, ${box.y}px)`;
      span.classList.toggle('dim', selected !== null && arcs[i].cty !== selected);
    });
    el.dataset.labelCount = String(keep.filter(Boolean).length);
  }

  function render(): void {
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
          getHeight: ARC_HEIGHT,
          pickable: true,
          widthUnits: 'pixels',
          getWidth: ARC_WIDTH,
          getSourcePosition: (a) => a.from,
          getTargetPosition: (a) => a.to,
          getSourceColor: color,
          getTargetColor: color,
          updateTriggers: { getSourceColor: [selected], getTargetColor: [selected] },
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
      buildLabels();
      render();
    },
    setSelected(cty) {
      if (cty === selected) return;
      selected = cty;
      render();
    },
  };
}
