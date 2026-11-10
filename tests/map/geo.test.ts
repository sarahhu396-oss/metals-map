import { describe, expect, test } from 'vitest';
import { borderPaths, declutter, facesViewer, landDots } from '../../src/map/geo';

const square = (x0: number, y0: number, x1: number, y1: number): number[][] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

const fc = (geometry: GeoJSON.Geometry): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry }],
});

describe('landDots', () => {
  test('places dots inside land only', () => {
    const dots = landDots(fc({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] }), 2);
    expect(dots.length).toBeGreaterThan(10);
    for (const [lon, lat] of dots) {
      expect(lon).toBeGreaterThanOrEqual(0);
      expect(lon).toBeLessThanOrEqual(10);
      expect(lat).toBeGreaterThanOrEqual(0);
      expect(lat).toBeLessThanOrEqual(10);
    }
  });

  test('leaves holes (lakes) empty', () => {
    const dots = landDots(fc({ type: 'Polygon', coordinates: [square(0, 0, 20, 20), square(5, 5, 15, 15)] }), 1);
    expect(dots.some(([lon, lat]) => lon > 6 && lon < 14 && lat > 6 && lat < 14)).toBe(false);
    expect(dots.some(([lon, lat]) => lon < 4 && lat < 4)).toBe(true);
  });

  test('handles multipolygons', () => {
    const dots = landDots(fc({
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 5, 5)], [square(40, 40, 45, 45)]],
    }), 1);
    expect(dots.some(([lon]) => lon < 10)).toBe(true);
    expect(dots.some(([lon]) => lon > 35)).toBe(true);
  });

  test('a polygon crossing the date line only fills its own area, not a ring round the globe', () => {
    // An island from 175E to 175W (written as -175), like Fiji or eastern Russia
    const ring = [[175, -20], [180, -20], [-180, -20], [-175, -20], [-175, -10], [-180, -10], [180, -10], [175, -10], [175, -20]];
    const dots = landDots(fc({ type: 'Polygon', coordinates: [ring] }), 1);
    expect(dots.length).toBeGreaterThan(0);
    for (const [lon] of dots) expect(Math.abs(lon)).toBeGreaterThanOrEqual(174);
  });

  test('keeps roughly even spacing toward the poles', () => {
    const band = (lat: number) =>
      landDots(fc({
        type: 'MultiPolygon',
        coordinates: [[square(-180, lat - 0.5, 0, lat + 0.5)], [square(0, lat - 0.5, 180, lat + 0.5)]],
      }), 1)
        .filter(([, y]) => Math.abs(y - lat) < 0.6).length;
    expect(band(60)).toBeLessThan(band(0) * 0.7);
  });
});

describe('facesViewer', () => {
  test('the view centre faces the viewer', () => {
    expect(facesViewer([-38, 28], [-38, 28])).toBe(true);
  });
  test('the antipode does not', () => {
    expect(facesViewer([142, -28], [-38, 28])).toBe(false);
  });
  test('a point 80 degrees away faces; 100 degrees away does not', () => {
    expect(facesViewer([42, 0], [-38, 0])).toBe(true);
    expect(facesViewer([62, 0], [-38, 0])).toBe(false);
  });
});

describe('borderPaths', () => {
  test('a ring becomes one closed path', () => {
    const paths = borderPaths(fc({ type: 'Polygon', coordinates: [square(0, 0, 10, 10)] }));
    expect(paths).toEqual([square(0, 0, 10, 10)]);
  });

  test('a ring crossing the date line is split where it jumps, so no line wraps the globe', () => {
    const ring = [[170, 0], [180, 0], [-180, 0], [-170, 0], [-170, 5], [-180, 5], [180, 5], [170, 5], [170, 0]];
    const paths = borderPaths(fc({ type: 'Polygon', coordinates: [ring] }));
    for (const path of paths) {
      for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(180);
    }
    expect(paths.flat()).toHaveLength(ring.length);
  });

  test('includes holes and every polygon of a multipolygon', () => {
    const paths = borderPaths(fc({
      type: 'MultiPolygon',
      coordinates: [[square(0, 0, 20, 20), square(5, 5, 15, 15)], [square(40, 40, 45, 45)]],
    }));
    expect(paths).toHaveLength(3);
  });
});

describe('declutter', () => {
  const box = (x: number, y: number) => ({ x, y, w: 50, h: 12 });

  test('keeps everything when nothing overlaps', () => {
    expect(declutter([box(0, 0), box(100, 0), box(0, 40)])).toEqual([true, true, true]);
  });

  test('drops a later box that overlaps an earlier kept one', () => {
    expect(declutter([box(0, 0), box(20, 4), box(200, 0)])).toEqual([true, false, true]);
  });

  test('a dropped box does not block later ones', () => {
    // b overlaps a, so b is dropped; c overlaps only b, so c is kept
    expect(declutter([box(0, 0), box(40, 0), box(80, 0)])).toEqual([true, false, true]);
  });
});
