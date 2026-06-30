import { describe, expect, it } from 'vitest';
import { normalizeBudgetValue } from './useBudgetControls';

describe('budget controls helpers', () => {
  it('normalizes budget input to a non-negative integer', () => {
    expect(normalizeBudgetValue('120000')).toBe(120000);
    expect(normalizeBudgetValue('12,000')).toBe(12000);
    expect(normalizeBudgetValue('-50')).toBe(0);
  });
});
