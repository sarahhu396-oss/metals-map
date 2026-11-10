import type { GroupDef } from '../../shared/demand';

export interface Cell {
  estab: number;
  /** null = withheld */
  emp: number | null;
}

const ZERO: Cell = { estab: 0, emp: 0 };

/**
 * Sum a group's added codes and subtract its contained codes. A code absent
 * from the map counts as zero. Any withheld employment term makes the result
 * null; establishments always resolve. Noise from subtraction clamps to zero.
 */
export function groupCounty(cells: Map<string, Cell>, def: GroupDef): Cell {
  let estab = 0;
  let emp: number | null = 0;
  const apply = (code: string, sign: 1 | -1) => {
    const c = cells.get(code) ?? ZERO;
    estab += sign * c.estab;
    emp = emp === null || c.emp === null ? null : emp + sign * c.emp;
  };
  for (const code of def.add) apply(code, 1);
  for (const code of def.subtract) apply(code, -1);
  return { estab: Math.max(0, estab), emp: emp === null ? null : Math.max(0, emp) };
}
