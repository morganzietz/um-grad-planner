import { describe, it, expect } from 'vitest';
import { auditDegree, checkMinors } from './audit';
import { overridesForCredential, removeOverride, upsertOverride } from './overrides';
import type {
  Course,
  Major,
  Minor,
  Profile,
  Requirement,
  RequirementOverride,
  TakenCourse,
} from './types';

const taken = (c: Partial<TakenCourse> & { code: string }): TakenCourse => ({
  title: c.code,
  credits: 3,
  tags: [],
  term: 'FA 2024',
  grade: 'A',
  ...c,
});

const makeMajor = (requirements: Requirement[]): Major => ({
  id: 'test-major',
  name: 'Test Major',
  school: 'LSA',
  goalCredits: 120,
  requirements,
});

const baseProfile = (over: Partial<Profile> = {}): Profile => ({
  takenCourses: [],
  plannedTerms: [],
  majorId: 'test-major',
  ...over,
});

const req = (r: Partial<Requirement> & { id: string }): Requirement => ({
  label: r.id,
  hint: '',
  need: 1,
  countMode: 'count',
  ...r,
});

describe('override list helpers', () => {
  const a: RequirementOverride = {
    credentialId: 'm',
    requirementId: 'r',
    courseCode: 'AAA 100',
    action: 'include',
  };

  it('upsert replaces the opposite action for the same course+requirement', () => {
    const withInclude = upsertOverride([], a);
    const withExclude = upsertOverride(withInclude, { ...a, action: 'exclude' });
    expect(withExclude).toHaveLength(1);
    expect(withExclude[0].action).toBe('exclude');
  });

  it('upsert keeps overrides for other courses and requirements', () => {
    const other: RequirementOverride = { ...a, courseCode: 'BBB 200' };
    const list = upsertOverride(upsertOverride([], a), other);
    expect(list).toHaveLength(2);
  });

  it('removeOverride deletes only the targeted override', () => {
    const other: RequirementOverride = { ...a, requirementId: 'r2' };
    const list = removeOverride(upsertOverride(upsertOverride([], a), other), a);
    expect(list).toEqual([other]);
  });

  it('overridesForCredential filters by credential id', () => {
    const list = [a, { ...a, credentialId: 'other' }];
    expect(overridesForCredential(list, 'm')).toEqual([a]);
    expect(overridesForCredential(undefined, 'm')).toEqual([]);
  });
});

describe('force-include in the audit', () => {
  const major = makeMajor([
    req({ id: 'pick-one', matchCodes: ['REAL 101'] }),
    req({ id: 'other', matchCodes: ['OTHER 300'] }),
  ]);

  it('a non-matching taken course counts once force-included', () => {
    const profile = baseProfile({
      takenCourses: [taken({ code: 'RANDOM 200' })],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'pick-one',
          courseCode: 'RANDOM 200',
          action: 'include',
        },
      ],
    });
    const audit = auditDegree(profile, major, []);
    const p = audit.requirements.find((r) => r.requirement.id === 'pick-one')!;
    expect(p.met).toBe(true);
    expect(p.forcedIn).toEqual(['RANDOM 200']);
    // The include is scoped to one requirement: the other stays unmet.
    const other = audit.requirements.find((r) => r.requirement.id === 'other')!;
    expect(other.met).toBe(false);
    expect(other.forcedIn).toBeUndefined();
  });

  it('include beats the requirement excludeTags', () => {
    const gated = makeMajor([
      req({ id: 'no-ap', matchTag: 'lsa-fywr', excludeTags: ['ap-credit'] }),
    ]);
    const profile = baseProfile({
      takenCourses: [taken({ code: 'ENGLISH 125', tags: ['lsa-fywr', 'ap-credit'] })],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'no-ap',
          courseCode: 'ENGLISH 125',
          action: 'include',
        },
      ],
    });
    const audit = auditDegree(profile, gated, []);
    expect(audit.requirements[0].met).toBe(true);
    expect(audit.requirements[0].forcedIn).toEqual(['ENGLISH 125']);
  });

  it('a manual (still building) requirement becomes satisfiable via includes', () => {
    const manualMajor = makeMajor([
      req({ id: 'still-building', need: 6, countMode: 'credits', manual: true }),
    ]);
    const profile = baseProfile({
      takenCourses: [taken({ code: 'AAA 301' }), taken({ code: 'BBB 302' })],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'still-building',
          courseCode: 'AAA 301',
          action: 'include',
        },
        {
          credentialId: 'test-major',
          requirementId: 'still-building',
          courseCode: 'BBB 302',
          action: 'include',
        },
      ],
    });
    const audit = auditDegree(profile, manualMajor, []);
    const p = audit.requirements[0];
    expect(p.taken).toBe(6);
    expect(p.met).toBe(true);
    expect(p.forcedIn).toEqual(['AAA 301', 'BBB 302']);
  });

  it('includes apply to planned courses too', () => {
    const profile = baseProfile({
      plannedTerms: [{ id: 'F2027', name: 'Fall 2027', courseCodes: ['RANDOM 200'] }],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'pick-one',
          courseCode: 'RANDOM 200',
          action: 'include',
        },
      ],
    });
    const library: Course[] = [
      { code: 'RANDOM 200', title: 'Random', credits: 3, tags: [] },
    ];
    const audit = auditDegree(profile, major, library);
    const p = audit.requirements.find((r) => r.requirement.id === 'pick-one')!;
    expect(p.planned).toBe(1);
    expect(p.met).toBe(true);
  });

  it('matches through equivalentCodes (AP posting satisfies an override on the real code)', () => {
    const profile = baseProfile({
      takenCourses: [taken({ code: 'MATH 120', equivalentCodes: ['MATH 115'] })],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'pick-one',
          courseCode: 'MATH 115',
          action: 'include',
        },
      ],
    });
    const audit = auditDegree(profile, major, []);
    const p = audit.requirements.find((r) => r.requirement.id === 'pick-one')!;
    expect(p.met).toBe(true);
  });
});

describe('force-exclude in the audit', () => {
  const major = makeMajor([
    req({ id: 'bucket', need: 6, countMode: 'credits', matchTag: 'subj-hist' }),
    req({ id: 'sibling', need: 3, countMode: 'credits', matchTag: 'subj-hist' }),
  ]);

  it('a matching course is not counted and is reported as forcedOut', () => {
    const profile = baseProfile({
      takenCourses: [
        taken({ code: 'HIST 300', tags: ['subj-hist'] }),
        taken({ code: 'HIST 310', tags: ['subj-hist'] }),
      ],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'bucket',
          courseCode: 'HIST 310',
          action: 'exclude',
        },
      ],
    });
    const audit = auditDegree(profile, major, []);
    const bucket = audit.requirements.find((r) => r.requirement.id === 'bucket')!;
    expect(bucket.taken).toBe(3);
    expect(bucket.met).toBe(false);
    expect(bucket.forcedOut).toEqual(['HIST 310']);
    // Exclusion is scoped to one requirement: the sibling still counts it.
    const sibling = audit.requirements.find((r) => r.requirement.id === 'sibling')!;
    expect(sibling.taken).toBe(6);
    expect(sibling.forcedOut).toBeUndefined();
  });

  it('excluding a course that never matched is a silent no-op', () => {
    const profile = baseProfile({
      takenCourses: [taken({ code: 'MATH 101' })],
      requirementOverrides: [
        {
          credentialId: 'test-major',
          requirementId: 'bucket',
          courseCode: 'MATH 101',
          action: 'exclude',
        },
      ],
    });
    const audit = auditDegree(profile, major, []);
    const bucket = audit.requirements.find((r) => r.requirement.id === 'bucket')!;
    expect(bucket.taken).toBe(0);
    expect(bucket.forcedOut).toBeUndefined();
  });
});

describe('override scoping', () => {
  it('overrides for another credential id do not apply', () => {
    const major = makeMajor([req({ id: 'pick-one', matchCodes: ['REAL 101'] })]);
    const profile = baseProfile({
      takenCourses: [taken({ code: 'RANDOM 200' })],
      requirementOverrides: [
        {
          credentialId: 'someone-elses-major',
          requirementId: 'pick-one',
          courseCode: 'RANDOM 200',
          action: 'include',
        },
      ],
    });
    const audit = auditDegree(profile, major, []);
    expect(audit.requirements[0].met).toBe(false);
  });

  it('requirement-style minors honor their own overrides', () => {
    const minor: Minor = {
      id: 'test-minor',
      name: 'Test Minor',
      requirements: [req({ id: 'minor-core', matchCodes: ['SI 326'] })],
    };
    const profile = baseProfile({
      takenCourses: [taken({ code: 'RANDOM 200' })],
      requirementOverrides: [
        {
          credentialId: 'test-minor',
          requirementId: 'minor-core',
          courseCode: 'RANDOM 200',
          action: 'include',
        },
      ],
    });
    const [progress] = checkMinors(profile, [minor]);
    expect(progress.complete).toBe(true);
    expect(progress.requirements?.[0].forcedIn).toEqual(['RANDOM 200']);
  });

  it('graduation blocking clears once a manual requirement is overridden to met', () => {
    const manualMajor: Major = {
      id: 'test-major',
      name: 'Test Major',
      school: 'LSA',
      goalCredits: 3,
      requirements: [req({ id: 'still-building', manual: true })],
    };
    const without = auditDegree(
      baseProfile({ takenCourses: [taken({ code: 'AAA 301' })] }),
      manualMajor,
      [],
    );
    expect(without.overallMet).toBe(false);
    const withOverride = auditDegree(
      baseProfile({
        takenCourses: [taken({ code: 'AAA 301' })],
        requirementOverrides: [
          {
            credentialId: 'test-major',
            requirementId: 'still-building',
            courseCode: 'AAA 301',
            action: 'include',
          },
        ],
      }),
      manualMajor,
      [],
    );
    expect(withOverride.overallMet).toBe(true);
  });
});
