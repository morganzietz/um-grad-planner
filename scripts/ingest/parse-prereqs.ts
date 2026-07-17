/**
 * Populate structured `prereqs` on every LSA course by parsing `prereqRaw`.
 *
 * Heuristic:
 *   1. Truncate at the first ";" — the tail is usually a note ("May not repeat...")
 *   2. Split on " and " to get AND groups.
 *   3. Within each group, extract course codes with subject inheritance
 *      (so "AAS 116 or 117" → both AAS-prefixed codes).
 *   4. Groups with no course codes get dropped — text-only clauses ("permission
 *      of instructor", "upperclass standing") are things the audit can't verify.
 *
 * Not perfect but way better than the 0% coverage we have now. Runs on the
 * LSA scrape JSON in place. Idempotent.
 *
 * Run: npx tsx scripts/ingest/parse-prereqs.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PATH = join(process.cwd(), 'data', 'courses', 'lsa.json');

function extractCodesWithInheritance(text: string): string[] {
  const codes: string[] = [];
  let subject: string | null = null;
  const tokens = /([A-Z]{2,10})\s+(\d{3}[A-Z]?)|([A-Z]{3,10})|(\d{3}[A-Z]?)/g;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(text)) !== null) {
    if (m[1] && m[2]) {
      subject = m[1];
      codes.push(`${subject} ${m[2]}`);
    } else if (m[3]) {
      subject = m[3];
    } else if (m[4] && subject) {
      codes.push(`${subject} ${m[4]}`);
    }
  }
  return codes;
}

/**
 * Reject strings that aren't real prerequisite clauses. LSA CG mixes actual
 * prereqs with post-completion restrictions ("Permission required after credit
 * earned in X"), no-credit rules ("No credit if elected after Y"), and generic
 * enrollment notes. Extracting course codes from those wrongly blocks students
 * from courses they should be able to take.
 */
function looksLikeRestriction(text: string): boolean {
  const l = text.toLowerCase();
  // Not a real prereq — post-completion restriction, disqualifier, or note.
  if (/\bpermission\s+required\b/.test(l)) return true;
  if (/\bafter\s+credit\s+earned\b/.test(l)) return true;
  if (/\bno\s+credit\b/.test(l)) return true;
  if (/\bmay\s+not\s+(?:be\s+)?(?:elect|repeat|receive)/.test(l)) return true;
  if (/\brestricted\s+to\b/.test(l)) return true;
  if (/\bcredit\s+granted\s+for\b/.test(l)) return true;
  if (/\bnot\s+open\s+to\b/.test(l)) return true;
  if (/^enrollment\b/.test(l)) return true;
  // Recommendations / suggestions, not hard prereqs.
  if (/\brecommended\b/.test(l)) return true;
  if (/\bstrongly\s+advised\b/.test(l)) return true;
  if (/\bconcurrent\b/.test(l)) return true;
  // Natural-language alternatives we can't audit precisely.
  if (/\bno\s+prior\b/.test(l)) return true;
  if (/\bno\s+previous\b/.test(l)) return true;
  if (/\bexcluding\b/.test(l)) return true;
  // "One course in Sociology or AAS 201" — the "in X" branch is unauditable.
  // BUT allow "One of the following: X, Y, Z" (which enumerates codes cleanly).
  if (/\bone\s+course\s+in\b/.test(l) && !/one\s+of\s+the\s+following/.test(l)) return true;
  return false;
}

function parsePrereqRaw(raw: string): string[][] {
  if (!raw) return [];
  const head = raw.split(';')[0].trim();

  if (looksLikeRestriction(head)) return [];

  const groups = head.split(/\s+and\s+/i);
  const out: string[][] = [];
  for (const g of groups) {
    if (looksLikeRestriction(g)) continue;
    const codes = extractCodesWithInheritance(g);
    if (codes.length > 0) {
      out.push(Array.from(new Set(codes)));
    }
  }
  return out;
}

interface Course {
  code: string;
  prereqRaw?: string;
  prereqs?: string[][];
  [key: string]: unknown;
}

const data = JSON.parse(readFileSync(PATH, 'utf-8')) as { courses: Course[] };
let updated = 0;
let stillEmpty = 0;
let cleared = 0;
for (const c of data.courses) {
  const parsed = c.prereqRaw ? parsePrereqRaw(c.prereqRaw) : [];
  // Remove self-references: a course can never be its own prerequisite.
  const filtered = parsed
    .map((group) => group.filter((code) => code !== c.code))
    .filter((group) => group.length > 0);
  const hadOld = c.prereqs && c.prereqs.length > 0;
  if (filtered.length === 0) {
    if (hadOld) {
      delete c.prereqs;
      cleared++;
    }
    if (c.prereqRaw) stillEmpty++;
    continue;
  }
  c.prereqs = filtered;
  updated++;
}

writeFileSync(PATH, JSON.stringify(data) + '\n', 'utf-8');
console.log(
  `Parsed ${updated} courses with structured prereqs. ${cleared} old buggy prereqs cleared. ${stillEmpty} had prereqRaw text but no extractable codes.`,
);
