import type { Country, Flow } from '../shared/types';

export interface Problem {
  kind: 'unmapped_code' | 'missing_country' | 'revision' | 'empty';
  detail: string;
}

/** Flag a (month, direction, group) total that moved by more than this factor, where the old total was at least MIN_PREV. */
const UP = 1.5;
const DOWN = 0.67;
const MIN_PREV = 1_000_000;

function totals(flows: Flow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of flows) {
    const k = `${f.month} ${f.dir} ${f.group}`;
    m.set(k, (m.get(k) ?? 0) + f.value);
  }
  return m;
}

const usd = (n: number) => `$${(n / 1e6).toFixed(1)}M`;

export function validate(
  next: { flows: Flow[]; unmapped: string[]; countries: Country[] },
  prev: Flow[] | null,
): Problem[] {
  const problems: Problem[] = [];
  if (next.flows.length === 0) problems.push({ kind: 'empty', detail: 'No flows were produced' });

  for (const code of next.unmapped) {
    problems.push({ kind: 'unmapped_code', detail: `Commodity ${code} is not in pipeline/product-groups.json` });
  }

  const known = new Set(next.countries.map((c) => c.code));
  const missing = [...new Set(next.flows.map((f) => f.cty))].filter((c) => !known.has(c)).sort();
  for (const code of missing) {
    problems.push({ kind: 'missing_country', detail: `Census country ${code} is not in pipeline/country-reference.json` });
  }

  if (prev && next.flows.length > 0) {
    const nextMonths = new Set(next.flows.map((f) => f.month));
    const latestNext = [...nextMonths].sort().at(-1)!;
    const now = totals(next.flows);
    for (const [k, before] of totals(prev)) {
      if (before < MIN_PREV) continue;
      // A month past the end of the new data is a shorter range, handled elsewhere, not a revision.
      if (k.slice(0, 7) > latestNext) continue;
      const after = now.get(k) ?? 0;
      const r = after / before;
      if (r > UP || r < DOWN) {
        problems.push({ kind: 'revision', detail: `${k}: ${usd(before)} → ${usd(after)}` });
      }
    }
  }
  return problems;
}
