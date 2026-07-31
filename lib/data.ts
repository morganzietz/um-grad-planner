import type { Course, Minor } from './types';
import lsaData from '../data/courses/lsa.json';
import socData from '../data/courses/soc.json';
import coeBulletinData from '../data/courses/coe-bulletin.json';
import rossBulletinData from '../data/courses/ross-bulletin.json';
import umsiCatalogData from '../data/courses/umsi-catalog.json';
import { all as bundledMinors } from '../data/minors';
import {
  manualCourses,
  CS_UPPER_ELECTIVE_CODES,
  AP_CREDIT,
  NON_LSA,
  SI_CREDIT,
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
  for (const c of [...socCourses, ...coeBulletinCourses, ...rossBulletinCourses, ...umsiCatalogCourses]) {
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

