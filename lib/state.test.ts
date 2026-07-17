import { describe, it, expect } from 'vitest';
import { inferStartYear } from './state';

describe('inferStartYear', () => {
  it('returns the Fall year of the earliest academic year', () => {
    expect(inferStartYear([{ term: 'F24' }, { term: 'W25' }, { term: 'F25' }])).toBe(2024);
  });

  it('returns Fall Y - 1 when the earliest term is a Winter Y', () => {
    // Started at U-M in Winter 2025 (transfer). Academic year 2024-2025 → Fall 2024.
    expect(inferStartYear([{ term: 'W25' }, { term: 'F25' }])).toBe(2024);
  });

  it('handles Spring/Summer terms', () => {
    expect(inferStartYear([{ term: 'Sp26' }, { term: 'F26' }])).toBe(2025);
  });

  it('ignores AP terms (which have no calendar year)', () => {
    expect(inferStartYear([{ term: 'AP' }, { term: 'F26' }])).toBe(2026);
  });

  it('returns undefined when nothing is term-scoped', () => {
    expect(inferStartYear([{ term: 'AP' }])).toBeUndefined();
    expect(inferStartYear([])).toBeUndefined();
  });
});
