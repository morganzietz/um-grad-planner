export type TermKind = 'fall' | 'winter' | 'spring' | 'summer';

export interface Course {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  /**
   * Course prerequisites encoded as AND-of-ORs.
   * Each outer group is required (AND). Within a group, any one code satisfies it (OR).
   * Example: SI 313 needs (SI 261 or STATS 250) AND (SI 201 or EECS 280 or EECS 281)
   *   → [['SI 261', 'STATS 250'], ['SI 201', 'EECS 280', 'EECS 281']]
   */
  prereqs?: string[][];
  /**
   * If set, this course must be followed immediately by `sequenceNext` in the
   * next planned term. The planner auto-places the follow-up when this course
   * is added. Example: SI 487 (Capstone I) → SI 497 (Capstone II).
   */
  sequenceNext?: string;
  /**
   * If set, this course can only be placed in a specific calendar slot tied to
   * the graduation year (e.g. capstone must be in the final-year Fall term).
   * `final-fall` → Fall of (gradYear - 1). `final-winter` → Winter of gradYear.
   */
  placement?: 'final-fall' | 'final-winter';
  /**
   * Raw prerequisite string as pulled from the source catalog, before parsing
   * into structured `prereqs`. Kept so we can re-parse without re-scraping.
   */
  prereqRaw?: string;
  /**
   * LSA distribution codes as published (HU, SS, NS, MSA, ID, RE, CE, ULWR, FYWR, LANG, QR).
   * Kept separate from `tags` so major-requirement matching doesn't collide
   * with distribution-requirement vocabulary.
   */
  distributionCodes?: string[];
  /**
   * Free-form course description text from the source catalog. Optional;
   * present for courses ingested from LSA CG, absent for hand-authored entries.
   */
  description?: string;
  /**
   * Seasons this course actually runs in, observed from the LSA CG scrape.
   * Used to warn when someone tries to plan a Winter-only course into a Fall
   * term. Empty / missing = we don't know (usually a manual-only entry).
   */
  offeredTerms?: TermKind[];
}

export interface TakenCourse extends Course {
  term: string;
  grade: string;
  equivalentCodes?: string[];
}

export type CountMode = 'credits' | 'count';

export interface Requirement {
  id: string;
  label: string;
  hint: string;
  need: number;
  countMode: CountMode;
  matchTag?: string;
  matchCodes?: string[];
  /** If true, every course matches (subject to excludeTags). */
  matchAll?: boolean;
  /** Courses with any of these tags are excluded from matching. */
  excludeTags?: string[];
  /**
   * Subtract this much from the raw matched total before counting toward
   * this requirement. Lets "Additional 3 cr in X" requirements only count
   * credits beyond the first 7 already used by the primary distribution.
   */
  offset?: number;
  /**
   * If set, this requirement does not match courses directly. Instead it
   * is met when `need` of the listed child requirement ids are met. Used
   * for "pick 3 of these 6 distribution areas" rules. Children referenced
   * by a met pickFromGroups parent are treated as optional for overall
   * graduation (a child reqs' unmet status doesn't block degree completion).
   */
  pickFromGroups?: string[];
  /**
   * Optional bucket key used by the UI to group requirements visually.
   * E.g. 'credit-minimums', 'prerequisites', 'core', 'capstone', 'electives'.
   */
  category?: string;
  /**
   * True when automatic checking for this rule is not implemented yet: no
   * authoritative course list could be sourced, so the requirement carries no
   * matcher (it never auto-satisfies) and the hint says checking is still
   * being built. Resolved manually until requirement overrides ship.
   */
  manual?: boolean;
  /**
   * Letter-grade floor for taken courses to count toward THIS requirement,
   * when the program states one that differs from the default C- gate.
   * "C" for departments demanding C or better; "D" where a D is accepted.
   * Non-letter passing marks and in-progress courses always count.
   */
  minGrade?: string;
  /**
   * Provenance URLs for the matcher (bulletin pages, department worksheets,
   * approved-list docs). Maintenance metadata only; never rendered in the UI.
   */
  sources?: string[];
}

export interface Major {
  id: string;
  name: string;
  school: string;
  requirements: Requirement[];
  goalCredits: number;
}

export interface Minor {
  id: string;
  name: string;
  school?: string;
  /** Legacy: simple list of required course codes. Either this or `requirements` should be set. */
  requiredCodes?: string[];
  /** Major-style requirements (count + credit buckets, matchCodes, matchTag, etc.). */
  requirements?: Requirement[];
}

export interface PlannedTerm {
  id: string;
  name: string;
  courseCodes: string[];
}

/**
 * A student correction to the audit engine's automatic matching, scoped to
 * one requirement of one credential (major or minor):
 *   - 'include': the course counts toward the requirement even though the
 *     matcher does not accept it (or the requirement is `manual` and has no
 *     matcher at all).
 *   - 'exclude': the course never counts toward the requirement even though
 *     the matcher accepts it.
 * At most one override exists per (credentialId, requirementId, courseCode);
 * setting a new action replaces the old one.
 */
export interface RequirementOverride {
  /** Major or minor id the requirement belongs to. */
  credentialId: string;
  requirementId: string;
  courseCode: string;
  action: 'include' | 'exclude';
  /** Optional user note on why the override exists. */
  note?: string;
}

export interface Profile {
  takenCourses: TakenCourse[];
  plannedTerms: PlannedTerm[];
  /** Primary major id. Kept for back-compat; UI prefers `majorIds`. */
  majorId: string;
  /** All tracked majors. Defaults to `[majorId]` if not present. */
  majorIds?: string[];
  /** Tracked minor ids. Defaults to []. */
  minorIds?: string[];
  /** Fall year the student started. Undefined for tests / audit-only use. */
  startYear?: number;
  /** Calendar year of the Winter term the student plans to graduate in. */
  gradYear?: number;
  /** Student corrections to requirement matching for this plan. */
  requirementOverrides?: RequirementOverride[];
}
