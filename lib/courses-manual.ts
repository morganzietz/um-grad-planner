/**
 * Hand-authored course entries and overrides.
 *
 * These live on top of the scraped LSA catalog in data/courses/lsa.json.
 * Two kinds of entries mix in here:
 *
 *   1. Overrides for courses already in the scrape — carry only the fields
 *      that add to the scraped data (structured `prereqs`, `sequenceNext`,
 *      `placement`, or extra custom `tags` that LSA CG doesn't know about).
 *      The scraped title/credits/description/distributionCodes stay authoritative.
 *
 *   2. Full entries for courses NOT in the scrape — AP credit stubs,
 *      courses not offered in the scraped terms, cross-listed aliases.
 *      These require `title` and `credits` (and any other fields you need)
 *      since there's no scraped base to fall back on.
 *
 * Custom tags (below) mark audit-engine concepts that LSA CG doesn't publish
 * (UMSI credit, CS-department, etc.). Programmatic tagging in data.ts adds
 * some of these automatically based on subject prefix; explicit tags here
 * are for overrides beyond those rules.
 */
import type { Course } from './types';

// ── Custom tag constants (audit-engine vocabulary, not LSA CG's) ──────────
export const AP_CREDIT = 'ap-credit';
export const NON_LSA = 'non-lsa';
export const SI_CREDIT = 'si-credit';
export const CS_DEPT = 'cs-dept';
export const CS_MAJOR_UPPER = 'cs-major-upper';
export const CS_UPPER_ELECTIVE = 'cs-upper-elective';
export const UPPER_LEVEL = 'upper-level';

/**
 * The specific EECS courses on the LSA CS-BS "ULCS technical elective" list.
 * Not derivable from catalog number alone — comes from LSA's approved list.
 * Used by programmatic tagging in data.ts to add cs-upper-elective.
 */
export const CS_UPPER_ELECTIVE_CODES: ReadonlySet<string> = new Set([
  'EECS 367', 'EECS 373', 'EECS 388', 'EECS 390', 'EECS 404',
  'EECS 427', 'EECS 442', 'EECS 445', 'EECS 470', 'EECS 471',
  'EECS 474', 'EECS 475', 'EECS 476', 'EECS 477', 'EECS 478',
  'EECS 479', 'EECS 481', 'EECS 482', 'EECS 483', 'EECS 484',
  'EECS 485', 'EECS 486', 'EECS 487', 'EECS 489', 'EECS 490',
  'EECS 491', 'EECS 492', 'EECS 493', 'EECS 494', 'EECS 498',
]);

/**
 * Overlay entries — either full non-scraped courses OR partial overrides
 * onto scraped courses. `code` is required; other fields are merged onto
 * whatever's in the scrape (tags/distributionCodes unioned, other fields
 * override). See buildCatalog() in data.ts.
 */
export type ManualCourse = Partial<Course> & { code: string };

export const manualCourses: ManualCourse[] = [
  // ─── Structured prereqs for scraped courses ──────────────────────────
  // These live in the scrape as prose (`prereqRaw`); we translate the ones
  // the audit engine needs into AND-of-ORs. Everything else stays prose.
  { code: 'EECS 280', prereqs: [['EECS 183']] },
  { code: 'EECS 281', prereqs: [['EECS 203'], ['EECS 280']] },
  { code: 'EECS 370', prereqs: [['EECS 280']] },
  { code: 'EECS 376', prereqs: [['EECS 203'], ['EECS 280']] },

  // ULCS technical electives — most gate on EECS 281
  { code: 'EECS 367', prereqs: [['EECS 281']] },
  { code: 'EECS 388', prereqs: [['EECS 281']] },
  { code: 'EECS 390', prereqs: [['EECS 281']] },
  { code: 'EECS 442', prereqs: [['EECS 281']] },
  { code: 'EECS 445', prereqs: [['EECS 281']] },
  { code: 'EECS 474', prereqs: [['EECS 281']] },
  { code: 'EECS 475', prereqs: [['EECS 281']] },
  { code: 'EECS 476', prereqs: [['EECS 281']] },
  { code: 'EECS 477', prereqs: [['EECS 281']] },
  { code: 'EECS 481', prereqs: [['EECS 281']] },
  { code: 'EECS 484', prereqs: [['EECS 281']] },
  { code: 'EECS 485', prereqs: [['EECS 281']] },
  { code: 'EECS 486', prereqs: [['EECS 281']] },
  { code: 'EECS 492', prereqs: [['EECS 281']] },
  { code: 'EECS 493', prereqs: [['EECS 281']] },
  { code: 'EECS 494', prereqs: [['EECS 281']] },

  { code: 'EECS 373', prereqs: [['EECS 270', 'EECS 370']] },
  { code: 'EECS 427', prereqs: [['EECS 270']] },
  { code: 'EECS 470', prereqs: [['EECS 370']] },
  { code: 'EECS 471', prereqs: [['EECS 281'], ['EECS 370']] },
  { code: 'EECS 482', prereqs: [['EECS 281'], ['EECS 370']] },
  { code: 'EECS 483', prereqs: [['EECS 281'], ['EECS 370']] },
  { code: 'EECS 489', prereqs: [['EECS 281'], ['EECS 370']] },
  { code: 'EECS 491', prereqs: [['EECS 281'], ['EECS 370']] },

  { code: 'MATH 116', prereqs: [['MATH 115']] },
  { code: 'MATH 214', prereqs: [['MATH 116']] },
  { code: 'MATH 215', prereqs: [['MATH 116']] },
  { code: 'MATH 216', prereqs: [['MATH 116']] },

  // ─── Courses NOT in the Fall 2026 / Winter 2026 scrape ───────────────
  // UMSI courses that don't run in scraped terms (or run under different codes).
  { code: 'SI 201', title: 'Data-Oriented Programming', credits: 4 },
  { code: 'SI 212', title: 'Code without Coding', credits: 3 },
  // SI 261 is 200-level but LSA/UMSI treats it as upper-level for BSI credit
  { code: 'SI 261', title: 'Intro to Statistics with Applications', credits: 3, tags: [UPPER_LEVEL] },
  { code: 'SI 300', title: 'Career & Internship Studio: Design Your Success', credits: 1 },
  { code: 'SI 303', title: 'Intro to Qualitative Methods/Research', credits: 3 },
  { code: 'SI 305', title: 'Introduction to Information Analysis', credits: 3 },
  { code: 'SI 307', title: 'Intro to Design', credits: 3 },
  { code: 'SI 310', title: 'Intro to Information Ethics', credits: 3 },
  { code: 'SI 311', title: 'Generative AI + UX', credits: 1.5 },
  { code: 'SI 313', title: 'Intro to Quantitative Methods/Research', credits: 3,
    prereqs: [['SI 261', 'STATS 250'], ['SI 201', 'EECS 280', 'EECS 281']] },
  { code: 'SI 326', title: 'Understanding AI', credits: 3 },
  { code: 'SI 332', title: 'Privacy and Surveillance in the Digital Era', credits: 3 },
  { code: 'SI 342', title: 'Games & UX', credits: 3 },
  { code: 'SI 346', title: 'Information Law and Policy', credits: 3 },
  { code: 'SI 347', title: 'Human-Computer Interaction', credits: 3 },
  { code: 'SI 357', title: 'Intro to Development', credits: 3,
    prereqs: [['SI 201', 'EECS 280', 'EECS 281']] },
  { code: 'SI 376', title: 'AI in Practice: Tools and Problem Solving', credits: 3 },
  { code: 'SI 403', title: 'Advanced Qualitative Methods/Research', credits: 4,
    prereqs: [['SI 303']] },
  { code: 'SI 405', title: 'Applied Generative AI', credits: 4 },
  { code: 'SI 407', title: 'Advanced Design', credits: 4,
    prereqs: [['SI 347'], ['SI 307', 'SI 207']] },
  { code: 'SI 411', title: 'From the Beginning of Time to AI: A History of Information', credits: 3 },
  { code: 'SI 413', title: 'Advanced Quantitative Methods/Research', credits: 4,
    prereqs: [['SI 305', 'SI 313']] },
  { code: 'SI 434', title: 'Algorithms and Society', credits: 3 },
  { code: 'SI 457', title: 'Advanced Development', credits: 4,
    prereqs: [['SI 357']] },
  { code: 'SI 465', title: 'Applied Machine Learning', credits: 4 },
  { code: 'SI 485', title: 'Information Analysis Capstone I', credits: 2,
    sequenceNext: 'SI 495', placement: 'final-fall' },
  { code: 'SI 495', title: 'Information Analysis Capstone II', credits: 4,
    prereqs: [['SI 485']], placement: 'final-winter' },
  { code: 'SI 487', title: 'User Experience Capstone I', credits: 2,
    sequenceNext: 'SI 497', placement: 'final-fall' },
  { code: 'SI 497', title: 'User Experience Capstone II', credits: 4,
    prereqs: [['SI 307'], ['SI 357'], ['SI 347'], ['SI 303'], ['SI 313'], ['SI 487']],
    placement: 'final-winter' },

  // Non-UMSI courses missing from scrape
  { code: 'MUSICOL 121', title: 'Art of Music', credits: 4, tags: ['lsa-humanities'] },
  { code: 'STATS 206', title: 'Intro to Data Science', credits: 4, tags: ['lsa-math-symbolic'] },
  { code: 'ROB 101', title: 'Computational Linear Algebra', credits: 4, tags: ['lsa-qr'] },
  { code: 'TO 301', title: 'Decisions & Risk Analysis', credits: 3 },
  { code: 'TO 433', title: 'Artificial Intelligence for Business', credits: 3 },
  { code: 'TO 438', title: 'Empowering Business Decision-Making w/ Generative AI', credits: 1.5 },
  { code: 'COMM 362', title: 'Digital Media Foundations', credits: 4 },
  { code: 'COMM 425', title: 'Internet, Society, and the Law', credits: 3, tags: ['lsa-social-sciences'] },
  { code: 'BIOLOGY 195', title: 'Introductory Biology (AP)', credits: 5, tags: [AP_CREDIT] },
  // EECS courses missing from scrape (rotate through terms)
  { code: 'EECS 404', title: 'Game Engine Architecture & Data-Oriented Programming', credits: 4,
    prereqs: [['EECS 281'], ['EECS 370']] },
  { code: 'EECS 447', title: 'Machine Learning Research Experience', credits: 4,
    prereqs: [['EECS 281']] },
  { code: 'EECS 478', title: 'Logic Circuit Synthesis & Optimization', credits: 4,
    prereqs: [['EECS 270']] },
  { code: 'EECS 487', title: 'Intro to Natural Language Processing', credits: 4,
    prereqs: [['EECS 281']] },
  { code: 'EECS 490', title: 'Programming Languages', credits: 4,
    prereqs: [['EECS 281']] },

  // ─── AP / transfer credit stubs (grade T, no term) ───────────────────
  // BS-eligible = math + science subjects. Confirmed against the What-If
  // report's own BS-Eligible Credits section, which credits these codes.
  { code: 'CHEM 125', title: 'Gen Chem Lab I (AP)', credits: 1, tags: [AP_CREDIT, 'lsa-bs'] },
  { code: 'CHEM 126', title: 'Gen Chem Lab II (AP)', credits: 1, tags: [AP_CREDIT, 'lsa-bs'] },
  { code: 'CHEM 130', title: 'General Chemistry & Reaction Principles (AP)', credits: 3, tags: [AP_CREDIT, 'lsa-bs'] },
  { code: 'ECON 101X', title: 'Departmental (AP Micro)', credits: 2, tags: [AP_CREDIT] },
  { code: 'ECON 102X', title: 'Departmental (AP Macro)', credits: 2, tags: [AP_CREDIT] },
  // EECS 101X: departmental AP CS. Non-LSA but What-If counts it toward
  // BS-eligible for CS BS students.
  { code: 'EECS 101X', title: 'Departmental (AP CS)', credits: 4, tags: [AP_CREDIT, NON_LSA, 'lsa-bs'] },
  { code: 'ENGCMPTC 101X', title: 'Departmental (AP English Lang)', credits: 3, tags: [AP_CREDIT] },
  { code: 'ENGLISH 101X', title: 'Departmental (AP English Lit)', credits: 3, tags: [AP_CREDIT] },
  { code: 'GEOG 101X', title: 'Departmental (AP Human Geography)', credits: 3, tags: [AP_CREDIT] },
  { code: 'HISTORY 101X', title: 'Departmental (AP World History)', credits: 4, tags: [AP_CREDIT] },
  // MATH 120 (AP Calc AB) and MATH 121 (AP Calc BC): count as MATH 115 / 116
  // via AP_EQUIVALENTS in lib/state.ts. BS-eligible per U-M policy.
  { code: 'MATH 120', title: 'Exam Calc Credit I (AP Calc AB)', credits: 2, tags: [AP_CREDIT, 'lsa-bs'] },
  { code: 'MATH 121', title: 'Exam Calc Credit II (AP Calc BC)', credits: 2, tags: [AP_CREDIT, 'lsa-bs'] },
  { code: 'SPANISH 232', title: 'Second Year Spanish (AP)', credits: 4, tags: [AP_CREDIT] },
  { code: 'SPANISH 279X', title: 'Departmental (AP Spanish Lang)', credits: 3, tags: [AP_CREDIT] },
];
