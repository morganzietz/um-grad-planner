import { describe, it, expect } from 'vitest';
import { auditDegree, projectGraduation, checkMinors } from './audit';
import type {
  Course,
  Major,
  Minor,
  PlannedTerm,
  Profile,
  TakenCourse,
} from './types';

const courseLibrary: Course[] = [
  { code: 'CS101', title: 'Intro CS', credits: 4, tags: ['cs', 'core'] },
  { code: 'CS201', title: 'Data Structures', credits: 4, tags: ['cs', 'core'] },
  { code: 'CS301', title: 'Algorithms', credits: 4, tags: ['cs'] },
  { code: 'UX101', title: 'UX Foundations', credits: 3, tags: ['ux', 'core'] },
  { code: 'UX201', title: 'UX Research', credits: 3, tags: ['ux'] },
  { code: 'UX301', title: 'Interaction Design', credits: 3, tags: ['ux'] },
  { code: 'MATH101', title: 'Calculus I', credits: 4, tags: ['math'] },
  { code: 'HIST101', title: 'World History', credits: 3, tags: ['humanities'] },
  { code: 'ART101', title: 'Drawing', credits: 3, tags: ['arts'] },
];

const major: Major = {
  id: 'ux-major',
  name: 'UX Design',
  school: 'Stamps',
  goalCredits: 24,
  requirements: [
    {
      id: 'core',
      label: 'Core courses',
      hint: 'Foundational sequence',
      need: 3,
      matchTag: 'core',
      countMode: 'count',
    },
    {
      id: 'ux-depth',
      label: 'UX depth',
      hint: 'Studio + research',
      need: 9,
      matchTag: 'ux',
      countMode: 'credits',
    },
    {
      id: 'cs-basics',
      label: 'CS basics',
      hint: 'Two CS courses',
      need: 8,
      matchTag: 'cs',
      countMode: 'credits',
    },
  ],
};

const taken: TakenCourse[] = [
  {
    code: 'CS101',
    title: 'Intro CS',
    credits: 4,
    tags: ['cs', 'core'],
    term: 'F24',
    grade: 'A',
  },
  {
    code: 'UX101',
    title: 'UX Foundations',
    credits: 3,
    tags: ['ux', 'core'],
    term: 'F24',
    grade: 'A',
  },
  {
    code: 'MATH101',
    title: 'Calculus I',
    credits: 4,
    tags: ['math'],
    term: 'W25',
    grade: 'B+',
  },
];

const plannedShort: PlannedTerm[] = [
  { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['CS201', 'UX201'] },
  { id: 'fall-2026', name: 'Fall 2026', courseCodes: ['HIST101'] },
  { id: 'winter-2027', name: 'Winter 2027', courseCodes: [] },
];

const shortProfile: Profile = {
  takenCourses: taken,
  plannedTerms: plannedShort,
  majorId: major.id,
};

describe('auditDegree', () => {
  it('matches courses by tag and segments taken vs planned', () => {
    const result = auditDegree(shortProfile, major, courseLibrary);
    const core = result.requirements.find((r) => r.requirement.id === 'core')!;
    expect(core.taken).toBe(2);
    expect(core.planned).toBe(1);
    expect(core.remaining).toBe(0);
    expect(core.met).toBe(true);
  });

  it('uses credits countMode for credit-based requirements', () => {
    const result = auditDegree(shortProfile, major, courseLibrary);
    const ux = result.requirements.find((r) => r.requirement.id === 'ux-depth')!;
    expect(ux.taken).toBe(3);
    expect(ux.planned).toBe(3);
    expect(ux.remaining).toBe(3);
    expect(ux.met).toBe(false);
  });

  it('computes overall credit summary', () => {
    const result = auditDegree(shortProfile, major, courseLibrary);
    expect(result.credits.takenCredits).toBe(11);
    expect(result.credits.plannedCredits).toBe(10);
    expect(result.credits.goalCredits).toBe(24);
    expect(result.credits.remainingCredits).toBe(3);
    expect(result.credits.met).toBe(false);
  });

  it('reports overallMet only when all requirements and credit goal are satisfied', () => {
    const result = auditDegree(shortProfile, major, courseLibrary);
    expect(result.overallMet).toBe(false);
  });

  it('does not double-count a planned course that duplicates a taken code', () => {
    const profile: Profile = {
      ...shortProfile,
      plannedTerms: [
        { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['CS101', 'UX201'] },
      ],
    };
    const result = auditDegree(profile, major, courseLibrary);
    const cs = result.requirements.find((r) => r.requirement.id === 'cs-basics')!;
    expect(cs.taken).toBe(4);
    expect(cs.planned).toBe(0);
  });

  it('ignores planned course codes missing from the library', () => {
    const profile: Profile = {
      ...shortProfile,
      plannedTerms: [
        { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['DOES_NOT_EXIST'] },
      ],
    };
    const result = auditDegree(profile, major, courseLibrary);
    expect(result.credits.plannedCredits).toBe(0);
  });
});

describe('projectGraduation', () => {
  it('returns "unmet" with missing requirements when the plan does not satisfy degree', () => {
    const result = projectGraduation(shortProfile, major, courseLibrary);
    expect(result.status).toBe('unmet');
    if (result.status === 'unmet') {
      const ids = result.missingRequirements.map((m) => m.requirementId);
      expect(ids).toContain('ux-depth');
      expect(result.missingCredits).toBe(3);
    }
  });

  it('returns the last planned term with courses when everything is satisfied', () => {
    const fullProfile: Profile = {
      ...shortProfile,
      plannedTerms: [
        { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['CS201', 'UX201'] },
        { id: 'fall-2026', name: 'Fall 2026', courseCodes: ['UX301'] },
        { id: 'winter-2027', name: 'Winter 2027', courseCodes: ['ART101'] },
      ],
    };
    const result = projectGraduation(fullProfile, major, courseLibrary);
    expect(result.status).toBe('projected');
    if (result.status === 'projected') {
      expect(result.term.id).toBe('winter-2027');
    }
  });

  it('skips empty planned terms when picking the projected term', () => {
    const fullProfile: Profile = {
      ...shortProfile,
      plannedTerms: [
        { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['CS201', 'UX201'] },
        { id: 'fall-2026', name: 'Fall 2026', courseCodes: ['UX301', 'ART101'] },
        { id: 'winter-2027', name: 'Winter 2027', courseCodes: [] },
      ],
    };
    const result = projectGraduation(fullProfile, major, courseLibrary);
    expect(result.status).toBe('projected');
    if (result.status === 'projected') {
      expect(result.term.id).toBe('fall-2026');
    }
  });

  it('picks the chronologically latest term, not the array-order last one', () => {
    const fullProfile: Profile = {
      ...shortProfile,
      plannedTerms: [
        { id: 'winter-2026', name: 'Winter 2026', courseCodes: ['CS201', 'UX201'] },
        { id: 'winter-2028', name: 'Winter 2028', courseCodes: ['UX301'] },
        { id: 'fall-2027', name: 'Fall 2027', courseCodes: ['ART101'] },
      ],
    };
    const result = projectGraduation(fullProfile, major, courseLibrary);
    expect(result.status).toBe('projected');
    if (result.status === 'projected') {
      expect(result.term.id).toBe('winter-2028');
    }
  });
});

describe('checkMinors', () => {
  const minors: Minor[] = [
    {
      id: 'ux-minor',
      name: 'UX Minor',
      requiredCodes: ['UX101', 'UX201', 'UX301', 'UX401'],
    },
    {
      id: 'math-minor',
      name: 'Math Minor',
      requiredCodes: ['MATH101', 'MATH102'],
    },
    {
      id: 'cs-tiny',
      name: 'CS Tiny',
      requiredCodes: ['CS101'],
    },
  ];

  it('counts done and remaining required codes', () => {
    const result = checkMinors(shortProfile, minors);
    const ux = result.find((m) => m.minor.id === 'ux-minor')!;
    expect(ux.done).toEqual(['UX101']);
    expect(ux.remaining).toEqual(['UX201', 'UX301', 'UX401']);
    expect(ux.complete).toBe(false);
    expect(ux.isDiscovery).toBe(false);
  });

  it('flags minors that are 1-2 courses away as discoveries', () => {
    const result = checkMinors(shortProfile, minors);
    const math = result.find((m) => m.minor.id === 'math-minor')!;
    expect(math.done).toEqual(['MATH101']);
    expect(math.remaining).toEqual(['MATH102']);
    expect(math.isDiscovery).toBe(true);
  });

  it('marks fully completed minors as complete (not discoveries)', () => {
    const result = checkMinors(shortProfile, minors);
    const tiny = result.find((m) => m.minor.id === 'cs-tiny')!;
    expect(tiny.complete).toBe(true);
    expect(tiny.isDiscovery).toBe(false);
  });

  it('satisfies a minor requiredCode via a taken course equivalentCodes', () => {
    const profile: Profile = {
      ...shortProfile,
      takenCourses: [
        ...taken,
        {
          code: 'MATH 120',
          title: 'Calc I (AP)',
          credits: 2,
          tags: ['ap-credit', 'math'],
          term: 'AP',
          grade: 'T',
          equivalentCodes: ['MATH 114'],
        },
      ],
    };
    const result = checkMinors(profile, [
      {
        id: 'cs-minor',
        name: 'CS Minor',
        requiredCodes: ['MATH 114', 'EECS 280'],
      },
    ]);
    const cs = result[0];
    expect(cs.done).toContain('MATH 114');
    expect(cs.remaining).toContain('EECS 280');
  });
});

describe('requirement matching by matchCodes', () => {
  const codedMajor: Major = {
    id: 'coded',
    name: 'Code-matched major',
    school: 'Test',
    goalCredits: 0,
    requirements: [
      {
        id: 'si-101-waivable',
        label: 'SI 101 (or EECS 183 waiver)',
        hint: '',
        need: 1,
        countMode: 'count',
        matchCodes: ['SI 101', 'EECS 183'],
      },
      {
        id: 'advanced-selectives',
        label: 'Pick 2 advanced selectives',
        hint: '',
        need: 2,
        countMode: 'count',
        matchCodes: ['SI 407', 'SI 457', 'SI 403', 'SI 413'],
      },
    ],
  };

  const lib: Course[] = [
    { code: 'SI 101', title: 'Python', credits: 4, tags: [] },
    { code: 'EECS 183', title: 'Elem Prog', credits: 4, tags: [] },
    { code: 'SI 407', title: 'Advanced Design', credits: 4, tags: [] },
    { code: 'SI 457', title: 'Advanced Dev', credits: 4, tags: [] },
    { code: 'SI 403', title: 'Adv Qual', credits: 4, tags: [] },
  ];

  it('matches a requirement when a taken course code is in matchCodes', () => {
    const profile: Profile = {
      majorId: 'coded',
      plannedTerms: [],
      takenCourses: [
        {
          code: 'EECS 183',
          title: 'Elem Prog',
          credits: 4,
          tags: [],
          term: 'F24',
          grade: 'A',
        },
      ],
    };
    const result = auditDegree(profile, codedMajor, lib);
    const waiver = result.requirements.find((r) => r.requirement.id === 'si-101-waivable')!;
    expect(waiver.taken).toBe(1);
    expect(waiver.met).toBe(true);
  });

  it('counts planned courses toward matchCodes requirements', () => {
    const profile: Profile = {
      majorId: 'coded',
      plannedTerms: [{ id: 'w27', name: 'W27', courseCodes: ['SI 407', 'SI 457'] }],
      takenCourses: [],
    };
    const result = auditDegree(profile, codedMajor, lib);
    const sel = result.requirements.find((r) => r.requirement.id === 'advanced-selectives')!;
    expect(sel.taken).toBe(0);
    expect(sel.planned).toBe(2);
    expect(sel.met).toBe(true);
  });

  it('matches via equivalentCodes on a TakenCourse (AP substitution)', () => {
    const majorWithMath114: Major = {
      id: 'm',
      name: 'M',
      school: 'T',
      goalCredits: 0,
      requirements: [
        {
          id: 'math-114',
          label: 'MATH 114',
          hint: '',
          need: 1,
          countMode: 'count',
          matchCodes: ['MATH 114'],
        },
      ],
    };
    const profile: Profile = {
      majorId: 'm',
      plannedTerms: [],
      takenCourses: [
        {
          code: 'MATH 120',
          title: 'Calc I (AP)',
          credits: 2,
          tags: ['ap-credit'],
          term: 'AP',
          grade: 'T',
          equivalentCodes: ['MATH 114'],
        },
      ],
    };
    const result = auditDegree(profile, majorWithMath114, []);
    expect(result.requirements[0].taken).toBe(1);
    expect(result.requirements[0].met).toBe(true);
  });

  it('does not double-count when a planned code matches an equivalentCode of a taken course', () => {
    const profile: Profile = {
      majorId: 'm',
      plannedTerms: [{ id: 'w27', name: 'W27', courseCodes: ['MATH 114'] }],
      takenCourses: [
        {
          code: 'MATH 120',
          title: 'Calc I (AP)',
          credits: 2,
          tags: [],
          term: 'AP',
          grade: 'T',
          equivalentCodes: ['MATH 114'],
        },
      ],
    };
    const majorWithMath114: Major = {
      id: 'm',
      name: 'M',
      school: 'T',
      goalCredits: 0,
      requirements: [
        {
          id: 'math-114',
          label: 'MATH 114',
          hint: '',
          need: 1,
          countMode: 'count',
          matchCodes: ['MATH 114'],
        },
      ],
    };
    const lib2: Course[] = [
      { code: 'MATH 114', title: 'Calc I', credits: 4, tags: [] },
    ];
    const result = auditDegree(profile, majorWithMath114, lib2);
    const r = result.requirements[0];
    expect(r.taken).toBe(1);
    expect(r.planned).toBe(0);
  });
});
