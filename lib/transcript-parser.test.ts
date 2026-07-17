import { describe, it, expect } from 'vitest';
import { parseTranscriptText } from './transcript-parser';

// Realistic-shape Wolverine transcript text. Not a real student's — synthetic.
const SAMPLE = `
Michigan Ross Undergraduate Program
Unofficial Transcript

FALL 2024

Course        Description                          Grade   Points   Attempted   Earned
EARTH 105     Tectonic Earth                       A-      0.925    1.00        1.00
EECS 183      Elementary Programming Concepts      A       16.000   4.00        4.00
ENGLISH 290   Themes in Language and Literature    B+      9.900    3.00        3.00
MUSICOL 121   Art of Music                         A       16.000   4.00        4.00

Term GPA: 3.7  Term Credits: 12.00

WINTER 2025

Course        Description                          Grade   Points   Attempted   Earned
EECS 203      Discrete Mathematics                 B       12.000   4.00        4.00
EECS 280      Programming and Data Structures      B       12.000   4.00        4.00
ENGLISH 125   Writing and Academic Inquiry         A       16.000   4.00        4.00
SPANISH 277   Spanish in Context                   A-      11.100   3.00        3.00

Term GPA: 3.3   Term Credits: 15.00

TRANSFER CREDIT

Course        Description                          Grade   Points   Attempted   Earned
MATH 120      Exam Calc Credit I                   T       0.000    2.00        2.00
BIOLOGY 195   Introductory Biology                 T       0.000    5.00        5.00
`;

describe('parseTranscriptText', () => {
  const result = parseTranscriptText(SAMPLE);

  it('finds every well-formed course line', () => {
    // 4 (F24) + 4 (W25) + 2 (AP) = 10
    expect(result.courses).toHaveLength(10);
  });

  it('assigns each course to the right term', () => {
    const byTerm = new Map<string, number>();
    for (const c of result.courses) {
      byTerm.set(c.term, (byTerm.get(c.term) ?? 0) + 1);
    }
    expect(byTerm.get('F24')).toBe(4);
    expect(byTerm.get('W25')).toBe(4);
    expect(byTerm.get('AP')).toBe(2);
  });

  it('extracts canonical "SUBJECT CATALOG" codes', () => {
    const codes = result.courses.map((c) => c.code);
    expect(codes).toContain('EECS 183');
    expect(codes).toContain('SPANISH 277');
    expect(codes).toContain('MATH 120');
  });

  it('parses grades verbatim (uppercased) including transfer T', () => {
    const grades = result.courses.map((c) => c.grade);
    expect(grades).toContain('A-');
    expect(grades).toContain('B+');
    expect(grades).toContain('T');
  });

  it('picks credits earned (last numeric column)', () => {
    const eecs183 = result.courses.find((c) => c.code === 'EECS 183')!;
    expect(eecs183.credits).toBe(4);
    const earth = result.courses.find((c) => c.code === 'EARTH 105')!;
    expect(earth.credits).toBe(1);
  });

  it('has no warnings on well-formed input', () => {
    expect(result.warnings).toEqual([]);
  });
});

describe('parseTranscriptText edge cases', () => {
  it('handles Spring and Summer terms', () => {
    const r = parseTranscriptText(`
SPRING 2025

MATH 217   Linear Algebra    A    16.000   4.00   4.00

SUMMER 2025

STATS 250  Intro Statistics  B+   13.800   4.00   4.00
`);
    const terms = r.courses.map((c) => c.term);
    expect(terms).toEqual(['Sp25', 'Su25']);
  });

  it('handles catalogs with letter suffixes like ECON 101X', () => {
    const r = parseTranscriptText(`
FALL 2024

ECON 101X   Departmental (AP Micro)   T   0.00   3.00   3.00
`);
    expect(r.courses[0]?.code).toBe('ECON 101X');
  });

  it('picks credits, not grade points (EARTH 105 = 1 cr, not 3.7)', () => {
    // Line has grade points 3.7 (from A-) and 1 credit earned.
    const r = parseTranscriptText(`
FALL 2024

EARTH 105  Tectonic Earth  A-  3.7  1.00  0.925
`);
    expect(r.courses[0]?.credits).toBe(1);
  });

  it('picks credits when Points comes last as a low float', () => {
    // 4-credit A- would have Points 14.8, but for a 1-credit course Points 3.7
    // could sneak past a naive < 6 cap. Ensure integer/half-integer wins.
    const r = parseTranscriptText(`
FALL 2024

MUSICOL 121  Art of Music  A  4.0  4.00  16.000
`);
    expect(r.courses[0]?.credits).toBe(4);
  });

  it('silently drops STDABRD (study abroad) courses', () => {
    const r = parseTranscriptText(`
SPRING 2025

STDABRD 312-A  Madrid Program A  A   9.000   3.00   3.00
`);
    expect(r.courses).toEqual([]);
    // No warnings either — user asked us not to acknowledge study abroad.
  });

  it('warns when there are no term headers', () => {
    const r = parseTranscriptText(`
EECS 183  Elementary Programming  A  16.000  4.00  4.00
`);
    expect(r.warnings.some((w) => w.includes('No term headers'))).toBe(true);
    expect(r.courses).toEqual([]);
  });

  it('gracefully skips prose and column headers', () => {
    const r = parseTranscriptText(`
Unofficial Transcript
Student ID: 12345

FALL 2024
Course  Description  Grade  Points  Attempted  Earned

EECS 183  Intro Programming  A  16  4  4
`);
    expect(r.courses).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it('handles W (withdrew) with 0 credits and does not warn', () => {
    const r = parseTranscriptText(`
FALL 2024
CHEM 130  General Chemistry  W  0.0  4.00  0.00
`);
    expect(r.courses[0]?.grade).toBe('W');
    expect(r.courses[0]?.credits).toBe(0);
    // W-with-0-credits is normal; shouldn't warn
    expect(r.warnings).toEqual([]);
  });

  it('preserves classes even without a description column', () => {
    // Minimal input — no description text, just code + grade + credits
    const r = parseTranscriptText(`
FALL 2024
EECS 183 Elementary Programming Concepts A 4.00
`);
    expect(r.courses[0]?.code).toBe('EECS 183');
    expect(r.courses[0]?.grade).toBe('A');
    expect(r.courses[0]?.credits).toBe(4);
  });
});
