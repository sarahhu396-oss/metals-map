type LonLat = [number, number];
type Ring = number[][];

interface Poly {
  rings: Ring[];
  box: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  /** Crosses the date line: rings are stored with longitudes in 0..360 */
  wrapped: boolean;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygons(fc: GeoJSON.FeatureCollection): Poly[] {
  const out: Poly[] = [];
  const push = (original: Ring[]) => {
    const outer = original[0];
    const wrapped = outer.some((p, i) => i > 0 && Math.abs(p[0] - outer[i - 1][0]) >= 180);
    const rings = wrapped
      ? original.map((r) => r.map(([x, y]) => [x < 0 ? x + 360 : x, y]))
      : original;
    let box: Poly['box'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of rings[0]) {
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    }
    out.push({ rings, box, wrapped });
  };
  for (const f of fc.features) {
    const g = f.geometry;
    if (g?.type === 'Polygon') push(g.coordinates);
    else if (g?.type === 'MultiPolygon') g.coordinates.forEach(push);
  }
  return out;
}

/**
 * A grid of points on land, `spacing` degrees apart in latitude and about the
 * same ground distance apart in longitude (wider in degrees toward the poles).
 */
export function landDots(fc: GeoJSON.FeatureCollection, spacing: number): LonLat[] {
  const polys = polygons(fc);
  const dots: LonLat[] = [];
  for (let lat = -90 + spacing / 2; lat < 90; lat += spacing) {
    const step = spacing / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let lon = -180 + step / 2; lon < 180; lon += step) {
      const hit = polys.some((p) => {
        const x = p.wrapped && lon < 0 ? lon + 360 : lon;
        return x >= p.box[0] && x <= p.box[2] && lat >= p.box[1] && lat <= p.box[3]
          && inRing(x, lat, p.rings[0])
          && !p.rings.slice(1).some((hole) => inRing(x, lat, hole));
      });
      if (hit) dots.push([lon, lat]);
    }
  }
  return dots;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** True when `point` is on the hemisphere facing a viewer looking at `center` (both [lon, lat]). */
export function facesViewer(point: LonLat, center: LonLat): boolean {
  const [l1, p1] = [rad(point[0]), rad(point[1])];
  const [l2, p2] = [rad(center[0]), rad(center[1])];
  const cosAngle = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l1 - l2);
  return cosAngle > 0;
}

/**
 * Country outlines as open paths. Rings that cross the date line are split
 * where they jump from +180 to -180, so no segment is drawn the long way round
 * the globe.
 */
export function borderPaths(fc: GeoJSON.FeatureCollection): number[][][] {
  const out: number[][][] = [];
  const addRing = (ring: Ring) => {
    let path: number[][] = [];
    for (const pt of ring) {
      const prev = path[path.length - 1];
      if (prev && Math.abs(pt[0] - prev[0]) >= 180) {
        out.push(path);
        path = [];
      }
      path.push(pt);
    }
    if (path.length) out.push(path);
  };
  for (const p of polygons(fc)) p.rings.forEach(addRing);
  return out;
}

export interface Box { x: number; y: number; w: number; h: number }

/** Greedy label placement: keep each box unless it overlaps one already kept. Earlier boxes win. */
export function declutter(boxes: Box[]): boolean[] {
  const kept: Box[] = [];
  return boxes.map((b) => {
    const clash = kept.some((k) => b.x < k.x + k.w && k.x < b.x + b.w && b.y < k.y + k.h && k.y < b.y + b.h);
    if (!clash) kept.push(b);
    return !clash;
  });
}
