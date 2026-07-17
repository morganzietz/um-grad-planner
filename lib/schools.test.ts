import { describe, it, expect } from 'vitest';
import { SCHOOLS, schoolForMajor, schoolById } from './schools';

describe('school matcher', () => {
  it('routes an LSA major to the LSA bucket', () => {
    const s = schoolForMajor({
      school: 'University of Michigan College of Literature, Science, and the Arts',
    });
    expect(s?.id).toBe('lsa');
  });

  it('routes a School-of-Information major to UMSI', () => {
    const s = schoolForMajor({ school: 'University of Michigan School of Information' });
    expect(s?.id).toBe('umsi');
  });

  it('does not route COE to LSA when the string contains "College of Engineering"', () => {
    const s = schoolForMajor({ school: 'College of Engineering' });
    expect(s?.id).toBe('coe');
  });

  it('returns undefined for unrecognized school text', () => {
    const s = schoolForMajor({ school: 'Some Random Institute' });
    expect(s).toBeUndefined();
  });

  it('lookup by id works', () => {
    expect(schoolById('lsa')?.short).toBe('LSA');
    expect(schoolById('ross')?.full).toContain('Ross');
    expect(schoolById('nonsense')).toBeUndefined();
  });

  it('all canonical schools have unique ids', () => {
    const ids = new Set(SCHOOLS.map((s) => s.id));
    expect(ids.size).toBe(SCHOOLS.length);
  });
});
