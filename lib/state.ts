'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type {
  Course,
  PlannedTerm,
  Profile,
  TakenCourse,
  TermKind,
} from './types';
import { courseCatalog } from './data';
import { formatTermId, formatTermName } from './scheduling';

// ── Storage shape ────────────────────────────────────────────────────────

/**
 * Multi-major "what-if" storage. The transcript is shared across all plans;
 * each major has its own planned terms, grad year, and minor selections.
 */
export interface AppState {
  transcript: {
    takenCourses: TakenCourse[];
    startYear?: number;
  };
  /** Plans the user has starred as favorites. Starred plans sort to the top of the home list. Multiple stars allowed. */
  starredPlanIds: string[];
  /** Per-major plans. Missing major = no plan yet. */
  majorPlans: Record<string, MajorPlan>;
}

export interface MajorPlan {
  plannedTerms: PlannedTerm[];
  gradYear?: number;
  minorIds: string[];
  /**
   * Extra majors tracked on this same plan (for double / triple majors).
   * The plan key stays the "primary" major; all tracked majors together
   * are [key, ...additionalMajorIds] and get audited independently.
   */
  additionalMajorIds?: string[];
}

const STORAGE_KEY = 'grad-planner.state.v4';
const LEGACY_KEY_V3 = 'grad-planner.profile.v3';

// ── Migration + defaults ────────────────────────────────────────────────

function seedState(): AppState {
  // Empty by default. User populates via transcript upload and picking majors.
  return {
    transcript: { takenCourses: [] },
    starredPlanIds: [],
    majorPlans: {},
  };
}

function migrateV3(v3: Profile): AppState {
  const majorId = v3.majorId;
  const majorIds = v3.majorIds ?? [majorId];
  const plans: Record<string, MajorPlan> = {};
  plans[majorId] = {
    plannedTerms: v3.plannedTerms,
    gradYear: v3.gradYear,
    minorIds: v3.minorIds ?? [],
  };
  for (const id of majorIds) {
    if (!plans[id]) {
      plans[id] = { plannedTerms: [], gradYear: v3.gradYear, minorIds: [] };
    }
  }
  return {
    transcript: {
      takenCourses: v3.takenCourses,
      startYear: v3.startYear,
    },
    starredPlanIds: [],
    majorPlans: plans,
  };
}

function safeRead(): AppState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState & { activeMajorId?: string };
      // Legacy in-shape migration: earlier v4 blobs had `activeMajorId`.
      if (!parsed.starredPlanIds) {
        parsed.starredPlanIds = parsed.activeMajorId ? [parsed.activeMajorId] : [];
      }
      delete parsed.activeMajorId;
      return backfillTranscriptEquivalents(parsed);
    }
    const legacy = window.localStorage.getItem(LEGACY_KEY_V3);
    if (legacy) {
      const migrated = migrateV3(JSON.parse(legacy) as Profile);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return backfillTranscriptEquivalents(migrated);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * On store hydration, backfill `equivalentCodes` on any already-stored taken
 * course whose code is in AP_EQUIVALENTS. Prevents users from having to
 * re-upload their transcript every time we add a new AP equivalence mapping.
 */
function backfillTranscriptEquivalents(state: AppState): AppState {
  const taken = state.transcript.takenCourses;
  let changed = false;
  const nextTaken = taken.map((c) => {
    if (c.equivalentCodes && c.equivalentCodes.length > 0) return c;
    const eq = AP_EQUIVALENTS[c.code];
    if (!eq) return c;
    changed = true;
    return { ...c, equivalentCodes: eq };
  });
  if (!changed) return state;
  return {
    ...state,
    transcript: { ...state.transcript, takenCourses: nextTaken },
  };
}

function safeWrite(state: AppState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / disabled — ignore */
  }
}

// ── Utility: parsed courses → TakenCourse[] ─────────────────────────────

export interface TranscriptResolveResult {
  taken: TakenCourse[];
  unknownCodes: string[];
}

/**
 * Look at a set of parsed courses and return the Fall calendar year that
 * anchors the earliest academic year they show up in. Used to auto-set the
 * transcript's startYear when the user uploads. Returns undefined when there
 * are no term-scoped courses.
 */
export function inferStartYear(
  parsed: { term: string }[],
): number | undefined {
  let bestAcademicYear: number | undefined;
  for (const p of parsed) {
    // Term format: F24, W25, Sp25, Su26, or AP (skip AP).
    const m = p.term.match(/^(F|W|Sp|Su)(\d{2})$/);
    if (!m) continue;
    const yy = parseInt(m[2], 10) + 2000;
    // Academic year = Fall year. Winter/Spring/Summer belong to the AY that
    // started the prior Fall.
    const academicYear = m[1] === 'F' ? yy : yy - 1;
    if (bestAcademicYear === undefined || academicYear < bestAcademicYear) {
      bestAcademicYear = academicYear;
    }
  }
  return bestAcademicYear;
}

/**
 * Turn parser output into TakenCourse entries by looking up each code in
 * the catalog. Duplicates (same code appearing twice, e.g. transfer-then-retake
 * or repeat enrollment) get collapsed to one entry so credits aren't
 * double-counted. Unknown codes are reported so the UI can flag them.
 */
/**
 * AP exam codes → equivalent U-M course codes.
 *
 * When U-M posts AP credit as its own placeholder code (rather than the real
 * course number), we need to link the two so a `matchCodes` requirement for
 * the real course counts the AP credit.
 *
 * Only codes that U-M treats as a TRUE equivalent belong here. Half-credit
 * "departmental" AP codes (ECON 101X, EECS 101X, ENGCMPTC 101X, etc.) are
 * NOT equivalent to the real full course — they only contribute raw credit
 * hours and can't be used to check off the specific-course prereq.
 *
 * If more AP mappings are needed (AP Chem, AP Physics, etc.), U-M usually
 * posts those under the real course code directly, so no equivalence entry
 * is needed — they'll match by exact code.
 */
const AP_EQUIVALENTS: Record<string, string[]> = {
  'MATH 120': ['MATH 115'], // AP Calc AB → satisfies MATH 115 requirement
  'MATH 121': ['MATH 116'], // AP Calc BC → satisfies MATH 116 requirement
};

export function resolveTranscript(
  parsed: { code: string; credits: number; grade: string; term: string }[],
  catalog: Course[] = courseCatalog,
): TranscriptResolveResult {
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const takenByCode = new Map<string, TakenCourse>();
  const unknownSet = new Set<string>();

  for (const p of parsed) {
    const c = byCode.get(p.code);
    if (!c) {
      unknownSet.add(p.code);
      continue;
    }
    const equivalents = AP_EQUIVALENTS[p.code];
    // Defensive: if the transcript put this course in the AP block but the
    // catalog stub didn't already carry the ap-credit tag, add it. Keeps
    // downstream excludeTags rules (FYWR/ULWR/R&E/QR/Distribution/In-Residence)
    // honest even when a new AP code slips into someone's transcript before
    // it's added to courses-manual.
    const baseTags = c.tags ?? [];
    const tags =
      p.term === 'AP' && !baseTags.includes('ap-credit')
        ? [...baseTags, 'ap-credit']
        : baseTags;
    const candidate: TakenCourse = {
      ...c,
      tags,
      credits: p.credits > 0 ? p.credits : c.credits,
      term: p.term,
      grade: p.grade,
      ...(equivalents ? { equivalentCodes: equivalents } : {}),
    };
    const existing = takenByCode.get(p.code);
    if (!existing) {
      takenByCode.set(p.code, candidate);
      continue;
    }
    // Same code seen before. Prefer entries that clearly count for credit:
    //   1. Non-zero credits over zero (withdrew / in-progress).
    //   2. Real letter grade over "T" transfer stub.
    //   3. Otherwise keep whichever was first (avoid churn).
    if (existing.credits === 0 && candidate.credits > 0) {
      takenByCode.set(p.code, candidate);
    } else if (existing.grade === 'T' && candidate.grade !== 'T') {
      takenByCode.set(p.code, candidate);
    }
  }

  return {
    taken: Array.from(takenByCode.values()),
    unknownCodes: Array.from(unknownSet),
  };
}

// ── Hooks ────────────────────────────────────────────────────────────────

function ensureTerm(
  plannedTerms: PlannedTerm[],
  termId: string,
): PlannedTerm[] {
  if (plannedTerms.some((t) => t.id === termId)) return plannedTerms;
  return [
    ...plannedTerms,
    { id: termId, name: formatTermName(termId), courseCodes: [] },
  ];
}

/**
 * Module-level singleton store. All hooks read/write here so they share
 * state within a single React tree. React re-renders subscribers whenever
 * setStateGlobal fires.
 *
 * (Earlier version used useState inside a hook, which meant every call to
 * useAppState() got its own independent state slot — a component using both
 * useMajorPlans and usePlannerState would see stale reads.)
 */
let storeState: AppState = seedState();
let storeHydrated = false;
const storeListeners = new Set<() => void>();

function notify(): void {
  for (const l of storeListeners) l();
}

function setStateGlobal(updater: (prev: AppState) => AppState): void {
  const next = updater(storeState);
  if (next === storeState) return;
  storeState = next;
  if (storeHydrated) safeWrite(storeState);
  notify();
}

function subscribeStore(cb: () => void): () => void {
  storeListeners.add(cb);
  return () => {
    storeListeners.delete(cb);
  };
}

// Idempotent one-time hydration from localStorage.
let hydrationEffectRan = false;

/** Core hook: raw multi-major state + hydration flag + setter. */
export interface AppStateApi {
  state: AppState;
  hydrated: boolean;
  setState: (updater: (prev: AppState) => AppState) => void;
  resetToSeed: () => void;
}

export function useAppState(): AppStateApi {
  const state = useSyncExternalStore(
    subscribeStore,
    () => storeState,
    () => storeState, // server snapshot: safe seed
  );
  const hydrated = useSyncExternalStore(
    subscribeStore,
    () => storeHydrated,
    () => false,
  );

  useEffect(() => {
    if (hydrationEffectRan) return;
    hydrationEffectRan = true;
    const stored = safeRead();
    if (stored) storeState = stored;
    storeHydrated = true;
    notify();
  }, []);

  const setState = useCallback(
    (updater: (prev: AppState) => AppState) => setStateGlobal(updater),
    [],
  );

  const resetToSeed = useCallback(() => {
    storeState = seedState();
    notify();
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
        // Also nuke the legacy v3 key — otherwise safeRead migrates it back
        // into the current key on the next refresh and your data reappears.
        window.localStorage.removeItem(LEGACY_KEY_V3);
      } catch {
        /* ignore */
      }
    }
  }, []);

  return { state, hydrated, setState, resetToSeed };
}

// ── Transcript-focused surface ──────────────────────────────────────────

export interface TranscriptApi {
  transcript: AppState['transcript'];
  hydrated: boolean;
  setTakenCourses: (taken: TakenCourse[]) => void;
  setStartYear: (year: number | undefined) => void;
}

export function useTranscript(): TranscriptApi {
  const { state, hydrated, setState } = useAppState();
  const setTakenCourses = useCallback(
    (taken: TakenCourse[]) => {
      setState((s) => ({ ...s, transcript: { ...s.transcript, takenCourses: taken } }));
    },
    [setState],
  );
  const setStartYear = useCallback(
    (year: number | undefined) => {
      setState((s) => ({ ...s, transcript: { ...s.transcript, startYear: year } }));
    },
    [setState],
  );
  return {
    transcript: state.transcript,
    hydrated,
    setTakenCourses,
    setStartYear,
  };
}

// ── Major-plan management ───────────────────────────────────────────────

export interface MajorPlansApi {
  starredPlanIds: string[];
  plans: AppState['majorPlans'];
  hydrated: boolean;
  addPlanForMajor: (majorId: string) => void;
  removePlan: (majorId: string) => void;
  toggleStar: (planId: string) => void;
  isStarred: (planId: string) => boolean;
  /**
   * Rename a plan by promoting one of its additionalMajorIds to be the new
   * primary (plan key). The old primary is discarded entirely. Used when
   * a user removes the primary major from a plan that has other majors on it.
   * No-op if `to` isn't in `plan.additionalMajorIds`.
   */
  promotePrimary: (fromMajorId: string, toMajorId: string) => void;
}

export function useMajorPlans(): MajorPlansApi {
  const { state, hydrated, setState } = useAppState();

  const addPlanForMajor = useCallback(
    (majorId: string) => {
      setState((s) => {
        if (s.majorPlans[majorId]) return s;
        return {
          ...s,
          majorPlans: {
            ...s.majorPlans,
            [majorId]: { plannedTerms: [], minorIds: [] },
          },
        };
      });
    },
    [setState],
  );

  const removePlan = useCallback(
    (majorId: string) => {
      setState((s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [majorId]: _, ...rest } = s.majorPlans;
        return {
          ...s,
          starredPlanIds: s.starredPlanIds.filter((id) => id !== majorId),
          majorPlans: rest,
        };
      });
    },
    [setState],
  );

  const toggleStar = useCallback(
    (planId: string) => {
      setState((s) => {
        const set = new Set(s.starredPlanIds);
        if (set.has(planId)) set.delete(planId);
        else set.add(planId);
        return { ...s, starredPlanIds: Array.from(set) };
      });
    },
    [setState],
  );

  const isStarred = useCallback(
    (planId: string) => state.starredPlanIds.includes(planId),
    [state.starredPlanIds],
  );

  const promotePrimary = useCallback(
    (from: string, to: string) => {
      if (from === to) return;
      setState((s) => {
        const plan = s.majorPlans[from];
        if (!plan) return s;
        const additional = plan.additionalMajorIds ?? [];
        if (!additional.includes(to)) return s;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [from]: _dropped, ...rest } = s.majorPlans;
        return {
          ...s,
          majorPlans: {
            ...rest,
            [to]: {
              ...plan,
              additionalMajorIds: additional.filter((id) => id !== to),
            },
          },
          starredPlanIds: s.starredPlanIds.map((id) => (id === from ? to : id)),
        };
      });
    },
    [setState],
  );

  return {
    starredPlanIds: state.starredPlanIds,
    plans: state.majorPlans,
    hydrated,
    addPlanForMajor,
    removePlan,
    toggleStar,
    isStarred,
    promotePrimary,
  };
}

// ── Per-major planner surface (Profile-shaped for the audit engine) ─────

export interface PlannerStateApi {
  profile: Profile;
  hydrated: boolean;
  addCourseToTerm: (termId: string, code: string) => void;
  removeCourseFromTerm: (termId: string, code: string) => void;
  addExtraTerm: (kind: TermKind, year: number) => string;
  removeTerm: (termId: string) => void;
  setGradYear: (gradYear: number) => void;
  setStartYear: (startYear: number) => void;
  addMinor: (id: string) => void;
  removeMinor: (id: string) => void;
  /** Add a second/third major to this same plan (double major flow). */
  addMajorToPlan: (majorId: string) => void;
  /** Remove a tracked major from this plan. Removing the primary is a no-op. */
  removeMajorFromPlan: (majorId: string) => void;
}

/**
 * Compose a Profile out of the shared transcript + a specific major's plan.
 * All mutations write back to that major's plan, so switching majors
 * preserves each what-if.
 */
export function usePlannerState(majorId: string): PlannerStateApi {
  const { state, hydrated, setState } = useAppState();
  const plan: MajorPlan =
    state.majorPlans[majorId] ?? { plannedTerms: [], minorIds: [] };

  const allMajorIds = [majorId, ...(plan.additionalMajorIds ?? [])];

  const profile: Profile = {
    takenCourses: state.transcript.takenCourses,
    plannedTerms: plan.plannedTerms,
    majorId,
    majorIds: allMajorIds,
    minorIds: plan.minorIds,
    startYear: state.transcript.startYear,
    gradYear: plan.gradYear,
  };

  function withPlan(updater: (prev: MajorPlan) => MajorPlan): void {
    setState((s) => {
      const current = s.majorPlans[majorId] ?? { plannedTerms: [], minorIds: [] };
      return {
        ...s,
        majorPlans: { ...s.majorPlans, [majorId]: updater(current) },
      };
    });
  }

  const addCourseToTerm = useCallback(
    (termId: string, code: string) =>
      withPlan((p) => {
        const planned = ensureTerm(p.plannedTerms, termId);
        return {
          ...p,
          plannedTerms: planned.map((t) =>
            t.id === termId && !t.courseCodes.includes(code)
              ? { ...t, courseCodes: [...t.courseCodes, code] }
              : t,
          ),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const removeCourseFromTerm = useCallback(
    (termId: string, code: string) =>
      withPlan((p) => ({
        ...p,
        plannedTerms: p.plannedTerms.map((t) =>
          t.id === termId
            ? { ...t, courseCodes: t.courseCodes.filter((c) => c !== code) }
            : t,
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const addExtraTerm = useCallback(
    (kind: TermKind, year: number): string => {
      const id = formatTermId(kind, year);
      withPlan((p) => ({ ...p, plannedTerms: ensureTerm(p.plannedTerms, id) }));
      return id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const removeTerm = useCallback(
    (termId: string) =>
      withPlan((p) => ({
        ...p,
        plannedTerms: p.plannedTerms.filter((t) => t.id !== termId),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const setGradYear = useCallback(
    (gradYear: number) => withPlan((p) => ({ ...p, gradYear })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const setStartYear = useCallback(
    (startYear: number) =>
      setState((s) => ({ ...s, transcript: { ...s.transcript, startYear } })),
    [setState],
  );

  const addMinor = useCallback(
    (id: string) =>
      withPlan((p) =>
        p.minorIds.includes(id) ? p : { ...p, minorIds: [...p.minorIds, id] },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const removeMinor = useCallback(
    (id: string) =>
      withPlan((p) => ({ ...p, minorIds: p.minorIds.filter((x) => x !== id) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const addMajorToPlan = useCallback(
    (id: string) => {
      if (id === majorId) return;
      withPlan((p) => {
        const current = p.additionalMajorIds ?? [];
        if (current.includes(id)) return p;
        return { ...p, additionalMajorIds: [...current, id] };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  const removeMajorFromPlan = useCallback(
    (id: string) => {
      if (id === majorId) return; // can't remove the primary
      withPlan((p) => ({
        ...p,
        additionalMajorIds: (p.additionalMajorIds ?? []).filter((x) => x !== id),
      }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [majorId],
  );

  return {
    profile,
    hydrated,
    addCourseToTerm,
    removeCourseFromTerm,
    addExtraTerm,
    removeTerm,
    setGradYear,
    setStartYear,
    addMinor,
    removeMinor,
    addMajorToPlan,
    removeMajorFromPlan,
  };
}

// ── Back-compat: old useProfile API for consumers not yet migrated ──────

export interface ProfileApi extends PlannerStateApi {
  addMajor: (id: string) => void;
  removeMajor: (id: string) => void;
  resetToDefault: () => void;
}

/**
 * Legacy hook. Reads the currently-active major from state and composes a
 * Profile for it. Prefer `usePlannerState(majorId)` in new code — it makes
 * the target major explicit.
 */
export function useProfile(): ProfileApi {
  const { state, resetToSeed, setState } = useAppState();
  const firstPlanId = Object.keys(state.majorPlans)[0] ?? '';
  const planner = usePlannerState(firstPlanId);

  const addMajor = useCallback(
    (id: string) => {
      setState((s) => {
        if (s.majorPlans[id]) return s;
        return {
          ...s,
          majorPlans: {
            ...s.majorPlans,
            [id]: { plannedTerms: [], minorIds: [] },
          },
        };
      });
    },
    [setState],
  );

  const removeMajor = useCallback(
    (id: string) => {
      setState((s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: _, ...rest } = s.majorPlans;
        return {
          ...s,
          starredPlanIds: s.starredPlanIds.filter((pid) => pid !== id),
          majorPlans: rest,
        };
      });
    },
    [setState],
  );

  return {
    ...planner,
    addMajor,
    removeMajor,
    resetToDefault: resetToSeed,
  };
}
