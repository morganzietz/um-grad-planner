/**
 * Functional validation of every major's requirements against the real audit
 * engine and course catalog.
 *
 * Per requirement it checks:
 *   1. Structure: unique ids, valid countMode/need, exactly one matcher kind,
 *      pickFromGroups children exist.
 *   2. matchAll is only allowed on the whitelisted LSA college-wide credit
 *      totals (the old "33 unrelated classes satisfy a major elective" bug).
 *   3. matchTag values actually exist on at least one catalog course.
 *   4. matchCodes lists resolve to at least one catalog course (codes not in
 *      the catalog are listed as warnings; they can still match transcript
 *      imports of the same code once the catalog includes them).
 *   5. Positive control: a profile made of qualifying catalog courses
 *      satisfies the requirement through auditDegree.
 *   6. Negative control: an empty profile, and a profile of deliberately
 *      unrelated courses, leave the requirement unmet.
 *
 * Run: npx tsx scripts/validate-majors.ts [majorId ...]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Course, Major, Profile, Requirement, TakenCourse } from '../lib/types';
import { auditDegree } from '../lib/audit';
import { courseCatalog } from '../lib/data';

const MAJORS_DIR = join(process.cwd(), 'data', 'majors');

const MATCH_ALL_WHITELIST = new Set([
  'whatif-rq-1843', // 120 total credits
  'whatif-rq-5600', // 100 LSA credits
  'whatif-rq-6715', // 90 excl experiential/independent
  'whatif-rq-4955', // 90 graded
  'whatif-rq-1802', // 60 in residence
  'whatif-rq-18022', // 30 while enrolled in LSA
  'whatif-rq-1850', // 60 outside dept
  // Reviewed "credits outside the department" cognate buckets: matchAll with the
  // department's subject tags excluded IS the rule (advisor approval is hint-only).
  'whatif-rq-8887', // Gender & Health cognate credits (outside WGS)
  'whatif-rq-8887-2', // Gender & Health cognate courses (outside WGS)
  'whatif-rq-6779', // ICS cognate credits (outside CHEM)
  'whatif-rq-7702', // Interdisciplinary Astronomy cognates (outside ASTRO)
  'iphys-cognates', // Interdisciplinary Physics cognates (outside PHYSICS)
  'histart-cognate-courses', // History of Art cognate course (any discipline outside HISTART)
  // Major-total buckets whose PDF text explicitly counts cognates from any
  // department (a dept-only matcher could never reach the total):
  'whatif-rq-6890', // Interdisciplinary Astronomy 31-credit total
  'whatif-rq-4094', // Interdisciplinary Physics 26-credit total
  'whatif-rq-2845', // Environment 32-credit total
  // College of Engineering shared credit totals (RG 9948 boilerplate).
  'coe-total-credits', // 128 total credits, any coursework
  'coe-general-electives', // credits to 128 beyond named requirements
  // Ross BBA credit splits (matchAll with the business tag excluded IS the rule)
  'ross-total-credits',
  'ross-non-business-credits',
  'umsi-total-credits', // BSI 120 total credits
  'smtd-bam-free-electives', // BA in Music 17 free-elective credits (any course)
  // SMTD credit splits (matchAll with the smtd tags excluded IS the rule)
  'smtd-total-credits',
  'smtd-liberal-arts-credits', // non-SMTD minimum (excludeTags smtd-credit)
  'smtd-non-music-credits', // BM non-Music minimum (excludeTags smtd-music)
  'nursing-total-credits', // BSN 128 total credits (12+ are free electives)
  'kines-total-credits', // Kinesiology 120 total credits (shared by all SoK majors)
]);

const VALID_CATEGORIES = new Set([
  'lsa-credit-min',
  'lsa-college-wide',
  'lsa-distribution',
  'lsa-add-distribution',
  'prerequisites',
  'core',
  'capstone',
  'electives',
  'major-credit-min',
  'other',
  // College of Engineering
  'coe-credit-min',
  'coe-core',
  'coe-intellectual-breadth',
  'coe-general-electives',
  // Ross School of Business
  'ross-credit-min',
  'ross-first-year',
  'ross-distribution',
  // School of Information
  'umsi-credit-min',
  // School of Music, Theatre & Dance
  'smtd-credit-min',
  'smtd-liberal-arts',
  // School of Nursing
  'nursing-credit-min',
  // School of Kinesiology
  'kines-credit-min',
  'kines-distribution',
]);

/**
 * Requirements that are accurate to the What-If PDF but cannot currently be
 * satisfied from the catalog because the LSA CG scrape only covers Fall and
 * Winter terms (e.g. spring/summer field camps). Downgraded to warnings.
 */
const KNOWN_CATALOG_GAPS = new Set([
  'whatif-rq-9701', // EES Field Experience: EARTH 440/450 run spring/summer only
  'greekmod-language-sequence', // GREEKMOD 302 not offered FA26/WN26
  'menas-core-history-443', // HISTORY 443 not offered FA26/WN26
  'polish-literature', // POLISH 325/326/432 not offered FA26/WN26
  'whatif-rq-5346', // Polish 27cr total; 2cr short with current term offerings
  'russian-core-451-499', // RUSSIAN 451/499 not offered FA26/WN26
  'coe-engr-100', // ENGR 100 absent from the LSA CG scrape (CoE-only intro course)
  // Space Sciences & Engineering program subjects absent from the LSA CG scrape
  'coe-space-sciences-and-engineering-space-462',
  'coe-space-sciences-and-engineering-space-478',
  'coe-space-sciences-and-engineering-space-405',
  // Robotics core courses absent from the LSA CG scrape (ROB subject barely covered)
  'whatif-rq-11860', // ROB 204
  'whatif-rq-11861', // ROB 310/311/314/320/330/340 core
  // Climate & Meteorology courses absent from the FA26/WN26 LSA CG scrape
  // (alternate-year and CoE-only CLIMATE offerings, verified on CLaSP + bulletin)
  'coe-climate-and-meteorology-climate-324',
  'coe-climate-and-meteorology-climate-423',
  'coe-climate-and-meteorology-climate-455',
  'coe-climate-and-meteorology-met-climate-463',
  'coe-climate-and-meteorology-met-climate-485',
  'coe-climate-and-meteorology-csi-climate-473',
  'coe-climate-and-meteorology-csi-climate-change',
]);

const allTags = new Set<string>();
for (const c of courseCatalog) for (const t of c.tags) allTags.add(t);
const catalogByCode = new Map(courseCatalog.map((c) => [c.code, c]));

/** Mirrors lib/audit.ts matchesRequirement for course selection. */
function matches(course: Course, req: Requirement): boolean {
  if (req.excludeTags && course.tags.some((t) => req.excludeTags!.includes(t))) {
    return false;
  }
  if (req.matchAll) return true;
  if (req.matchTag && course.tags.includes(req.matchTag)) return true;
  if (req.matchCodes && req.matchCodes.length > 0 && req.matchCodes.includes(course.code)) {
    return true;
  }
  return false;
}

function toTaken(c: Course): TakenCourse {
  return { ...c, term: 'FA 2024', grade: 'A' };
}

function profileOf(courses: Course[]): Profile {
  return {
    takenCourses: courses.map(toTaken),
    plannedTerms: [],
    majorId: 'x',
  };
}

/** An unrelated course that should never satisfy a non-matchAll requirement. */
const UNRELATED: Course = {
  code: 'ZZTEST 101',
  title: 'Validation Dummy',
  credits: 200,
  tags: [],
};

interface Issue {
  level: 'ERROR' | 'WARN';
  reqId: string;
  msg: string;
}

function validateMajor(major: Major): Issue[] {
  const issues: Issue[] = [];
  const push = (level: Issue['level'], reqId: string, msg: string) =>
    issues.push({ level, reqId, msg });

  if (!major.requirements || major.requirements.length === 0) {
    push('ERROR', '(file)', 'no requirements at all');
    return issues;
  }

  // ── Structure ──
  const ids = new Map<string, number>();
  for (const r of major.requirements) ids.set(r.id, (ids.get(r.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) push('ERROR', id, `duplicate id (${n}x)`);

  const byId = new Map(major.requirements.map((r) => [r.id, r]));

  // Children of a pickFromGroups parent are alternatives: an unsatisfiable
  // branch (e.g. a course the catalog doesn't carry this cycle) is tolerable
  // as long as a sibling branch works, so demote those to warnings.
  const pickChildren = new Set<string>();
  for (const r of major.requirements) {
    for (const id of r.pickFromGroups ?? []) pickChildren.add(id);
  }
  const satLevel = (reqId: string): Issue['level'] =>
    pickChildren.has(reqId) || KNOWN_CATALOG_GAPS.has(reqId) ? 'WARN' : 'ERROR';

  for (const r of major.requirements) {
    if (!(r.need > 0)) push('ERROR', r.id, `need must be > 0 (got ${r.need})`);
    if (r.countMode !== 'credits' && r.countMode !== 'count') {
      push('ERROR', r.id, `bad countMode ${r.countMode}`);
    }
    if (r.category && !VALID_CATEGORIES.has(r.category)) {
      push('WARN', r.id, `unknown category '${r.category}'`);
    }
    if (r.minGrade !== undefined && !/^[A-D][+-]?$/.test(r.minGrade)) {
      push('ERROR', r.id, `minGrade '${r.minGrade}' is not a letter grade`);
    }

    const kinds = [
      r.matchAll ? 'matchAll' : null,
      r.matchTag ? 'matchTag' : null,
      r.matchCodes !== undefined ? 'matchCodes' : null,
      r.pickFromGroups && r.pickFromGroups.length > 0 ? 'pickFromGroups' : null,
    ].filter(Boolean);
    if (r.manual) {
      // "Still building": deliberately matcher-less until an authoritative
      // list is sourced or the user overrides it. A matcher alongside the
      // flag is a contradiction.
      if (kinds.length > 0) {
        push('ERROR', r.id, `manual requirement must not carry a matcher (has ${kinds.join('+')})`);
      }
      if (!/still building/i.test(r.hint ?? '')) {
        push('WARN', r.id, 'manual requirement hint should say automatic checking is still being built');
      }
      continue;
    }
    if (kinds.length === 0) {
      push('ERROR', r.id, 'no matcher (matchTag/matchCodes/matchAll/pickFromGroups)');
      continue;
    }
    if (kinds.length > 1) {
      push('WARN', r.id, `multiple matcher kinds: ${kinds.join('+')}`);
    }

    if (r.matchAll && !MATCH_ALL_WHITELIST.has(r.id)) {
      push('ERROR', r.id, 'matchAll outside the LSA credit-total whitelist (every course would count)');
    }

    if (r.matchTag && !allTags.has(r.matchTag)) {
      push('ERROR', r.id, `matchTag '${r.matchTag}' matches zero catalog courses`);
    }

    if (r.matchCodes && r.matchCodes.length > 0) {
      const missing = r.matchCodes.filter((c) => !catalogByCode.has(c));
      if (missing.length === r.matchCodes.length) {
        push(satLevel(r.id), r.id, `none of the ${r.matchCodes.length} matchCodes exist in the catalog`);
      } else if (missing.length > 0) {
        push('WARN', r.id, `codes not in catalog (ok if future/rare): ${missing.join(', ')}`);
      }
      const badFormat = r.matchCodes.filter((c) => !/^[A-Z&]{2,10} \d{2,3}[A-Z]?$/.test(c));
      if (badFormat.length > 0) {
        push('WARN', r.id, `unusual code format: ${badFormat.join(', ')}`);
      }
    }

    if (r.pickFromGroups) {
      for (const child of r.pickFromGroups) {
        if (!byId.has(child)) push('ERROR', r.id, `pickFromGroups child '${child}' not found`);
      }
      if (r.need > r.pickFromGroups.length) {
        push('ERROR', r.id, `need ${r.need} > ${r.pickFromGroups.length} children`);
      }
    }
  }

  // ── Functional: run the real audit engine ──
  const progressOf = (profile: Profile) => {
    const audit = auditDegree(profile, major, courseCatalog);
    return new Map(audit.requirements.map((p) => [p.requirement.id, p]));
  };

  // Negative control 1: empty profile → nothing met.
  const emptyProgress = progressOf(profileOf([]));
  for (const r of major.requirements) {
    const p = emptyProgress.get(r.id)!;
    if (p.met) push('ERROR', r.id, 'met with an EMPTY profile');
  }

  // Negative control 2: one giant unrelated course → only matchAll credit
  // totals may move.
  const unrelatedProgress = progressOf(profileOf([UNRELATED]));
  for (const r of major.requirements) {
    if (r.matchAll || r.pickFromGroups) continue;
    const p = unrelatedProgress.get(r.id)!;
    if (p.taken > 0) {
      push('ERROR', r.id, 'an unrelated tagless course counted toward this requirement');
    }
  }

  // Positive control: pick qualifying catalog courses until need (+offset) is
  // reached; the requirement must then report met.
  for (const r of major.requirements) {
    if (r.pickFromGroups) continue;
    if (r.matchAll) continue; // trivially satisfiable; skip
    if (r.manual) continue; // deliberately unsatisfiable until sourced/overridden
    const target = r.need + (r.offset ?? 0);
    const picked: Course[] = [];
    let total = 0;
    for (const c of courseCatalog) {
      if (!matches(c, r)) continue;
      picked.push(c);
      total += r.countMode === 'credits' ? c.credits : 1;
      if (total >= target) break;
    }
    if (total < target) {
      push(
        satLevel(r.id),
        r.id,
        `unsatisfiable from catalog: only ${total}/${target} ${r.countMode} available` +
          (r.matchTag ? ` (tag ${r.matchTag})` : ''),
      );
      continue;
    }
    const p = progressOf(profileOf(picked)).get(r.id)!;
    if (!p.met) {
      push('ERROR', r.id, `not met even with ${picked.length} qualifying courses (${total} ${r.countMode})`);
    }
  }

  // pickFromGroups parents: satisfying `need` children must satisfy the parent.
  for (const r of major.requirements) {
    if (!r.pickFromGroups || r.pickFromGroups.length === 0) continue;
    const children = r.pickFromGroups
      .map((id) => byId.get(id))
      .filter((c): c is Requirement => !!c)
      .slice(0, r.need);
    const courses: Course[] = [];
    for (const child of children) {
      const target = child.need + (child.offset ?? 0);
      let total = 0;
      for (const c of courseCatalog) {
        if (!matches(c, child)) continue;
        if (courses.includes(c)) continue;
        courses.push(c);
        total += child.countMode === 'credits' ? c.credits : 1;
        if (total >= target) break;
      }
    }
    const p = progressOf(profileOf(courses)).get(r.id)!;
    if (!p.met) {
      push('ERROR', r.id, `pickFromGroups parent not met after satisfying ${r.need} children`);
    }
  }

  return issues;
}

function main() {
  const only = new Set(process.argv.slice(2));
  const files = readdirSync(MAJORS_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort();

  let errorCount = 0;
  let warnCount = 0;
  let cleanCount = 0;

  for (const f of files) {
    const major = JSON.parse(readFileSync(join(MAJORS_DIR, f), 'utf-8')) as Major;
    if (only.size > 0 && !only.has(major.id) && !only.has(f)) continue;
    const issues = validateMajor(major);
    const errors = issues.filter((i) => i.level === 'ERROR');
    const warns = issues.filter((i) => i.level === 'WARN');
    errorCount += errors.length;
    warnCount += warns.length;
    if (issues.length === 0) {
      cleanCount++;
      continue;
    }
    console.log(`\n${f} (${major.requirements?.length ?? 0} reqs)`);
    for (const i of issues) console.log(`  ${i.level} [${i.reqId}] ${i.msg}`);
  }

  console.log(
    `\n${cleanCount} clean majors, ${errorCount} errors, ${warnCount} warnings across ${files.length} files.`,
  );
  if (errorCount > 0) process.exit(1);
}

main();
