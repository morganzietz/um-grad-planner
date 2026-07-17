/**
 * Parse Wolverine Access transcript text into structured course entries.
 *
 * Wolverine's unofficial transcript has term headers followed by course rows.
 * Column layout varies, so we lean on regex over positional parsing.
 *
 * Expected shape (simplified):
 *
 *   FALL 2024
 *   EARTH 105   Tectonic Earth                      A-   0.925   1.00   1.00
 *   EECS 183    Elementary Programming Concepts     A    16.000  4.00   4.00
 *   Term GPA: 3.7  Term Credits: 12.00
 *
 *   WINTER 2025
 *   EECS 203    Discrete Mathematics                B    ...
 *
 *   TRANSFER CREDIT
 *   MATH 120    AP Calculus AB                      T    ...
 *
 * The parser is tolerant of extra whitespace, missing columns, and mixed
 * casing. Courses it can't confidently parse are reported as warnings so
 * the UI can show them for manual review.
 */

export interface ParsedCourse {
  /** Canonical code, e.g. "EECS 183". Single space between subject and catalog. */
  code: string;
  /** Credits earned. Falls back to attempted if earned is 0 (in-progress). */
  credits: number;
  /** Letter grade or short code: A/A-/B+/…/P/NP/S/U/W/I/CR/NC/T. */
  grade: string;
  /** Term code in the takenCourse convention: F24, W25, Sp25, Su26, or AP. */
  term: string;
}

export interface ParseResult {
  courses: ParsedCourse[];
  /** Human-readable notes about lines we skipped or partially parsed. */
  warnings: string[];
}

// Grade tokens U-M actually uses on transcripts.
const GRADE_TOKENS = new Set([
  'A+', 'A', 'A-',
  'B+', 'B', 'B-',
  'C+', 'C', 'C-',
  'D+', 'D', 'D-',
  'E', 'F',
  'P', 'NP',
  'S', 'U',
  'CR', 'NC',
  'W', 'I',
  'T', // transfer / AP
  'Y', // in progress
]);

const TERM_KIND_TO_PREFIX: Record<string, string> = {
  FALL: 'F',
  WINTER: 'W',
  SPRING: 'Sp',
  SUMMER: 'Su',
};

function makeTermCode(kind: string, year: number): string {
  const prefix = TERM_KIND_TO_PREFIX[kind.toUpperCase()];
  if (!prefix) return '';
  const yy = String(year).slice(-2).padStart(2, '0');
  return `${prefix}${yy}`;
}

// Term header shapes we accept. Matches "Fall 2024", "FALL TERM 2024",
// "Winter Semester 2025", "Spring/Summer 2024", "2024 Fall", and lines with
// trailing content ("Fall 2024 - Ann Arbor", "Fall Term 2024 Grade Level: SO").
const TERM_HEADER_RES: RegExp[] = [
  /^\s*(FALL|WINTER|SPRING|SUMMER)(?:\s*\/\s*SUMMER)?(?:\s+(?:TERM|SEMESTER))?\s+(\d{4})\b/i,
  // Reversed: "2024 Fall" or "2024 Fall Term"
  /^\s*(\d{4})\s+(FALL|WINTER|SPRING|SUMMER)(?:\s+(?:TERM|SEMESTER))?\b/i,
];

function matchTermHeader(
  line: string,
): { kind: string; year: number } | null {
  const m1 = line.match(TERM_HEADER_RES[0]);
  if (m1) return { kind: m1[1], year: parseInt(m1[2], 10) };
  const m2 = line.match(TERM_HEADER_RES[1]);
  if (m2) return { kind: m2[2], year: parseInt(m2[1], 10) };
  return null;
}

const TRANSFER_HEADER_RE =
  /^\s*(TRANSFER\s+CREDIT|ADVANCED\s+PLACEMENT|AP\s+CREDIT|TEST\s+CREDIT)/i;

/**
 * A "course line" starts with SUBJECT CATALOG and has, somewhere later, a
 * grade token followed by numbers (points / credits). We try a couple of
 * shapes to handle variations in column presence.
 */
const COURSE_LINE_RE = new RegExp(
  // subject: 2-10 uppercase letters/digits
  '^\\s*([A-Z][A-Z0-9]{1,9})\\s+' +
  // catalog: number (with optional suffix like 195X or 312-A)
  '([0-9]{1,4}[A-Z0-9-]*)\\s+' +
  // description: any text (non-greedy) up to the grade
  '(.+?)\\s+' +
  // grade token
  '([A-Z][+\\-]?|CR|NC|NP|Y)\\s+' +
  // one or more numeric columns (points, attempted, earned)
  '([\\d.]+(?:\\s+[\\d.]+){0,3})\\s*$',
);

/**
 * Wolverine transcript lines have several numeric columns (Grade Points,
 * Attempted, Earned, sometimes GPA-per-course). Earned credits per course
 * at U-M is always an integer or half-integer between 0 and 6. Points and
 * GPA columns are almost never integer/half-integer.
 *
 * Rule: scan from the end, return the last value that matches the
 * integer-or-half shape within [0, 6]. Only if nothing matches, fall back
 * to the raw last column.
 */
const MAX_REASONABLE_CREDITS_PER_COURSE = 6;

function isPlausibleCredits(n: number): boolean {
  if (n < 0 || n > MAX_REASONABLE_CREDITS_PER_COURSE) return false;
  // integer or .5 only (0.0, 0.5, 1.0, 1.5, ..., 6.0)
  return Math.floor(n * 2) === n * 2;
}

function pickCredits(numericCols: string): number {
  const nums = numericCols
    .trim()
    .split(/\s+/)
    .map(parseFloat)
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  for (let i = nums.length - 1; i >= 0; i--) {
    if (isPlausibleCredits(nums[i])) return nums[i];
  }
  return nums[nums.length - 1];
}

export function parseTranscriptText(raw: string): ParseResult {
  const lines = raw.split(/\r?\n/);
  const courses: ParsedCourse[] = [];
  const warnings: string[] = [];

  let currentTerm = '';
  let sawAnyTerm = false;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Term header?
    const termMatch = matchTermHeader(line);
    if (termMatch) {
      currentTerm = makeTermCode(termMatch.kind, termMatch.year);
      sawAnyTerm = true;
      continue;
    }

    // Transfer / AP block header?
    if (TRANSFER_HEADER_RE.test(line)) {
      currentTerm = 'AP';
      sawAnyTerm = true;
      continue;
    }

    // Course line?
    const m = line.match(COURSE_LINE_RE);
    if (!m) continue;
    const [, subject, catalog, , grade, numericCols] = m;

    // Silently drop study abroad courses per user preference.
    if (subject === 'STDABRD') continue;

    if (!GRADE_TOKENS.has(grade.toUpperCase()) && !GRADE_TOKENS.has(grade)) {
      warnings.push(`Skipped line (unrecognized grade "${grade}"): ${line.trim()}`);
      continue;
    }
    if (!currentTerm) {
      warnings.push(`Skipped line (no term context yet): ${line.trim()}`);
      continue;
    }

    const credits = pickCredits(numericCols);
    if (credits === 0 && grade.toUpperCase() !== 'W' && grade.toUpperCase() !== 'Y') {
      warnings.push(`Zero-credit line (kept): ${line.trim()}`);
    }

    courses.push({
      code: `${subject} ${catalog}`,
      credits,
      grade: grade.toUpperCase(),
      term: currentTerm,
    });
  }

  if (!sawAnyTerm && lines.some((l) => l.trim())) {
    warnings.push('No term headers detected. Expected e.g. "FALL 2024".');
  }

  return { courses, warnings };
}
