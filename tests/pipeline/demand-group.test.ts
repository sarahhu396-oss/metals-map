import { describe, expect, test } from 'vitest';
import industries from '../../pipeline/industries.json';
import { groupCounty, type Cell } from '../../pipeline/demand/group';
import { INDUSTRY_GROUPS, type GroupDef } from '../../shared/demand';

const defs = industries as GroupDef[];
const def = (id: string) => defs.find((d) => d.id === id)!;
const cells = (o: Record<string, Cell>) => new Map(Object.entries(o));

describe('groupCounty', () => {
  test('sums the add codes', () => {
    const d: GroupDef = { id: 'aero', label: 'x', add: ['3364', '3366'], subtract: [] };
    const c = cells({ '3364': { estab: 5, emp: 100 }, '3366': { estab: 2, emp: 30 } });
    expect(groupCounty(c, d)).toEqual({ estab: 7, emp: 130 });
  });

  test('subtracts contained codes', () => {
    const c = cells({
      '333': { estab: 10, emp: 500 },
      '333242': { estab: 2, emp: 50 },
      '333415': { estab: 1, emp: 20 },
    });
    expect(groupCounty(c, def('machinery'))).toEqual({ estab: 7, emp: 430 });
  });

  test('a missing code counts as zero', () => {
    const d: GroupDef = { id: 'aero', label: 'x', add: ['3364', '3366'], subtract: [] };
    expect(groupCounty(cells({ '3364': { estab: 5, emp: 100 } }), d)).toEqual({ estab: 5, emp: 100 });
    expect(groupCounty(new Map(), d)).toEqual({ estab: 0, emp: 0 });
  });

  test('a withheld term makes emp null but estab still resolves', () => {
    const d: GroupDef = { id: 'aero', label: 'x', add: ['3364', '3366'], subtract: [] };
    const added = cells({ '3364': { estab: 5, emp: null }, '3366': { estab: 2, emp: 30 } });
    expect(groupCounty(added, d)).toEqual({ estab: 7, emp: null });
    const subtracted = cells({
      '333': { estab: 10, emp: 500 },
      '333242': { estab: 2, emp: null },
    });
    expect(groupCounty(subtracted, def('machinery'))).toEqual({ estab: 8, emp: null });
  });

  test('negative results clamp to zero', () => {
    const c = cells({ '333': { estab: 1, emp: 10 }, '333242': { estab: 3, emp: 40 } });
    expect(groupCounty(c, def('machinery'))).toEqual({ estab: 0, emp: 0 });
  });
});

describe('industries.json', () => {
  test('has every group once, in display order', () => {
    expect(defs.map((d) => d.id)).toEqual(INDUSTRY_GROUPS);
    for (const d of defs) expect(d.label.length).toBeGreaterThan(0);
  });

  test('no NAICS code is added in two groups', () => {
    const seen = new Map<string, string>();
    for (const d of defs) {
      for (const code of d.add) {
        expect(seen.get(code), `${code} in ${seen.get(code)} and ${d.id}`).toBeUndefined();
        seen.set(code, d.id);
      }
    }
  });

  test('each subtracted code sits under its own group and is added in exactly one other', () => {
    for (const d of defs) {
      for (const code of d.subtract) {
        expect(d.add.some((a) => code.startsWith(a)), `${code} not under ${d.id}`).toBe(true);
        const owners = defs.filter((o) => o.id !== d.id && o.add.includes(code));
        expect(owners, `${code} owners`).toHaveLength(1);
      }
    }
  });

  test('matches the specified subtractions', () => {
    expect(def('auto').subtract).toEqual(['336212', '336214']);
    expect(def('machinery').subtract).toEqual(['333242', '333415']);
  });
});
