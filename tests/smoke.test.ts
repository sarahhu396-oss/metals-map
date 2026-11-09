import { expect, test } from 'vitest';
import type { Flow } from '../shared/types';

test('shared types are importable', () => {
  const flow: Flow = {
    month: '2025-01', dir: 'imports', group: 'plate_sheet', cty: '1220',
    tonnes: 1, value: 2, duty: 0,
  };
  expect(flow.tonnes! + 1).toBe(2);
});
