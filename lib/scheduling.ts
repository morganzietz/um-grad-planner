import type { PlannedTerm, TakenCourse, TermKind } from './types';

const KIND_OFFSETS: Record<TermKind, number> = {
  fall: 0,
  winter: 1,
  spring: 2,
  summer: 3,
};

const KIND_LABELS: Record<TermKind, string> = {
  fall: 'Fall',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
};

/**
 * Term id convention: `<kind>-<calendarYear>`, e.g. `fall-2026`, `winter-2027`.
 * Spring/Summer/Winter "year" is the calendar year they happen in (Jan-Aug),
 * even though the academic year started the prior Fall.
 */
export function formatTermId(kind: TermKind, year: number): string {
  return `${kind}-${year}`;
}

export function parseTermId(
  id: string,
): { kind: TermKind; year: number } | null {
  const m = id.match(/^(fall|winter|spring|summer)-(\d{4})$/);
  if (!m) return null;
  return { kind: m[1] as TermKind, year: parseInt(m[2], 10) };
}

export function formatTermName(id: string): string {
  const parsed = parseTermId(id);
  if (!parsed) return id;
  return `${KIND_LABELS[parsed.kind]} ${parsed.year}`;
}

/** Sortable ordinal. Lower = earlier. Same academic year groups Fall < Winter < Spring < Summer. */
export function termOrdinal(kind: TermKind, year: number): number {
  const academicYear = kind === 'fall' ? year : year - 1;
  return academicYear * 10 + KIND_OFFSETS[kind];
}

export function compareTermIds(a: string, b: string): number {
  const pa = parseTermId(a);
  const pb = parseTermId(b);
  if (!pa && !pb) return a.localeCompare(b);
  if (!pa) return 1;
  if (!pb) return -1;
  return termOrdinal(pa.kind, pa.year) - termOrdinal(pb.kind, pb.year);
}

/**
 * Generates Fall+Winter term ids covering the standard four-year-style schedule
 * from `startYear` (Fall) through `gradYear` (Winter).
 */
export function generateScheduleTermIds(
  startYear: number,
  gradYear: number,
): string[] {
  const ids: string[] = [];
  for (let y = startYear; y < gradYear; y++) {
    ids.push(formatTermId('fall', y));
    ids.push(formatTermId('winter', y + 1));
  }
  return ids;
}

/**
 * Decode the short term code stored on TakenCourse.term (e.g. "F24", "W25",
 * "Sp25", "Su26") to a canonical term id. "AP" → null (not on the timeline).
 */
export function decodeTakenTermId(s: string): string | null {
  if (s === 'AP') return null;
  const m = s.match(/^(F|W|Sp|Su)(\d{2})$/);
  if (!m) return null;
  const fullYear = parseInt(m[2], 10) + 2000;
  switch (m[1]) {
    case 'F':
      return formatTermId('fall', fullYear);
    case 'W':
      return formatTermId('winter', fullYear);
    case 'Sp':
      return formatTermId('spring', fullYear);
    case 'Su':
      return formatTermId('summer', fullYear);
    default:
      return null;
  }
}

/** Groups taken courses by canonical term id. Courses with no term mapping (e.g. AP) go to `untimed`. */
export function groupTakenByTerm(takenCourses: TakenCourse[]): {
  byTermId: Map<string, TakenCourse[]>;
  untimed: TakenCourse[];
} {
  const byTermId = new Map<string, TakenCourse[]>();
  const untimed: TakenCourse[] = [];
  for (const c of takenCourses) {
    const id = decodeTakenTermId(c.term);
    if (!id) {
      untimed.push(c);
      continue;
    }
    if (!byTermId.has(id)) byTermId.set(id, []);
    byTermId.get(id)!.push(c);
  }
  return { byTermId, untimed };
}

export interface TimelineSlot {
  id: string;
  name: string;
  kind: TermKind;
  year: number;
  status: 'taken' | 'planned' | 'extra';
  takenCourses: TakenCourse[];
  plannedCodes: string[];
}

/**
 * Builds the unified timeline of slots from start to grad, merging taken courses
 * (read-only) and planned terms (editable). Any planned term that falls outside
 * the start..grad range or has a non-Fall/Winter kind appears as `status: 'extra'`.
 */
export function buildTimeline(
  startYear: number,
  gradYear: number,
  plannedTerms: PlannedTerm[],
  takenCourses: TakenCourse[],
): TimelineSlot[] {
  const rangeIds = new Set(generateScheduleTermIds(startYear, gradYear));
  const { byTermId } = groupTakenByTerm(takenCourses);
  const plannedById = new Map(plannedTerms.map((t) => [t.id, t]));

  const allIds = new Set<string>([
    ...rangeIds,
    ...byTermId.keys(),
    ...plannedTerms.map((t) => t.id),
  ]);

  const slots: TimelineSlot[] = [];
  for (const id of allIds) {
    const parsed = parseTermId(id);
    if (!parsed) continue;
    const taken = byTermId.get(id) ?? [];
    const planned = plannedById.get(id);
    const inRange = rangeIds.has(id);
    const status: TimelineSlot['status'] =
      taken.length > 0 ? 'taken' : inRange ? 'planned' : 'extra';
    slots.push({
      id,
      name: formatTermName(id),
      kind: parsed.kind,
      year: parsed.year,
      status,
      takenCourses: taken,
      plannedCodes: planned?.courseCodes ?? [],
    });
  }

  slots.sort((a, b) => termOrdinal(a.kind, a.year) - termOrdinal(b.kind, b.year));
  return slots;
}

/** Groups timeline slots by academic year (Fall year + Winter+Spring+Summer of year+1). */
export function groupSlotsByAcademicYear(
  slots: TimelineSlot[],
): { academicYear: number; slots: TimelineSlot[] }[] {
  const buckets = new Map<number, TimelineSlot[]>();
  for (const slot of slots) {
    const ay = slot.kind === 'fall' ? slot.year : slot.year - 1;
    if (!buckets.has(ay)) buckets.set(ay, []);
    buckets.get(ay)!.push(slot);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([academicYear, slots]) => ({ academicYear, slots }));
}
