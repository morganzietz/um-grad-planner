import type { Course, Minor } from './types';
import lsaData from '../data/courses/lsa.json';
import socData from '../data/courses/soc.json';
import coeBulletinData from '../data/courses/coe-bulletin.json';
import rossBulletinData from '../data/courses/ross-bulletin.json';
import umsiCatalogData from '../data/courses/umsi-catalog.json';
import smtdCatalogData from '../data/courses/smtd-catalog.json';
import nursingCatalogData from '../data/courses/nursing-catalog.json';
import kinesCatalogData from '../data/courses/kines-catalog.json';
import sphCatalogData from '../data/courses/sph-catalog.json';
import stampsCatalogData from '../data/courses/stamps-catalog.json';
import taubmanCatalogData from '../data/courses/taubman-catalog.json';
import { all as bundledMinors } from '../data/minors';
import {
  manualCourses,
  CS_UPPER_ELECTIVE_CODES,
  AP_CREDIT,
  NON_LSA,
  SI_CREDIT,
  SMTD_CREDIT,
  SMTD_MUSIC,
  CS_DEPT,
  CS_MAJOR_UPPER,
  CS_UPPER_ELECTIVE,
  UPPER_LEVEL,
} from './courses-manual';

const scrapedCourses = (lsaData as unknown as { courses: Course[] }).courses;

/**
 * All-university courses from the official Schedule of Classes API
 * (scripts/ingest/soc.ts). Fills every school the LSA Course Guide does not
 * cover: CoE-only courses (ENGR 100, most ROB), Ross, SEAS, SPH, and so on.
 * Empty until the ingest has been run with U-M API credentials.
 */
const socCourses = (socData as unknown as { courses: Course[] }).courses ?? [];

/**
 * CoE Bulletin course listings (scripts/ingest/coe-bulletin.ts): every
 * course the College of Engineering publishes, including ones the LSA CG
 * never carries. Gap-fill under both CG and SOC.
 */
const coeBulletinCourses =
  (coeBulletinData as unknown as { courses: Course[] }).courses ?? [];

/** Ross BBA core + capstone courses from the Ross bulletin tables. */
const rossBulletinCourses =
  (rossBulletinData as unknown as { courses: Course[] }).courses ?? [];

/** Full UMSI catalog from the school's public course catalog sheet. */
const umsiCatalogCourses =
  (umsiCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** Full SMTD catalog from the school's public course-description docs. */
const smtdCatalogCourses =
  (smtdCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** School of Nursing catalog from the school's Program Plans app data. */
const nursingCatalogCourses =
  (nursingCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** School of Kinesiology catalog from the school's Drupal course catalog. */
const kinesCatalogCourses =
  (kinesCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** School of Public Health catalog from the school's course browser. */
const sphCatalogCourses =
  (sphCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** Stamps catalog from the school's course browser + archive captures. */
const stampsCatalogCourses =
  (stampsCatalogData as unknown as { courses: Course[] }).courses ?? [];

/** Taubman catalog from the college's course listing + archive captures. */
const taubmanCatalogCourses =
  (taubmanCatalogData as unknown as { courses: Course[] }).courses ?? [];

// ─── Merge scraped + manual + programmatic tags → courseCatalog ───────────

/**
 * U-M language departments. Any course from these subjects at catalog 200+ is
 * treated as a candidate for the LSA Language Requirement. LSA CG does not
 * publish a "LANG" distribution code, so we derive it here instead.
 */
const LANGUAGE_SUBJECTS: ReadonlySet<string> = new Set([
  'ARABIC', 'ARMENIAN', 'ASIAN', 'ASIANLAN', 'BCS', 'BUDDHST', 'CATALAN',
  'CHINESE', 'CZECH', 'DUTCH', 'FRENCH', 'GERMAN', 'GREEK', 'GREEKMOD',
  'HEBREW', 'HINDI', 'ITALIAN', 'JAPANESE', 'KOREAN', 'LADINO', 'LATIN',
  'PERSIAN', 'POLISH', 'PORTUG', 'ROMLANG', 'RUSSIAN', 'SCAND', 'SPANISH',
  'TURKISH', 'UKR', 'YIDDISH',
]);

/**
 * School of Public Health subjects, from the school's course browser.
 * HBEHED is the pre-rename code for Health Behavior & Health Equity (HBHEQ)
 * and is kept so older transcript imports still count as SPH credit.
 */
const SPH_SUBJECTS: ReadonlySet<string> = new Set([
  'PUBHLTH', 'BIOSTAT', 'EHS', 'EPID', 'HBHEQ', 'HBEHED', 'HMP', 'NUTR',
]);

/**
 * Required courses for the SPH bachelor's degrees, tagged so the "18 credits
 * of public health electives, outside the required courses" rule can exclude
 * them. Core = both degrees; ba/bs = that degree's required and selective
 * courses (electives for students in the other degree).
 */
const SPH_CORE_CODES: ReadonlySet<string> = new Set([
  'PUBHLTH 380', 'PUBHLTH 381', 'PUBHLTH 382', 'PUBHLTH 383', 'PUBHLTH 384',
  'PUBHLTH 481',
]);
const SPH_BA_CORE_CODES: ReadonlySet<string> = new Set([
  'PUBHLTH 350', 'PUBHLTH 360',
]);
const SPH_BS_CORE_CODES: ReadonlySet<string> = new Set([
  'PUBHLTH 370', 'PUBHLTH 305', 'PUBHLTH 310', 'PUBHLTH 311',
]);

/**
 * 200-level pre-health courses the SPH degrees accept toward the 60
 * upper-level credits, per the published upper-level elective exceptions
 * page (sph.umich.edu/undergrad/degrees/upper-level-exceptions.html).
 */
const SPH_UPPER_EXCEPTION_CODES: ReadonlySet<string> = new Set([
  'BIOLOGY 207', 'BIOLOGY 225', 'BIOLOGY 226',
  'CHEM 210', 'CHEM 211', 'CHEM 215', 'CHEM 216', 'CHEM 230', 'CHEM 260',
  'PHYSICS 126', 'PHYSICS 128', 'PHYSICS 235', 'PHYSICS 236', 'PHYSICS 240',
  'PHYSICS 241', 'PHYSICS 250', 'PHYSICS 251', 'PHYSICS 260', 'PHYSICS 261',
  'PHYSIOL 201', 'NURS 236', 'NURS 245',
]);

/**
 * Required courses for the Taubman bachelor's degrees, per the college's
 * degree pages and 2025 undergraduate booklet curriculum charts. Used to
 * keep core courses out of the "architecture elective" / "UT elective"
 * rows.
 */
const TAUBMAN_ARCH_CORE_CODES: ReadonlySet<string> = new Set([
  'ARCH 208', 'ARCH 251', 'ARCH 252', 'ARCH 253', 'ARCH 254', 'ARCH 255',
  'ARCH 256', 'ARCH 257', 'ARCH 258', 'ARCH 259', 'ARCH 312', 'ARCH 313',
  'ARCH 314', 'ARCH 316', 'ARCH 317', 'ARCH 322', 'ARCH 323', 'ARCH 324',
  'ARCH 326', 'ARCH 425', 'ARCH 432', 'ARCH 442',
]);
const TAUBMAN_UT_CORE_CODES: ReadonlySet<string> = new Set([
  'UT 102', 'UT 103', 'UT 201', 'UT 202', 'UT 210', 'UT 230', 'UT 330',
  'UT 340', 'UT 350', 'UT 360', 'UT 401', 'UT 411', 'UT 430', 'UT 435',
]);

/**
 * Life-science departments for the SPH "3 credits of life science, excluding
 * chemistry and physics" admission prerequisite. Loose by-subject membership
 * in the spirit of the schools matcher; one-off courses from other
 * departments can be force-included with the adjust control.
 */
const SPH_LIFE_SCIENCE_SUBJECTS: ReadonlySet<string> = new Set([
  'ANATOMY', 'BIOLOGY', 'EEB', 'MCDB', 'MICRBIOL', 'PHYSIOL',
]);

/**
 * Add extra tags derived from the course code — audit-engine concepts LSA CG
 * doesn't publish (UMSI credit-type, CS-department, etc.). Runs on every
 * course regardless of source.
 */
function programmaticTags(code: string): string[] {
  const [subject, catalog] = code.split(/\s+/, 2);
  const catalogNum = parseInt(catalog, 10);
  const extras: string[] = [];

  // Upper-level tag when catalog # >= 300 (scraper also does this, but we
  // re-apply so hand-authored courses without the tag get it too).
  if (Number.isFinite(catalogNum) && catalogNum >= 300) {
    extras.push(UPPER_LEVEL);
  }

  // Subject-prefix tags: `subj-english`, `subj-econ`, etc. Lowercase, ASCII.
  // Lets major reqs like "27 credits in ENGLISH courses" audit via matchTag
  // without listing every code. Upper-level variant baked in for elective reqs.
  if (subject) {
    const subj = subject.toLowerCase();
    extras.push(`subj-${subj}`);
    if (Number.isFinite(catalogNum) && catalogNum >= 300) {
      extras.push(`subj-${subj}-upper`);
    }
  }

  // All EECS courses count for the CS department (used to exclude "outside CS").
  if (subject === 'EECS') {
    extras.push(CS_DEPT);
    if (Number.isFinite(catalogNum) && catalogNum >= 300) {
      extras.push(CS_MAJOR_UPPER);
    }
    if (CS_UPPER_ELECTIVE_CODES.has(code)) {
      extras.push(CS_UPPER_ELECTIVE);
    }
  }

  // UMSI courses count for SI credit but not toward LSA distribution/credit.
  // SIABRD is UMSI's study-abroad subject and counts the same way.
  if (subject === 'SI' || subject === 'SIABRD') {
    extras.push(SI_CREDIT, NON_LSA);
  }

  // Multi-prefix major eligibility: Biology majors accept BIOLOGY/EEB/MCDB.
  // The department excludes specific courses (200-level intro-only, 300/400
  // that are just numbering placeholders, etc.); those are best trimmed later
  // via a curated exclude list rather than baked in here.
  if (subject === 'BIOLOGY' || subject === 'EEB' || subject === 'MCDB') {
    extras.push('bio-major-eligible', 'bhs-major-eligible');
    if (
      (subject === 'EEB' || subject === 'MCDB') &&
      Number.isFinite(catalogNum) &&
      catalogNum >= 300
    ) {
      extras.push('bio-upper-elective');
    }
  }

  // 4th-semester (200+) courses in a language department satisfy the LSA
  // Language Requirement.
  if (
    LANGUAGE_SUBJECTS.has(subject) &&
    Number.isFinite(catalogNum) &&
    catalogNum >= 200
  ) {
    extras.push('lsa-language');
  }

  // School of Public Health bachelor's degrees. sph-upper feeds the "45
  // upper-level credits from SPH courses" rule; sph-ph-elective the "18
  // credits of public health electives (300-level and above)" rule, which
  // explicitly includes the graduate courses open to undergraduates.
  if (SPH_SUBJECTS.has(subject)) {
    if (Number.isFinite(catalogNum) && catalogNum >= 300) {
      extras.push('sph-upper', 'sph-ph-elective');
    }
  }
  if (SPH_CORE_CODES.has(code)) extras.push('sph-core-req');
  if (SPH_BA_CORE_CODES.has(code)) extras.push('sph-ba-core');
  if (SPH_BS_CORE_CODES.has(code)) extras.push('sph-bs-core');
  // SPH 60-upper-level rule: any 300+ course anywhere at U-M, plus the
  // published 200-level pre-health exceptions and the final fourth-term
  // language course (same membership as the LSA language tag).
  if (
    (Number.isFinite(catalogNum) && catalogNum >= 300) ||
    SPH_UPPER_EXCEPTION_CODES.has(code) ||
    (LANGUAGE_SUBJECTS.has(subject) && Number.isFinite(catalogNum) && catalogNum >= 200)
  ) {
    extras.push('sph-upper-ok');
  }
  if (SPH_LIFE_SCIENCE_SUBJECTS.has(subject)) {
    extras.push('sph-life-science');
  }

  // Taubman required courses, tagged so the "architecture elective" and
  // "UT elective" rows can exclude them (subj-arch / subj-ut alone would
  // let the cores double count).
  if (TAUBMAN_ARCH_CORE_CODES.has(code)) extras.push('taubman-arch-core');
  if (TAUBMAN_UT_CORE_CODES.has(code)) extras.push('taubman-ut-core');

  // Stamps credit membership by subject (ARTDES plus the school's own
  // study-abroad subject), for the BA's Stamps/non-Stamps credit split.
  if (subject === 'ARTDES' || subject === 'ADABRD') {
    extras.push('stamps-credit');
  }
  // Engagement Studios are the ARTDES 310-319 block per the BA requirements
  // page; the designation tag from the course browser is unioned in
  // applyProgrammaticTags for anything designated outside the block.
  if (
    subject === 'ARTDES' &&
    Number.isFinite(catalogNum) &&
    catalogNum >= 310 &&
    catalogNum <= 319
  ) {
    extras.push('stamps-engagement-ok');
  }

  return extras;
}

function mergeCourse(base: Course, overlay: Partial<Course> & { code: string }): Course {
  const merged: Course = { ...base, ...overlay };
  if (overlay.tags) {
    merged.tags = Array.from(new Set([...(base.tags ?? []), ...overlay.tags]));
  }
  if (overlay.distributionCodes) {
    merged.distributionCodes = Array.from(
      new Set([...(base.distributionCodes ?? []), ...overlay.distributionCodes]),
    );
  }
  return merged;
}

// Any of these LSA distribution tags means the course counts toward the
// college-wide "30 distribution credits" total.
const LSA_DIST_TAGS = new Set([
  'lsa-humanities',
  'lsa-social-sciences',
  'lsa-natural-sciences',
  'lsa-math-symbolic',
  'lsa-interdisciplinary',
  'lsa-creative-expression',
]);

/**
 * Ross School of Business subjects. The BBA requires a minimum of 62
 * business credits and 54 non-business credits; membership is by subject.
 */
const ROSS_SUBJECTS: ReadonlySet<string> = new Set([
  'ACC', 'BA', 'BCOM', 'BE', 'BL', 'ES', 'FIN', 'MKT', 'MO', 'STRATEGY', 'TO',
]);

/**
 * SMTD subjects, from the school's Course Descriptions Index docs. SMTD
 * degrees state minimums as "X% within SMTD" / "Y liberal arts (non-SMTD)
 * credits"; membership is by subject.
 */
const SMTD_SUBJECTS: ReadonlySet<string> = new Set([
  'ARTSADMN', 'BASSOON', 'CARILLON', 'CELLO', 'CHAMBER', 'CLARINET', 'COMP',
  'CONDUCT', 'DANCE', 'DBLBASS', 'ENS', 'EUPHBARI', 'FLUTE', 'FPIANO',
  'FRENHORN', 'GUITAR', 'HARP', 'JAZZ', 'MUSED', 'MUSIC', 'MUSICOL',
  'MUSPERF', 'MUSTHTRE', 'OBOE', 'OPERA', 'ORGAN', 'ORGANLIT', 'PAT',
  'PERCUSS', 'PIANO', 'PIANOLP', 'SACREDMU', 'SAX', 'THEORY', 'THTREMUS',
  'TROMBONE', 'TRUM', 'TUBA', 'VIOLA', 'VIOLIN', 'VOICE', 'VOICELIT',
  'WELLNESS',
]);

/**
 * SMTD subjects that count as NON-Music for BM "minimum non-Music credits"
 * rules. Per the published Silent Advisors: "courses within Arts
 * Administration, Dance, and Theatre may also count as non-Music."
 */
const SMTD_NON_MUSIC_SUBJECTS: ReadonlySet<string> = new Set([
  'ARTSADMN', 'DANCE', 'THTREMUS',
]);

// CoE Intellectual Breadth: a Liberal Arts Course is marked HU or SS and not
// also marked BS, NS, or QR. ECON 101 and 102 count by explicit exception in
// the CoE Bulletin (they are SS + QR and would otherwise be excluded).
const COE_LAC_EXCLUDES = new Set(['lsa-bs', 'lsa-natural-sciences', 'lsa-qr']);

function isCoeLiberalArts(c: Course): boolean {
  if (c.code === 'ECON 101' || c.code === 'ECON 102') return true;
  const huSs =
    c.tags.includes('lsa-humanities') || c.tags.includes('lsa-social-sciences');
  return huSs && !c.tags.some((t) => COE_LAC_EXCLUDES.has(t));
}

function applyProgrammaticTags(c: Course): Course {
  const extras = programmaticTags(c.code);
  // Umbrella tag for the LSA "30 distribution credits" requirement.
  const hasAnyDist = c.tags.some((t) => LSA_DIST_TAGS.has(t));
  if (hasAnyDist) extras.push('lsa-distribution');
  // BA in Music distribution electives also accept Quantitative Reasoning
  // courses, which are not an LSA distribution area.
  if (hasAnyDist || c.tags.includes('lsa-qr')) extras.push('smtd-ba-distribution');
  if (isCoeLiberalArts(c)) {
    extras.push('coe-liberal-arts');
    const num = parseInt(c.code.split(/\s+/)[1] ?? '', 10);
    if (Number.isFinite(num) && num >= 300) extras.push('coe-liberal-arts-upper');
  }
  // Ross BBA: business-credit membership by subject; NS/MSA distribution is
  // the union of the LSA Natural Science and Math & Symbolic Analysis marks.
  if (ROSS_SUBJECTS.has(c.code.split(/\s+/)[0] ?? '')) {
    extras.push('ross-business');
  }
  // SMTD credit membership by subject. Music vs non-Music matters for the
  // BM degrees' "minimum non-Music credits" buckets.
  {
    const subj = c.code.split(/\s+/)[0] ?? '';
    // Arts Administration is an SMTD subject but the Silent Advisors state
    // its courses may count as non-SMTD; leaving smtd-credit off makes them
    // count toward non-SMTD minimums by default (force into an SMTD-credit
    // row with the adjust control if preferred).
    if (SMTD_SUBJECTS.has(subj) && subj !== 'ARTSADMN') {
      extras.push(SMTD_CREDIT);
      if (!SMTD_NON_MUSIC_SUBJECTS.has(subj)) extras.push(SMTD_MUSIC);
      // Union tag for "electives in Dance or Theatre" rules that mix subjects.
      if (subj === 'DANCE' || subj === 'THTREMUS') extras.push('smtd-dance-theatre');
    }
  }
  if (c.tags.includes('lsa-natural-sciences') || c.tags.includes('lsa-math-symbolic')) {
    extras.push('ross-ns-msa');
  }
  // UMSI upper-level credit: everything 300+, plus SI 201 and SI 261 which
  // the BSI curriculum page explicitly counts as upper-level. Checked via
  // the catalog number (not c.tags) so it holds for courses whose
  // upper-level tag is itself computed in this pass.
  {
    const num = parseInt(c.code.split(/\s+/)[1] ?? '', 10);
    if (
      (Number.isFinite(num) && num >= 300) ||
      c.code === 'SI 201' ||
      c.code === 'SI 261'
    ) {
      extras.push('umsi-upper');
    }
  }
  // Ross SS distribution counts LSA Social Science courses except ECON 101
  // and 102 (excluded by name in the BBA bulletin).
  if (
    c.tags.includes('lsa-social-sciences') &&
    c.code !== 'ECON 101' &&
    c.code !== 'ECON 102'
  ) {
    extras.push('ross-ss-dist');
  }
  // Stamps BFA/BA rules, derived from the course browser's designation tags.
  {
    const num = parseInt(c.code.split(/\s+/)[1] ?? '', 10);
    const isGradOrNonMajor =
      c.tags.includes('stamps-nonmajor') || c.tags.includes('stamps-grad');
    // Studio credit: studio-designated or Stamps study abroad, excluding
    // non-major studios and graduate (MFA/MDes) studios.
    if (
      (c.tags.includes('stamps-studio') || c.tags.includes('stamps-abroad')) &&
      !isGradOrNonMajor
    ) {
      extras.push('stamps-studio-credit');
    }
    // Elective studios, with per-level variants for the "N studios at each
    // level" rows. Study abroad is excluded (its credits apply via the
    // adjust control, capped by school policy).
    if (
      c.tags.includes('stamps-studio') &&
      c.tags.includes('stamps-elective') &&
      !isGradOrNonMajor
    ) {
      extras.push('stamps-studio-elective');
      if (Number.isFinite(num)) {
        if (num >= 200 && num <= 299) extras.push('stamps-studio-elective-200');
        if (num >= 300 && num <= 399) extras.push('stamps-studio-elective-300');
        if (num >= 400 && num <= 499) extras.push('stamps-studio-elective-400');
      }
    }
    if (c.tags.includes('stamps-engagement')) extras.push('stamps-engagement-ok');
    // Art/design history-theory-criticism electives: the school's HTC
    // designation plus any History of Art course.
    if (c.tags.includes('stamps-htc') || c.code.startsWith('HISTART ')) {
      extras.push('stamps-adhtc');
    }
    // BA upper-level writing: LSA ULWR mark or Stamps' own approved list.
    if (c.tags.includes('lsa-ulwr') || c.tags.includes('stamps-ulwr-approved')) {
      extras.push('stamps-ulwr-ok');
    }
  }
  // Analytical reasoning union (MSA or QR), used by the Stamps liberal
  // arts distribution.
  if (c.tags.includes('lsa-math-symbolic') || c.tags.includes('lsa-qr')) {
    extras.push('analytical-reasoning');
  }
  if (extras.length === 0) return c;
  return {
    ...c,
    tags: Array.from(new Set([...c.tags, ...extras])),
  };
}

function buildCatalog(): Course[] {
  const byCode = new Map<string, Course>();
  for (const c of scrapedCourses) byCode.set(c.code, c);
  // SOC fills gaps only: the LSA CG entry wins when both know a course (it
  // carries distribution tags and descriptions). A course the LSA CG does
  // NOT list is not approved for LSA credit, so SOC-only entries get the
  // non-lsa tag; without it, every Ross/CoE/SPH course would wrongly count
  // toward the LSA "100 LSA credits" college rules.
  for (const c of [...socCourses, ...coeBulletinCourses, ...rossBulletinCourses, ...umsiCatalogCourses, ...smtdCatalogCourses, ...nursingCatalogCourses, ...kinesCatalogCourses, ...sphCatalogCourses, ...stampsCatalogCourses, ...taubmanCatalogCourses]) {
    if (byCode.has(c.code)) continue;
    const tags = c.tags.includes(NON_LSA) ? c.tags : [...c.tags, NON_LSA];
    byCode.set(c.code, { ...c, tags });
  }
  for (const m of manualCourses) {
    const existing = byCode.get(m.code);
    if (existing) {
      byCode.set(m.code, mergeCourse(existing, m));
    } else {
      // Manual-only entry: title + credits are required for a valid Course.
      if (m.title === undefined || m.credits === undefined) {
        throw new Error(
          `Manual course ${m.code} is not in scrape and is missing title/credits`,
        );
      }
      byCode.set(m.code, {
        code: m.code,
        title: m.title,
        credits: m.credits,
        tags: m.tags ?? [],
        ...(m.prereqs ? { prereqs: m.prereqs } : {}),
        ...(m.sequenceNext ? { sequenceNext: m.sequenceNext } : {}),
        ...(m.placement ? { placement: m.placement } : {}),
        ...(m.prereqRaw ? { prereqRaw: m.prereqRaw } : {}),
        ...(m.distributionCodes ? { distributionCodes: m.distributionCodes } : {}),
        ...(m.description ? { description: m.description } : {}),
      });
    }
  }

  // Second pass: apply programmatic tags on every entry.
  return Array.from(byCode.values()).map(applyProgrammaticTags);
}

export const courseCatalog: Course[] = buildCatalog();

// Hand-authored minors (fully-detailed) that live alongside the bundled LSA
// stubs. These win over any LSA stub with the same id.
const HANDCRAFTED_MINORS: Minor[] = [
  {
    id: 'cs-minor',
    name: 'LSA Computer Science Minor',
    school: 'College of Literature, Science, and the Arts',
    requiredCodes: ['EECS 203', 'EECS 280', 'EECS 281'],
  },
  {
    id: 'hcai-minor',
    name: 'Human-Centered Artificial Intelligence Minor',
    school: 'University of Michigan School of Information',
    requirements: [
      {
        id: 'hcai-si-326',
        label: 'SI 326: Understanding AI',
        hint: 'Required core. Concepts, ethics, and societal impacts.',
        need: 1,
        countMode: 'count',
        matchCodes: ['SI 326'],
        category: 'core',
      },
      {
        id: 'hcai-si-376',
        label: 'SI 376: AI in Practice',
        hint: 'Required core. Co-req: SI 326.',
        need: 1,
        countMode: 'count',
        matchCodes: ['SI 376'],
        category: 'core',
      },
      {
        id: 'hcai-electives',
        label: 'Elective credits (9 total)',
        hint: 'From the HCAI-approved list: SI 212, 310, 311, 332, 346, 405, 410, 411, 434, 465; PUBPOL 240; LING 321; PHIL 340; COMM 349/362/425; ARCH 411; TO 433/438; EECS 449/492; AMCULT 202; COGSCI 446.',
        need: 9,
        countMode: 'credits',
        category: 'electives',
        matchCodes: [
          'SI 212', 'SI 310', 'SI 311', 'SI 332', 'SI 346',
          'SI 405', 'SI 410', 'SI 411', 'SI 434', 'SI 465',
          'PUBPOL 240', 'LING 321', 'PHIL 340',
          'COMM 349', 'COMM 362', 'COMM 425',
          'ARCH 411', 'TO 433', 'TO 438',
          'EECS 449', 'EECS 492',
          'AMCULT 202', 'DIGITAL 202', 'COGSCI 446',
        ],
      },
    ],
  },
];

// Merge handcrafted + LSA stubs, deduping by id (handcrafted wins).
const _minorsById = new Map<string, Minor>();
for (const m of HANDCRAFTED_MINORS) _minorsById.set(m.id, m);
for (const m of bundledMinors) if (!_minorsById.has(m.id)) _minorsById.set(m.id, m);
export const minors: Minor[] = Array.from(_minorsById.values());

