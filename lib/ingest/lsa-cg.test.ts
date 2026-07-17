import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseListingPage,
  parseDetailPage,
  parseSubjectList,
  groupSectionsToCourses,
  toCourse,
  tagsFromDistribution,
  term,
} from './lsa-cg';

const FIXTURE = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const resultsMathHtml = FIXTURE('recon-results-math.html');
const detailMath115Html = FIXTURE('recon-detail-math115.html');
const detailMath217Html = FIXTURE('recon-detail-math217.html');
const detailMath425Html = FIXTURE('recon-detail-math425.html');
const subjectListHtml = FIXTURE('recon-subjectlist-ug.html');

describe('parseListingPage (results page)', () => {
  const sections = parseListingPage(resultsMathHtml);

  it('extracts every ClassRow on the page', () => {
    // The saved fixture is a paginated page showing hundreds of sections.
    // Ballpark check — should be plenty.
    expect(sections.length).toBeGreaterThan(50);
  });

  it('parses subject, catalog, section number, and title', () => {
    const first = sections[0];
    expect(first.subject).toBe('MATH');
    expect(first.catalog).toBe('105');
    expect(first.section).toBe('001');
    expect(first.title).toBe('Data, Functions, and Graphs');
  });

  it('parses credits', () => {
    const math105 = sections.find((s) => s.catalog === '105' && s.section === '001')!;
    expect(math105.credits).toBe(4);
  });

  it('parses the Reqs distribution codes', () => {
    const math105 = sections.find((s) => s.catalog === '105' && s.section === '001')!;
    expect(math105.distributionCodes).toEqual(['BS', 'MSA', 'QR/1']);
  });

  it('captures the detail-page URL for later fetching', () => {
    const math105 = sections.find((s) => s.catalog === '105' && s.section === '001')!;
    expect(math105.detailUrl).toContain('cg_detail.aspx?content=2610MATH105001');
  });
});

describe('groupSectionsToCourses', () => {
  const sections = parseListingPage(resultsMathHtml);
  const courses = groupSectionsToCourses(sections);

  it('dedupes many sections down to one entry per course code', () => {
    // There are way more sections than unique catalog numbers.
    expect(courses.length).toBeLessThan(sections.length);
  });

  it('counts the sections per course', () => {
    const math105 = courses.find((c) => c.catalog === '105');
    expect(math105).toBeDefined();
    expect(math105!.sectionCount).toBeGreaterThan(1);
  });

  it('produces one entry per unique (subject, catalog)', () => {
    const keys = new Set(courses.map((c) => `${c.subject} ${c.catalog}`));
    expect(keys.size).toBe(courses.length);
  });
});

describe('parseDetailPage (course detail)', () => {
  it('extracts credits and distribution codes', () => {
    const d = parseDetailPage(detailMath115Html);
    expect(d.credits).toBe(4);
    expect(d.distributionCodes).toEqual(['BS', 'MSA', 'QR/1']);
  });

  it('extracts advisory prerequisites', () => {
    const d = parseDetailPage(detailMath115Html);
    expect(d.advisoryPrereqs).toBe('Four years of high school mathematics.');
  });

  it('extracts credit exclusions', () => {
    const d = parseDetailPage(detailMath115Html);
    expect(d.creditExclusions).toContain('Math 116');
  });

  it('handles a course with cross-listing (MATH 425 / STATS 425)', () => {
    const d = parseDetailPage(detailMath425Html);
    expect(d.crossListed).toContain('STATS 425');
  });

  it('extracts advisory prereqs for MATH 217 (has actual course prereqs)', () => {
    const d = parseDetailPage(detailMath217Html);
    expect(d.advisoryPrereqs).toContain('MATH 205');
  });

  it('has a description', () => {
    const d = parseDetailPage(detailMath115Html);
    expect(d.description).toBeDefined();
    expect(d.description!.length).toBeGreaterThan(50);
  });
});

describe('tagsFromDistribution', () => {
  it('maps LSA distribution codes to planner tags', () => {
    expect(tagsFromDistribution(['MSA', 'QR/1'], 'MATH', '115')).toEqual(
      expect.arrayContaining(['lsa-math-symbolic', 'lsa-qr']),
    );
    expect(tagsFromDistribution(['HU'], 'ENGLISH', '125')).toContain('lsa-humanities');
    expect(tagsFromDistribution(['NS'], 'BIOLOGY', '171')).toContain('lsa-natural-sciences');
  });

  it('tags 300+ courses as upper-level', () => {
    expect(tagsFromDistribution([], 'MATH', '425')).toContain('upper-level');
    expect(tagsFromDistribution([], 'MATH', '115')).not.toContain('upper-level');
    expect(tagsFromDistribution([], 'PHIL', '299')).not.toContain('upper-level');
    expect(tagsFromDistribution([], 'PHIL', '300')).toContain('upper-level');
  });

  it('tags BS eligibility as lsa-bs', () => {
    expect(tagsFromDistribution(['BS', 'MSA'], 'MATH', '115')).toEqual(
      expect.arrayContaining(['lsa-bs', 'lsa-math-symbolic']),
    );
  });

  it('tags RE (LSA CG puts no ampersand) as race-ethnicity', () => {
    // LSA CG publishes the code as "RE"; keep "R&E" too for legacy input.
    expect(tagsFromDistribution(['RE'], 'AMCULT', '213')).toContain('lsa-race-ethnicity');
    expect(tagsFromDistribution(['R&E'], 'AMCULT', '213')).toContain('lsa-race-ethnicity');
  });

  it('tags Experiential courses', () => {
    expect(tagsFromDistribution(['Experiential'], 'AAS', '221')).toContain('lsa-experiential');
    expect(tagsFromDistribution(['EXP'], 'AAS', '221')).toContain('lsa-experiential');
  });

  it('does not emit raw codes as tags — only mapped ones', () => {
    // A completely unknown code should be dropped from tags.
    // (It stays in distributionCodes on the Course, which is a separate field.)
    const tags = tagsFromDistribution(['UNKNOWN_CODE'], 'MATH', '115');
    expect(tags).not.toContain('UNKNOWN_CODE');
  });
});

describe('toCourse preserves raw distributionCodes even for codes we do not map', () => {
  const sections = parseListingPage(resultsMathHtml);
  const grouped = groupSectionsToCourses(sections);
  const math115 = grouped.find((c) => c.catalog === '115')!;

  it('keeps every code from the source in distributionCodes', () => {
    const course = toCourse(math115, parseDetailPage(detailMath115Html));
    // MATH 115 has BS, MSA, QR/1 in the fixture — all must be preserved raw.
    expect(course.distributionCodes).toEqual(['BS', 'MSA', 'QR/1']);
  });
});

describe('parseSubjectList', () => {
  const subjects = parseSubjectList(subjectListHtml);

  it('extracts many unique subject codes', () => {
    expect(subjects.length).toBeGreaterThan(100);
  });

  it('includes MATH', () => {
    expect(subjects).toContain('MATH');
  });

  it('includes cross-listed non-LSA subjects (EECS, STATS, ENGLISH, etc.)', () => {
    expect(subjects).toEqual(expect.arrayContaining(['EECS', 'STATS', 'ENGLISH', 'PSYCH']));
  });

  it('returns codes uppercase, deduped, and sorted', () => {
    expect(subjects).toEqual([...subjects].sort());
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(subjects.every((s) => s === s.toUpperCase())).toBe(true);
  });
});

describe('term()', () => {
  it('computes Fall 2026 to the observed code f_26_2610', () => {
    expect(term('fall', 2026)).toEqual({ code: 'f_26_2610', label: 'Fall 2026' });
  });

  it('computes Winter 2026 to the observed code w_26_2570', () => {
    expect(term('winter', 2026)).toEqual({ code: 'w_26_2570', label: 'Winter 2026' });
  });

  it('computes Winter 2027 following the +10-per-term pattern', () => {
    expect(term('winter', 2027)).toEqual({ code: 'w_27_2620', label: 'Winter 2027' });
  });

  it('computes Fall 2025 to the anchor', () => {
    expect(term('fall', 2025).code).toBe('f_25_2560');
  });

  it('handles spring, spring/summer, and summer', () => {
    expect(term('spring', 2026).code).toBe('sp_26_2580');
    expect(term('sprsum', 2026).code).toBe('ss_26_2590');
    expect(term('summer', 2026).code).toBe('su_26_2600');
  });
});

describe('toCourse (integration)', () => {
  const sections = parseListingPage(resultsMathHtml);
  const grouped = groupSectionsToCourses(sections);
  const math115 = grouped.find((c) => c.catalog === '115')!;
  const math217 = grouped.find((c) => c.catalog === '217')!;

  it('produces a Course entry for MATH 115', () => {
    const course = toCourse(math115, parseDetailPage(detailMath115Html));
    expect(course.code).toBe('MATH 115');
    expect(course.title).toBe('Calculus I');
    expect(course.credits).toBe(4);
    expect(course.distributionCodes).toEqual(['BS', 'MSA', 'QR/1']);
    expect(course.tags).toEqual(expect.arrayContaining(['lsa-math-symbolic', 'lsa-qr']));
    expect(course.tags).not.toContain('upper-level');
    expect(course.prereqRaw).toBe('Four years of high school mathematics.');
    expect(course.description).toBeDefined();
    expect(course.description!.length).toBeGreaterThan(50);
  });

  it('captures MATH 217 prereqs', () => {
    const course = toCourse(math217, parseDetailPage(detailMath217Html));
    expect(course.prereqRaw).toContain('MATH 205');
  });

  it('tags a 400-level course as upper-level (MATH 425 hand-constructed)', () => {
    // The results fixture is only page 1 (ends at MATH 371), so MATH 425
    // isn't in `grouped`. Construct the group inline to exercise the code path.
    const course = toCourse(
      {
        subject: 'MATH',
        catalog: '425',
        title: 'Intro Probability',
        credits: 3,
        distributionCodes: ['BS'],
        detailUrl: '',
        sectionCount: 1,
      },
      parseDetailPage(detailMath425Html),
    );
    expect(course.tags).toContain('upper-level');
  });
});
