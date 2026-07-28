import { describe, it, expect } from 'vitest';
import { countsTowardRequirements, meetsGradeFloor } from './grades';
import { auditDegree, requirementCompletionPct } from './audit';
import type { Major, Profile, Requirement, TakenCourse } from './types';

describe('countsTowardRequirements', () => {
  it('counts C- and above', () => {
    for (const g of ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-']) {
      expect(countsTowardRequirements(g), g).toBe(true);
    }
  });

  it('rejects below C-, failures, and withdrawals', () => {
    for (const g of ['D+', 'D', 'D-', 'E', 'F', 'W', 'I', 'NC', 'U']) {
      expect(countsTowardRequirements(g), g).toBe(false);
    }
  });

  it('counts non-letter passing marks and in-progress markers', () => {
    for (const g of ['P', 'S', 'T', 'CR', 'CBE', '*', 'IP', '', '  ']) {
      expect(countsTowardRequirements(g), JSON.stringify(g)).toBe(true);
    }
  });

  it('is case and whitespace tolerant', () => {
    expect(countsTowardRequirements(' b+ ')).toBe(true);
    expect(countsTowardRequirements(' w ')).toBe(false);
  });
});

describe('meetsGradeFloor', () => {
  it('falls back to the C- gate when no floor is set', () => {
    expect(meetsGradeFloor('C-')).toBe(true);
    expect(meetsGradeFloor('D+')).toBe(false);
  });

  it('a D floor admits the D range but not failures or withdrawals', () => {
    for (const g of ['A', 'C-', 'D+', 'D']) expect(meetsGradeFloor(g, 'D'), g).toBe(true);
    for (const g of ['D-', 'E', 'F', 'W', 'I', 'NC']) expect(meetsGradeFloor(g, 'D'), g).toBe(false);
  });

  it('a C floor rejects C-', () => {
    expect(meetsGradeFloor('C', 'C')).toBe(true);
    expect(meetsGradeFloor('C-', 'C')).toBe(false);
  });

  it('passing marks and in-progress satisfy any floor', () => {
    for (const g of ['P', 'T', 'CR', '*', 'IP', '']) {
      expect(meetsGradeFloor(g, 'C'), JSON.stringify(g)).toBe(true);
    }
  });
});

// ── Audit integration ────────────────────────────────────────────────────

const taken = (code: string, grade: string, credits = 4): TakenCourse => ({
  code,
  title: code,
  credits,
  tags: [],
  term: 'FA 2025',
  grade,
});

const req = (r: Partial<Requirement> & { id: string }): Requirement => ({
  label: r.id,
  hint: '',
  need: 1,
  countMode: 'count',
  ...r,
});

const major: Major = {
  id: 'test-major',
  name: 'Test Major',
  school: 'LSA',
  goalCredits: 8,
  requirements: [
    req({ id: 'needs-281', matchCodes: ['EECS 281'] }),
    req({ id: 'credit-bucket', need: 8, countMode: 'credits', matchAll: true }),
  ],
};

const profileWith = (courses: TakenCourse[], planned: Profile['plannedTerms'] = []): Profile => ({
  takenCourses: courses,
  plannedTerms: planned,
  majorId: 'test-major',
});

describe('grade gating in the audit', () => {
  it('a withdrawal satisfies nothing and earns no credits', () => {
    const audit = auditDegree(profileWith([taken('EECS 281', 'W')]), major, []);
    const r = audit.requirements.find((p) => p.requirement.id === 'needs-281')!;
    expect(r.met).toBe(false);
    expect(r.takenContributors).toHaveLength(0);
    expect(audit.credits.takenCredits).toBe(0);
  });

  it('a grade below C- satisfies nothing', () => {
    const audit = auditDegree(profileWith([taken('EECS 281', 'D+')]), major, []);
    expect(audit.requirements[0].met).toBe(false);
    expect(audit.credits.takenCredits).toBe(0);
  });

  it('a requirement with minGrade D accepts a D while the rest of the audit does not', () => {
    const dMajor: Major = {
      ...major,
      requirements: [
        req({ id: 'accepts-d', matchCodes: ['MECHENG 335'], minGrade: 'D' }),
        req({ id: 'default-floor', matchCodes: ['MECHENG 335'] }),
      ],
    };
    const audit = auditDegree(profileWith([taken('MECHENG 335', 'D')]), dMajor, []);
    const byId = new Map(audit.requirements.map((p) => [p.requirement.id, p]));
    expect(byId.get('accepts-d')!.met).toBe(true);
    expect(byId.get('default-floor')!.met).toBe(false);
    // Credit totals keep the C- gate.
    expect(audit.credits.takenCredits).toBe(0);
  });

  it('a requirement with minGrade C rejects a C-', () => {
    const cMajor: Major = {
      ...major,
      requirements: [req({ id: 'needs-c', matchCodes: ['ENGR 100'], minGrade: 'C' })],
    };
    const audit = auditDegree(profileWith([taken('ENGR 100', 'C-')]), cMajor, []);
    expect(audit.requirements[0].met).toBe(false);
  });

  it('a C- still counts', () => {
    const audit = auditDegree(profileWith([taken('EECS 281', 'C-')]), major, []);
    expect(audit.requirements[0].met).toBe(true);
    expect(audit.credits.takenCredits).toBe(4);
  });

  it('in-progress courses keep counting', () => {
    const audit = auditDegree(profileWith([taken('EECS 281', '*')]), major, []);
    expect(audit.requirements[0].met).toBe(true);
  });

  it('a failed attempt does not block a planned retake from counting', () => {
    const library = [{ code: 'EECS 281', title: 'DS&A', credits: 4, tags: [] }];
    const audit = auditDegree(
      profileWith(
        [taken('EECS 281', 'W')],
        [{ id: 'F2027', name: 'Fall 2027', courseCodes: ['EECS 281'] }],
      ),
      major,
      library,
    );
    const r = audit.requirements.find((p) => p.requirement.id === 'needs-281')!;
    expect(r.planned).toBe(1);
    expect(r.met).toBe(true);
  });

  it('a force-included course still needs a counting grade', () => {
    const audit = auditDegree(
      {
        ...profileWith([taken('RANDOM 200', 'W')]),
        requirementOverrides: [
          {
            credentialId: 'test-major',
            requirementId: 'needs-281',
            courseCode: 'RANDOM 200',
            action: 'include',
          },
        ],
      },
      major,
      [],
    );
    expect(audit.requirements[0].met).toBe(false);
  });
});

describe('requirementCompletionPct', () => {
  const tenReqs: Major = {
    id: 'test-major',
    name: 'Test Major',
    school: 'LSA',
    goalCredits: 120,
    requirements: Array.from({ length: 20 }, (_, i) =>
      req({ id: `r${i}`, matchCodes: [`SUBJ ${100 + i}`] }),
    ),
  };

  it('2 of 20 requirements met reads 10 percent', () => {
    const audit = auditDegree(
      profileWith([taken('SUBJ 100', 'A'), taken('SUBJ 101', 'B')]),
      tenReqs,
      [],
    );
    expect(requirementCompletionPct(audit.requirements)).toBe(10);
  });

  it('meeting only the credit total is nowhere near 100 percent', () => {
    // 30 credits of generic coursework: fills the credit bucket, not the major.
    const generic = Array.from({ length: 8 }, (_, i) => taken(`GEN ${100 + i}`, 'A'));
    const audit = auditDegree(profileWith(generic), major, []);
    expect(audit.credits.met).toBe(true);
    expect(requirementCompletionPct(audit.requirements)).toBe(50);
  });

  it('counts pick-group parents once, not their children', () => {
    const withPick: Major = {
      ...major,
      requirements: [
        req({ id: 'parent', pickFromGroups: ['child-a', 'child-b'] }),
        req({ id: 'child-a', matchCodes: ['AAA 100'] }),
        req({ id: 'child-b', matchCodes: ['BBB 100'] }),
        req({ id: 'solo', matchCodes: ['CCC 100'] }),
      ],
    };
    const audit = auditDegree(profileWith([taken('AAA 100', 'A')]), withPick, []);
    // Parent met via child-a; solo unmet. 1 of 2 countable = 50.
    expect(requirementCompletionPct(audit.requirements)).toBe(50);
  });

  it('empty requirement list reads 0, not NaN', () => {
    expect(requirementCompletionPct([])).toBe(0);
  });
});
