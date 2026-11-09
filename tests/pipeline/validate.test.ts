import { describe, expect, test } from 'vitest';
import type { Country, Flow } from '../../shared/types';
import { validate } from '../../pipeline/validate';

const canada: Country = { code: '1220', name: 'Canada', iso2: 'CA', lat: 56, lon: -106 };

function flow(p: Partial<Flow>): Flow {
  return { month: '2024-05', dir: 'imports', group: 'plate', cty: '1220', tonnes: 1, value: 1, duty: 0, ...p };
}

const ok = (flows: Flow[], extra: Partial<Parameters<typeof validate>[0]> = {}) =>
  ({ flows, unmapped: [], countries: [canada], ...extra });

describe('validate', () => {
  test('an unmapped code is a problem naming the code', () => {
    const p = validate(ok([flow({})], { unmapped: ['7606123099'] }), null);
    expect(p).toEqual([{ kind: 'unmapped_code', detail: expect.stringContaining('7606123099') }]);
  });

  test('a flow country with no reference entry is a problem naming the code', () => {
    const p = validate(ok([flow({}), flow({ cty: '9999' })]), null);
    expect(p).toEqual([{ kind: 'missing_country', detail: expect.stringContaining('9999') }]);
  });

  test('no flows is a problem', () => {
    expect(validate(ok([]), null).map((x) => x.kind)).toEqual(['empty']);
  });

  test('a month total moving more than 1.5x against the previous data is a revision', () => {
    const prev = [flow({ value: 6_000_000 }), flow({ cty: '5700', value: 4_000_000 })];
    const up = validate(ok([flow({ value: 16_000_000 })]), prev);
    expect(up).toEqual([{ kind: 'revision', detail: expect.stringContaining('2024-05') }]);
    expect(validate(ok([flow({ value: 14_000_000 })]), prev)).toEqual([]);
    expect(validate(ok([flow({ value: 6_000_000 })]), prev).map((x) => x.kind)).toEqual(['revision']);
    expect(validate(ok([flow({ value: 7_000_000 })]), prev)).toEqual([]);
  });

  test('previous totals under $1M are never revisions', () => {
    expect(validate(ok([flow({ value: 5_000_000 })]), [flow({ value: 900_000 })])).toEqual([]);
  });

  test('a month new in the next data is never a revision', () => {
    const prev = [flow({ month: '2024-04', value: 10_000_000 })];
    expect(validate(ok([flow({ month: '2024-04', value: 10_000_000 }), flow({ value: 99_000_000 })]), prev)).toEqual([]);
  });

  test('a month missing from the next data is a revision (it dropped to zero)', () => {
    const prev = [flow({ month: '2024-04', value: 10_000_000 }), flow({ value: 10_000_000 })];
    expect(validate(ok([flow({ value: 10_000_000 })]), prev).map((x) => x.kind)).toEqual(['revision']);
  });

  test('first run (no previous data) has no revisions', () => {
    expect(validate(ok([flow({ value: 50_000_000 })]), null)).toEqual([]);
  });
});
