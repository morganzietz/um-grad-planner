/**
 * Grade gating for the audit engine. A taken course only contributes to
 * requirements and credit totals when its recorded grade actually earns
 * standing: C- or better, a non-letter passing mark, or still in progress.
 * Withdrawals, incompletes, and anything below C- contribute nothing.
 */

/** Non-letter marks that earn credit. */
const PASSING_MARKS = new Set([
  'P', // pass (pass/fail election)
  'S', // satisfactory
  'T', // transfer / test credit
  'CR', // credit
  'CBE', // credit by exam
]);

/** Marks that mean the course is still underway and should count as planned-ish progress. */
const IN_PROGRESS_MARKS = new Set(['', '*', 'IP', 'Y']);

/**
 * True when a taken course with this grade counts toward requirements and
 * credit totals. Letter grades count at C- and above; D range, E/F,
 * withdrawals (W), incompletes (I), NC, and U do not.
 */
export function countsTowardRequirements(grade: string): boolean {
  const g = (grade ?? '').trim().toUpperCase();
  if (IN_PROGRESS_MARKS.has(g)) return true;
  if (PASSING_MARKS.has(g)) return true;
  // Letter grades: A+, A, A-, B+, B, B-, C+, C, C- all pass; D and below fail.
  return /^[A-C][+-]?$/.test(g);
}

/** Rank for letter-grade comparison; higher is better. E/F and marks absent. */
const GRADE_RANK: Record<string, number> = {
  'A+': 12, A: 11, 'A-': 10,
  'B+': 9, B: 8, 'B-': 7,
  'C+': 6, C: 5, 'C-': 4,
  'D+': 3, D: 2, 'D-': 1,
};

/**
 * True when a grade satisfies a requirement whose floor is `floor` (a letter
 * grade like "C" or "D"). Omitted floor falls back to the default C- gate.
 *
 * Some departments accept a D in specific requirements while others demand a
 * C; `Requirement.minGrade` carries that per-row. In-progress marks always
 * count (the course may still land any grade). Non-letter passing marks
 * (P/S/T/CR/CBE) satisfy any floor: U-M records no letter to compare, and a
 * P itself certifies C- or better. W/I/E/F/NC/U never satisfy.
 */
export function meetsGradeFloor(grade: string, floor?: string): boolean {
  const f = (floor ?? '').trim().toUpperCase();
  if (!f) return countsTowardRequirements(grade);
  const g = (grade ?? '').trim().toUpperCase();
  if (IN_PROGRESS_MARKS.has(g)) return true;
  if (PASSING_MARKS.has(g)) return true;
  const rank = GRADE_RANK[g];
  const floorRank = GRADE_RANK[f];
  if (rank === undefined || floorRank === undefined) return false;
  return rank >= floorRank;
}
