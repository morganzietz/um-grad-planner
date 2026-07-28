import type {
  Course,
  CountMode,
  Major,
  Minor,
  PlannedTerm,
  Profile,
  Requirement,
  RequirementOverride,
  TakenCourse,
} from './types';
import { compareTermIds } from './scheduling';
import { countsTowardRequirements, meetsGradeFloor } from './grades';
import {
  overrideSetsByRequirement,
  overridesForCredential,
  type OverrideSets,
} from './overrides';

export interface RequirementProgress {
  requirement: Requirement;
  taken: number;
  planned: number;
  remaining: number;
  met: boolean;
  /** Taken courses that contributed to satisfying this requirement. */
  takenContributors: TakenCourse[];
  /** Planned courses that will contribute when their term completes. */
  plannedContributors: Course[];
  /**
   * True when this requirement isn't directly met but is rolled up by a
   * met pickFromGroups parent (user chose other groups). It's still shown
   * but doesn't block overallMet.
   */
  satisfiedByParent?: boolean;
  /**
   * Codes of contributing courses that only count because the student
   * force-included them (the matcher alone would have rejected them).
   */
  forcedIn?: string[];
  /**
   * Codes of courses the matcher accepted but the student force-excluded,
   * so they were not counted.
   */
  forcedOut?: string[];
}

export interface CreditSummary {
  takenCredits: number;
  plannedCredits: number;
  goalCredits: number;
  remainingCredits: number;
  met: boolean;
}

export interface DegreeAudit {
  requirements: RequirementProgress[];
  credits: CreditSummary;
  overallMet: boolean;
}

export type GraduationProjection =
  | { status: 'projected'; term: PlannedTerm }
  | {
      status: 'unmet';
      missingRequirements: {
        requirementId: string;
        label: string;
        remaining: number;
        countMode: CountMode;
      }[];
      missingCredits: number;
    };

export interface MinorProgress {
  minor: Minor;
  done: string[];
  remaining: string[];
  isDiscovery: boolean;
  complete: boolean;
  /** Present when the minor uses the major-style requirements field. */
  requirements?: RequirementProgress[];
}

/**
 * Ids of requirements referenced as pickFromGroups children. For display
 * totals, the parent is the single countable row and its children are the
 * options behind it, so every "N requirements" count must exclude these or
 * different screens disagree on the total.
 */
export function pickGroupChildIds(requirements: Requirement[]): Set<string> {
  const out = new Set<string>();
  for (const r of requirements) {
    for (const id of r.pickFromGroups ?? []) out.add(id);
  }
  return out;
}

/** The requirements that count as top-level rows for display totals. */
export function countableRequirements(requirements: Requirement[]): Requirement[] {
  const children = pickGroupChildIds(requirements);
  return requirements.filter((r) => !children.has(r.id));
}

/** Progress rows for top-level requirements only (see countableRequirements). */
export function countableProgress(progress: RequirementProgress[]): RequirementProgress[] {
  const children = pickGroupChildIds(progress.map((p) => p.requirement));
  return progress.filter((p) => !children.has(p.requirement.id));
}

/**
 * Degree completion as a percentage of top-level requirements met, e.g.
 * 2 of 20 requirements met = 10. This is the number shown as "% complete";
 * credit totals are one requirement among many, not the whole story.
 */
export function requirementCompletionPct(progress: RequirementProgress[]): number {
  const countable = countableProgress(progress);
  if (countable.length === 0) return 0;
  const met = countable.filter((r) => r.met).length;
  return Math.round((met / countable.length) * 100);
}

/** Taken courses whose grade actually earns credit (see lib/grades.ts). */
function creditedTaken(takenCourses: TakenCourse[]): TakenCourse[] {
  return takenCourses.filter((c) => countsTowardRequirements(c.grade));
}

function contribution(course: Course, mode: CountMode): number {
  return mode === 'credits' ? course.credits : 1;
}

function courseCodes(course: Course | TakenCourse): string[] {
  const equivalents = (course as TakenCourse).equivalentCodes ?? [];
  return [course.code, ...equivalents];
}

function matchesRequirement(course: Course | TakenCourse, req: Requirement): boolean {
  // Exclusion short-circuits everything else.
  if (req.excludeTags && course.tags.some((t) => req.excludeTags!.includes(t))) {
    return false;
  }
  if (req.matchAll) return true;
  if (req.matchTag && course.tags.includes(req.matchTag)) return true;
  if (req.matchCodes && req.matchCodes.length > 0) {
    const codes = courseCodes(course);
    if (codes.some((c) => req.matchCodes!.includes(c))) return true;
  }
  return false;
}

type MatchVerdict = 'match' | 'no-match' | 'forced-in' | 'forced-out';

/**
 * Matcher result with student overrides applied. Exclude beats everything
 * (even a matching matcher); include beats everything else (even a `manual`
 * requirement with no matcher, and the requirement's excludeTags).
 */
function matchVerdict(
  course: Course | TakenCourse,
  req: Requirement,
  sets: OverrideSets | undefined,
): MatchVerdict {
  const codes = sets ? courseCodes(course) : [];
  if (sets && codes.some((c) => sets.exclude.has(c))) {
    return matchesRequirement(course, req) ? 'forced-out' : 'no-match';
  }
  const naturally = matchesRequirement(course, req);
  if (naturally) return 'match';
  if (sets && codes.some((c) => sets.include.has(c))) return 'forced-in';
  return 'no-match';
}

function takenIdentitySet(takenCourses: TakenCourse[]): Set<string> {
  const out = new Set<string>();
  for (const c of takenCourses) {
    for (const code of courseCodes(c)) out.add(code);
  }
  return out;
}

function resolvePlannedCourses(
  plannedTerms: PlannedTerm[],
  library: Course[],
  excludeCodes: Set<string>,
): Course[] {
  const byCode = new Map(library.map((c) => [c.code, c]));
  const out: Course[] = [];
  const seen = new Set<string>();
  for (const term of plannedTerms) {
    for (const code of term.courseCodes) {
      if (excludeCodes.has(code) || seen.has(code)) continue;
      const course = byCode.get(code);
      if (course) {
        out.push(course);
        seen.add(code);
      }
    }
  }
  return out;
}

function auditRequirements(
  requirements: Requirement[],
  profile: Profile,
  plannedCourses: Course[],
  overrides: RequirementOverride[] = [],
): RequirementProgress[] {
  const overrideSets = overrideSetsByRequirement(overrides);

  // Pass 1: compute course-matched requirements. pickFromGroups parents get
  // placeholders that pass 2 fills in.
  const progress: RequirementProgress[] = requirements.map((req) => {
    if (req.pickFromGroups && req.pickFromGroups.length > 0) {
      return {
        requirement: req,
        taken: 0,
        planned: 0,
        remaining: req.need,
        met: false,
        takenContributors: [],
        plannedContributors: [],
      };
    }
    const sets = overrideSets.get(req.id);
    let rawTaken = 0;
    let rawPlanned = 0;
    const takenContributors: TakenCourse[] = [];
    const plannedContributors: Course[] = [];
    const forcedIn: string[] = [];
    const forcedOut: string[] = [];
    // Per-row grade gate: the default C- floor, or the requirement's own
    // stated floor (some departments accept a D here, others demand a C).
    for (const c of profile.takenCourses.filter((t) => meetsGradeFloor(t.grade, req.minGrade))) {
      const verdict = matchVerdict(c, req, sets);
      if (verdict === 'match' || verdict === 'forced-in') {
        rawTaken += contribution(c, req.countMode);
        takenContributors.push(c);
        if (verdict === 'forced-in') forcedIn.push(c.code);
      } else if (verdict === 'forced-out') {
        forcedOut.push(c.code);
      }
    }
    for (const c of plannedCourses) {
      const verdict = matchVerdict(c, req, sets);
      if (verdict === 'match' || verdict === 'forced-in') {
        rawPlanned += contribution(c, req.countMode);
        plannedContributors.push(c);
        if (verdict === 'forced-in') forcedIn.push(c.code);
      } else if (verdict === 'forced-out') {
        forcedOut.push(c.code);
      }
    }
    const offset = req.offset ?? 0;
    const taken = Math.max(0, rawTaken - offset);
    const remainingOffset = Math.max(0, offset - rawTaken);
    const planned = Math.max(0, rawPlanned - remainingOffset);
    const remaining = Math.max(0, req.need - taken - planned);
    return {
      requirement: req,
      taken,
      planned,
      remaining,
      met: taken + planned >= req.need,
      takenContributors,
      plannedContributors,
      ...(forcedIn.length > 0 ? { forcedIn } : {}),
      ...(forcedOut.length > 0 ? { forcedOut } : {}),
    };
  });

  const byId = new Map(progress.map((p) => [p.requirement.id, p]));

  // Pass 2: compute pickFromGroups parents from their children's met status.
  // taken = children met by taken alone; planned = children met only when planned counts.
  for (const p of progress) {
    const ids = p.requirement.pickFromGroups;
    if (!ids || ids.length === 0) continue;
    let takenCount = 0;
    let plannedCount = 0;
    for (const childId of ids) {
      const child = byId.get(childId);
      if (!child) continue;
      const need = child.requirement.need;
      if (child.taken >= need) takenCount++;
      else if (child.taken + child.planned >= need) plannedCount++;
    }
    p.taken = takenCount;
    p.planned = plannedCount;
    p.met = takenCount + plannedCount >= p.requirement.need;
    p.remaining = Math.max(0, p.requirement.need - takenCount - plannedCount);
  }

  // Pass 3: mark children of met pickFromGroups parents as satisfied-by-parent
  // (so unmet children don't block overall graduation).
  for (const p of progress) {
    const ids = p.requirement.pickFromGroups;
    if (!ids || !p.met) continue;
    for (const childId of ids) {
      const child = byId.get(childId);
      if (child && !child.met) child.satisfiedByParent = true;
    }
  }

  return progress;
}

export function auditDegree(
  profile: Profile,
  major: Major,
  courseLibrary: Course[],
): DegreeAudit {
  // Only credited courses claim an identity: a withdrawn or failed attempt
  // must not block a planned retake from counting.
  const takenIdentities = takenIdentitySet(creditedTaken(profile.takenCourses));
  const plannedCourses = resolvePlannedCourses(
    profile.plannedTerms,
    courseLibrary,
    takenIdentities,
  );

  const requirements = auditRequirements(
    major.requirements,
    profile,
    plannedCourses,
    overridesForCredential(profile.requirementOverrides, major.id),
  );

  const takenCredits = creditedTaken(profile.takenCourses).reduce(
    (sum, c) => sum + c.credits,
    0,
  );
  const plannedCredits = plannedCourses.reduce((sum, c) => sum + c.credits, 0);
  const remainingCredits = Math.max(
    0,
    major.goalCredits - takenCredits - plannedCredits,
  );
  const credits: CreditSummary = {
    takenCredits,
    plannedCredits,
    goalCredits: major.goalCredits,
    remainingCredits,
    met: takenCredits + plannedCredits >= major.goalCredits,
  };

  const overallMet =
    credits.met && requirements.every((r) => r.met || r.satisfiedByParent);

  return { requirements, credits, overallMet };
}

export function projectGraduation(
  profile: Profile,
  major: Major,
  courseLibrary: Course[],
): GraduationProjection {
  const audit = auditDegree(profile, major, courseLibrary);

  if (!audit.overallMet) {
    return {
      status: 'unmet',
      missingRequirements: audit.requirements
        .filter((r) => !r.met && !r.satisfiedByParent)
        .map((r) => ({
          requirementId: r.requirement.id,
          label: r.requirement.label,
          remaining: r.remaining,
          countMode: r.requirement.countMode,
        })),
      missingCredits: audit.credits.remainingCredits,
    };
  }

  const termsWithCourses = profile.plannedTerms
    .filter((t) => t.courseCodes.length > 0)
    .slice()
    .sort((a, b) => compareTermIds(a.id, b.id));
  if (termsWithCourses.length === 0) {
    return {
      status: 'unmet',
      missingRequirements: [],
      missingCredits: audit.credits.remainingCredits,
    };
  }

  return {
    status: 'projected',
    term: termsWithCourses[termsWithCourses.length - 1],
  };
}

export function checkMinors(
  profile: Profile,
  minors: Minor[],
  courseLibrary: Course[] = [],
): MinorProgress[] {
  const takenIdentities = takenIdentitySet(creditedTaken(profile.takenCourses));
  const plannedCourses = resolvePlannedCourses(
    profile.plannedTerms,
    courseLibrary,
    takenIdentities,
  );
  return minors.map((minor) => {
    // Requirement-style minor (HCAI, etc.)
    if (minor.requirements && minor.requirements.length > 0) {
      const reqProgress = auditRequirements(
        minor.requirements,
        profile,
        plannedCourses,
        overridesForCredential(profile.requirementOverrides, minor.id),
      );
      const metReqs = reqProgress.filter((r) => r.met);
      const unmetReqs = reqProgress.filter((r) => !r.met);
      const complete = unmetReqs.length === 0;
      return {
        minor,
        done: metReqs.map((r) => r.requirement.label),
        remaining: unmetReqs.map((r) => r.requirement.label),
        complete,
        isDiscovery: !complete && unmetReqs.length <= 2,
        requirements: reqProgress,
      };
    }
    // Legacy requiredCodes-style minor
    const done: string[] = [];
    const remaining: string[] = [];
    for (const code of minor.requiredCodes ?? []) {
      if (takenIdentities.has(code)) done.push(code);
      else remaining.push(code);
    }
    const complete = remaining.length === 0;
    return {
      minor,
      done,
      remaining,
      complete,
      isDiscovery: !complete && remaining.length <= 2,
    };
  });
}
