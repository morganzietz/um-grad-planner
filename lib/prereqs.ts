import type { Course, Profile, TakenCourse } from './types';
import { compareTermIds, formatTermId, formatTermName, parseTermId } from './scheduling';

export interface PrereqCheck {
  ok: boolean;
  /** Each unmet prereq group (any one of these codes would have satisfied it). */
  missing: string[][];
}

function expandSatisfiedCodes(takenCourses: TakenCourse[]): Set<string> {
  const set = new Set<string>();
  for (const c of takenCourses) {
    set.add(c.code);
    if (c.equivalentCodes) for (const e of c.equivalentCodes) set.add(e);
  }
  return set;
}

/**
 * Returns the set of course codes considered "completed before" the target term —
 * everything in takenCourses (regardless of term) plus everything planned in
 * strictly earlier terms.
 */
function codesBefore(
  targetTermId: string,
  profile: Profile,
): Set<string> {
  const satisfied = expandSatisfiedCodes(profile.takenCourses);
  for (const t of profile.plannedTerms) {
    if (compareTermIds(t.id, targetTermId) < 0) {
      for (const code of t.courseCodes) satisfied.add(code);
    }
  }
  return satisfied;
}

/**
 * Can `course` be added to `targetTermId`? Returns ok + list of unmet prereq groups.
 * Same-term prerequisites count as unmet (the user said: don't let me add a course
 * to the same term as a class it needs).
 */
export function checkPrereqs(
  course: Course,
  targetTermId: string,
  profile: Profile,
): PrereqCheck {
  if (!course.prereqs || course.prereqs.length === 0) {
    return { ok: true, missing: [] };
  }
  const before = codesBefore(targetTermId, profile);
  const missing: string[][] = [];
  for (const group of course.prereqs) {
    if (!group.some((c) => before.has(c))) missing.push(group);
  }
  return { ok: missing.length === 0, missing };
}

export interface AddBlock {
  reason:
    | 'already-taken'
    | 'already-planned'
    | 'missing-prereqs'
    | 'wrong-term'
    | 'not-offered-this-season';
  detail?: string;
  missing?: string[][];
  plannedTermName?: string;
  expectedTermName?: string;
  /** For 'not-offered-this-season': human-readable list of the seasons it does run in. */
  offeredSeasons?: string[];
  /** Which season was attempted. */
  attemptedSeason?: string;
}

export interface BlockForAddOptions {
  /** Skip the prereqs check (use when auto-placing a sequence successor
   *  during the same click that places its predecessor — predecessor state
   *  hasn't been committed yet). */
  skipPrereqs?: boolean;
}

/**
 * Full eligibility check for adding a course to a planned term. Returns null if OK,
 * otherwise a structured block reason that the UI can render.
 */
export function blockForAdd(
  course: Course,
  targetTermId: string,
  profile: Profile,
  plannedTermNamesById: Map<string, string>,
  options?: BlockForAddOptions,
): AddBlock | null {
  // Already taken?
  for (const t of profile.takenCourses) {
    if (
      t.code === course.code ||
      (t.equivalentCodes && t.equivalentCodes.includes(course.code))
    ) {
      return { reason: 'already-taken' };
    }
  }
  // Already planned (anywhere)?
  for (const t of profile.plannedTerms) {
    if (t.courseCodes.includes(course.code)) {
      return {
        reason: 'already-planned',
        plannedTermName: plannedTermNamesById.get(t.id) ?? t.name,
      };
    }
  }
  // Offered-season check: if we know which seasons this course runs and the
  // target term isn't one of them, block. Skips silently if offeredTerms is
  // missing (manual entries, or courses we haven't observed a term for yet).
  if (course.offeredTerms && course.offeredTerms.length > 0) {
    const parsed = parseTermId(targetTermId);
    if (parsed && !course.offeredTerms.includes(parsed.kind)) {
      const seasonLabel: Record<string, string> = {
        fall: 'Fall',
        winter: 'Winter',
        spring: 'Spring',
        summer: 'Summer',
      };
      return {
        reason: 'not-offered-this-season',
        offeredSeasons: course.offeredTerms.map((k) => seasonLabel[k] ?? k),
        attemptedSeason: seasonLabel[parsed.kind] ?? parsed.kind,
      };
    }
  }

  // Placement constraint (e.g. capstone must be in the final-year term).
  if (course.placement && profile.gradYear) {
    const expectedId =
      course.placement === 'final-fall'
        ? formatTermId('fall', profile.gradYear - 1)
        : formatTermId('winter', profile.gradYear);
    if (targetTermId !== expectedId) {
      return { reason: 'wrong-term', expectedTermName: formatTermName(expectedId) };
    }
  }
  // Prereqs satisfied?
  if (!options?.skipPrereqs) {
    const check = checkPrereqs(course, targetTermId, profile);
    if (!check.ok) {
      return { reason: 'missing-prereqs', missing: check.missing };
    }
  }
  return null;
}

export function formatBlock(block: AddBlock): string {
  switch (block.reason) {
    case 'already-taken':
      return 'Already taken';
    case 'already-planned':
      return `Already in ${block.plannedTermName ?? 'another term'}`;
    case 'missing-prereqs':
      return (
        'Needs first: ' +
        (block.missing ?? [])
          .map((g) => (g.length === 1 ? g[0] : g.join(' or ')))
          .join(', ')
      );
    case 'wrong-term':
      return `Only allowed in ${block.expectedTermName ?? 'a specific term'}`;
    case 'not-offered-this-season':
      return `Only offered in ${(block.offeredSeasons ?? []).join(' / ') || 'other seasons'}`;
  }
}
