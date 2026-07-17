/**
 * Parse every Wolverine What-If PDF in data/whatif-pdfs/ into structured
 * major-requirement JSON and merge into the existing data/majors/*.json files.
 *
 * What we extract:
 *   - Requirement Group (RG XXXX) sections: e.g. "BIOLOGY REQUIREMENTS (RG 16558)"
 *   - Requirement (RQ XXXX) items inside each group with their credit/course
 *     threshold: e.g. "Minimum 120 Total Credits (RQ 1843)   Credits: 120.00 required"
 *   - Course codes mentioned inline in the requirement label (e.g.
 *     "Biochemistry: MCDB 310, BIOLCHEM 415, or CHEM 351")
 *
 * What we deliberately skip:
 *   - Course-history / completion tables (rows like "FA 2024 BIOLOGY 195 5.00 T")
 *   - The student's personal info (name, UMID, GPA, MSH/CTP/MHP)
 *
 * Merge strategy per major JSON:
 *   - Keep the top-of-file LSA boilerplate (the fixed 18 requirements from
 *     the stub template + the add-distribution block added earlier) so the
 *     ordering and metadata don't churn.
 *   - Replace ALL major-specific requirements after that with a fresh set
 *     derived from the What-If PDF. Category is derived from the RG label.
 *
 * Slug mapping (PDF → JSON) uses the base names in
 * data/whatif-pdfs/_mapping.json plus data/majors/_whatif-overrides.json for
 * any special cases (e.g. "psychology" PDF → "lsa-psychology-general-social-science").
 *
 * Run: npx tsx scripts/ingest/whatif-parse.ts
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const PDF_DIR = join(process.cwd(), 'data', 'whatif-pdfs');
const MAJORS_DIR = join(process.cwd(), 'data', 'majors');
const OVERRIDES_PATH = join(MAJORS_DIR, '_whatif-overrides.json');
const LSA_COURSES_PATH = join(process.cwd(), 'data', 'courses', 'lsa.json');

// --- Types --------------------------------------------------------------

interface ParsedRQ {
  id: number;
  label: string;
  need: number;
  countMode: 'credits' | 'count';
  hint?: string;
  courseCodes?: string[];
  /** The section-header RQ label under which this row appeared, if any. Used
   *  during enrichment to inherit a semantic name like "Probability & Statistics"
   *  when the row itself is just a course code list. */
  parentLabel?: string;
}

interface ParsedRG {
  id: number;
  label: string;
  requirements: ParsedRQ[];
}

interface Requirement {
  id: string;
  label: string;
  hint: string;
  need: number;
  countMode: 'credits' | 'count';
  matchAll?: boolean;
  matchTag?: string;
  matchCodes?: string[];
  excludeTags?: string[];
  offset?: number;
  pickFromGroups?: string[];
  category?: string;
}

// --- PDF text extraction ------------------------------------------------

async function extractPdfText(path: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = readFileSync(path);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = '';
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      }
      line += (line ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}

// --- Parser -------------------------------------------------------------

const RG_RE = /^(.+?)\s*\(RG\s*(\d+)\)\s*$/;
// Any line with (RQ NNNN). Threshold clause is optional — if it's a completed
// requirement PSFT drops the "N required" text, so we parse the label instead.
const RQ_ANY_LINE_RE = /^(.+?)\s*\(RQ\s*(\d+)\)\s*(.*)$/;
// Sub-row: no RQ id but has an explicit "N required" threshold. Filters out
// info lines like "List of Non-LSA Courses" (no "required" clause).
const SUB_ROW_RE = /^(.+?)\s+(Credits|Courses):\s*(\d+(?:\.\d+)?)\s+required\b/;

/**
 * Try to parse a threshold from a natural-language label. Handles:
 *   "one course required"           → { need: 1, countMode: 'count' }
 *   "N courses required"            → { need: N, countMode: 'count' }
 *   "N credit(s) required"          → { need: N, countMode: 'credits' }
 *   "N credits"  (implicit require) → { need: N, countMode: 'credits' }
 *   "N-cr" / "N cr"                 → { need: N, countMode: 'credits' }
 */
function thresholdFromLabel(label: string): { need: number; countMode: 'count' | 'credits' } | null {
  if (/\bone\s+(4th\s+term\s+)?course\b/i.test(label)) return { need: 1, countMode: 'count' };
  // "N courses" with up to 4 words between (handles "2 Approved MATH Courses",
  // "1 QR1 or 2 QR2 courses", etc.). Takes first N encountered.
  const cm = label.match(/\b(\d+)(?:\s+\S+){0,4}\s+courses?\b/i);
  if (cm) return { need: parseInt(cm[1], 10), countMode: 'count' };
  // "N credits" with up to 4 words between ("15 Total ULCS Elective Credits").
  const cr = label.match(/\b(\d+)(?:\s+\S+){0,4}\s+(?:credits?|cr)\b/i);
  if (cr) return { need: parseInt(cr[1], 10), countMode: 'credits' };
  return null;
}

/**
 * Detect a "specific course + C or better" line. When PSFT records a prereq
 * or core that's already been satisfied, it drops the "Courses: N required"
 * tail and just shows the completing course inline. Those requirement lines
 * still have "C or better" (or "C- or better") to keep the grade rule visible.
 */
function isSpecificCourseReq(label: string): boolean {
  if (!/\bC[- +]?\s+or\s+better\b/i.test(label)) return false;
  return extractCourseCodes(label).length > 0;
}

/**
 * Load the LSA course catalog once and index by lowercased title so we can
 * resolve course NAMES (like "Calculus I", "Linear Algebra") to their canonical
 * codes when PSFT only mentions the name and not the code.
 */
type CourseRow = { code: string; title: string };
let courseIndexCache: Map<string, string[]> | null = null;
let titleByCodeCache: Map<string, string> | null = null;
function courseIndex(): Map<string, string[]> {
  if (courseIndexCache) return courseIndexCache;
  const data = JSON.parse(readFileSync(LSA_COURSES_PATH, 'utf-8')) as { courses: CourseRow[] };
  const idx = new Map<string, string[]>();
  const byCode = new Map<string, string>();
  for (const c of data.courses) {
    const key = (c.title ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (key) {
      const arr = idx.get(key) ?? [];
      arr.push(c.code);
      idx.set(key, arr);
    }
    if (c.code && c.title) byCode.set(c.code, c.title);
  }
  courseIndexCache = idx;
  titleByCodeCache = byCode;
  return idx;
}
function titleByCode(code: string): string | null {
  if (!titleByCodeCache) courseIndex(); // populate
  return titleByCodeCache?.get(code) ?? null;
}

/**
 * Pull codes out of PSFT prose that names courses without codes. E.g.
 * "Calculus I, Calculus II, Linear Algebra, Multivariable Calculus, or
 * Differential Equations" → look each name up in the LSA catalog by title.
 * Only matches whole-title equality (no substring soup), so we don't
 * accidentally pull in tangential courses.
 */
/**
 * Map common colloquial course names (used in PSFT prose) to the official
 * catalog titles they correspond to. Kept intentionally small — only for
 * cases where PSFT and the LSA catalog disagree on wording.
 */
const NAME_ALIASES: Record<string, string[]> = {
  'multivariable calculus': ['multivariable and vector calculus', 'calculus iii'],
  'differential equations': ['introduction to differential equations'],
};

function codesFromCourseNames(text: string, subjectHint?: string): string[] {
  const idx = courseIndex();
  const out = new Set<string>();
  const parts = text.split(/[,;/·]|\bor\b|\band\b|\.\s+/i);
  for (const raw of parts) {
    const key = raw.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^\s*-\s*/, '');
    if (!key || key.length < 4) continue;

    const candidateTitles = [key, ...(NAME_ALIASES[key] ?? [])];

    for (const candidate of candidateTitles) {
      // Exact title match first — highest confidence.
      const exact = idx.get(candidate);
      if (exact) {
        for (const code of exact) {
          if (!subjectHint || code.startsWith(subjectHint + ' ')) out.add(code);
        }
      }
      // Also do substring — catches "Applied Linear Algebra" when candidate is
      // "linear algebra", and other title variations the catalog uses.
      for (const [title, codes] of idx.entries()) {
        if (!title.includes(candidate)) continue;
        for (const code of codes) {
          if (!subjectHint || code.startsWith(subjectHint + ' ')) out.add(code);
        }
      }
    }
  }
  return Array.from(out);
}

/**
 * Strip a trailing completion row from a line that fused a label with an
 * inline completion (e.g. "EECS 281. C or better. FA 2026 EECS 281 …").
 * Leaves label intact if no completion segment is found.
 */
function splitOffCompletion(line: string): string {
  const m = line.match(/^(.+?)(?:\s+(?:FA|WN|SP|SU)\s+\d{4}\s+[A-Z]{2,10}\s+.*)$/);
  return m ? m[1].trim() : line;
}

/** Extract explicit "Credits/Courses: N required" clause from the tail of a line. */
function thresholdFromTail(tail: string): { need: number; countMode: 'count' | 'credits' } | null {
  const m = tail.match(/(Credits|Courses):\s*(\d+(?:\.\d+)?)\s+required\b/);
  if (!m) return null;
  return {
    need: parseFloat(m[2]),
    countMode: m[1].toLowerCase() === 'credits' ? 'credits' : 'count',
  };
}

/**
 * Detect labels that describe informational sections rather than requirements.
 * E.g. "List of Non-LSA Courses" is just showing which of your courses count
 * as non-LSA — not something you complete.
 */
function isInformational(label: string): boolean {
  return /^(list of|course history)\b/i.test(label);
}

/**
 * Detect PSFT "parent summary" rows — headers that describe a set of children
 * as a whole. Including them would double-count with the individual child rows.
 * Examples: "Area Distribution: 7 credits needed in each category",
 *           "Additional Distribution: 3 credits needed in 3 areas".
 */
function isParentSummary(label: string): boolean {
  if (/credits?\s+needed\s+in\s+(each|\d+)/i.test(label)) return true;
  if (/needed\s+in\s+(each|\d+)\s+(area|category|categories|areas)/i.test(label)) return true;
  return false;
}

/**
 * Detect fragments of wrapped labels that snuck through as their own line. If
 * a label starts mid-sentence ("cognates needed...", "If after completing...")
 * or is absurdly long from a botched merge, it's not a real requirement row.
 */
function isFragment(label: string): boolean {
  if (label.length > 500) return true;                   // truly runaway blobs only
  if (label.length < 10) return true;                    // "1876)" etc.
  if (!/[A-Za-z]{4,}/.test(label)) return true;          // needs at least one real word
  if (!/^[A-Z0-9(]/.test(label)) return true;
  if (/^(if|when|after|because|note:?|see the|beginning|prior to)\b/i.test(label)) return true;
  return false;
}
// Course-history / completion entries — skip these entirely.
const COMPLETION_ROW_RE = /^(FA|WN|SP|SU)\s+\d{4}\s+[A-Z]{2,10}\s+\d+/;
// Student demographics / header rows — skip.
const HEADER_ROW_RE =
  /^(Degree Audit Report|For:|UMID:|MSH|Uniqname|Page \d+ of \d+|Program\s+Requirement Term|Undergraduate LSA Career|Lit, Sci|- Complete|\*\*A QUICK WHAT-IF|ACADEMIC CAREER|SPECIFICALLY|DOES NOT CONSTITUTE|Course History|Term\s+Subject|EN:\s*Courses)/i;
// Prefix labels PSFT sprinkles in front of parent requirements — we strip them.
const STATUS_PREFIX_RE = /^(Not\s+Complete\s*:|Complete\s*:|In\s+Progress\s*:|Pending\s+Complete\s*:|Pending\s+Satisfied\s*:|Satisfied\s*:)\s*/i;

/**
 * Extract course codes with subject-prefix inheritance so
 * "BIOLOGY 171, (172 or 174), & 173" → [BIOLOGY 171, 172, 174, 173].
 * A bare 3-digit number after a subject inherits that subject until the next
 * subject appears.
 */
function extractCourseCodes(text: string): string[] {
  const codes = new Set<string>();
  let subject: string | null = null;
  // Three cases:
  //   (1) SUBJ NUM  — 2+ char subject with a course number
  //   (2) SUBJ      — 3+ char standalone subject (context for following numbers)
  //   (3) NUM       — bare number inheriting the previous subject
  const tokens = /([A-Z]{2,10})\s+(\d{3}[A-Z]?)|([A-Z]{3,10})|(\d{3}[A-Z]?)/g;
  let m: RegExpExecArray | null;
  while ((m = tokens.exec(text)) !== null) {
    if (m[1] && m[2]) {
      subject = m[1];
      codes.add(`${subject} ${m[2]}`);
    } else if (m[3]) {
      subject = m[3];
    } else if (m[4] && subject) {
      codes.add(`${subject} ${m[4]}`);
    }
  }
  return Array.from(codes);
}

/**
 * Pre-merge wrapped RG / RQ label lines. If line N contains `(RG XXXX)` or
 * `(RQ XXXX)` and the previous line has no metadata of its own (no RG/RQ/
 * Credits/Courses/completion row), treat it as a wrapped continuation of the
 * label and merge.
 */
function mergeWrappedLines(rawLines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const marker = /\(R[GQ]\s*\d+\)/.test(line);
    if (marker && out.length > 0) {
      const prev = out[out.length - 1];
      // Lone marker line ("(RQ 1876)" all by itself) is unambiguously a
      // wrapped tail — always fold into prev.
      if (/^\(R[GQ]\s*\d+\)\s*$/.test(line)) {
        out[out.length - 1] = (prev + ' ' + line).replace(/\s+/g, ' ').trim();
        continue;
      }
      const prevIsMetadata =
        /\(R[GQ]\s|Credits:|Courses:|C[- +]?\s+or\s+better/i.test(prev) ||
        /\s(FA|WN|SP|SU)\s+\d{4}\s+/.test(prev) ||
        HEADER_ROW_RE.test(prev) ||
        COMPLETION_ROW_RE.test(prev);
      if (!prevIsMetadata) {
        out[out.length - 1] = (prev + ' ' + line).replace(/\s+/g, ' ').trim();
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Merge PSFT's mid-content line wraps. A line that starts with a bare course
 * number ("265, ECON 451...") or a bare threshold clause ("Credits: 1.00
 * required...") is really the tail of the previous label — glue it back.
 */
function mergeContinuations(rawLines: string[]): string[] {
  const out: string[] = [];
  for (const raw of rawLines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (out.length === 0) { out.push(line); continue; }
    const prev = out[out.length - 1];
    if (HEADER_ROW_RE.test(prev) || COMPLETION_ROW_RE.test(prev)) {
      out.push(line);
      continue;
    }
    // Bare 3-digit course number → continuation of prev subject list
    if (/^\d{3}[A-Z]?[,\s.]/.test(line)) {
      out[out.length - 1] = (prev + ' ' + line).replace(/\s+/g, ' ').trim();
      continue;
    }
    // Threshold clause detached from its label
    if (/^(Credits|Courses):\s*\d/.test(line)) {
      out[out.length - 1] = (prev + ' ' + line).replace(/\s+/g, ' ').trim();
      continue;
    }
    out.push(line);
  }
  return out;
}

function parsePdfLines(rawLines: string[]): ParsedRG[] {
  const lines = mergeContinuations(mergeWrappedLines(rawLines));
  const groups: ParsedRG[] = [];
  let currentGroup: ParsedRG | null = null;

  // Track how many times we've seen each RQ id so we can disambiguate duplicates.
  const rqUseCount = new Map<number, number>();
  const nextSyntheticId = { n: 900000 };
  // Selection parents ("2 Approved MATH Courses", "Choose 3 from …") have their
  // specific option children shown as sub-rows below. We want to fold the child
  // codes into the parent's matchCodes and not emit the children as separate
  // requirements. This tracks the current such parent within the current RG.
  let selectionParent: ParsedRQ | null = null;
  // Section-header parent (no numeric threshold, just groups children). Used
  // to attach a semantic name to child rows during enrichment. Cleared on
  // every new RG.
  let sectionParentLabel: string | null = null;

  for (const raw of lines) {
    let line = raw;
    if (!line) continue;
    if (HEADER_ROW_RE.test(line)) continue;
    if (COMPLETION_ROW_RE.test(line)) continue;

    // Strip "Not Complete:" / "Complete:" prefix without losing the rest.
    line = line.replace(STATUS_PREFIX_RE, '');

    const rgMatch = line.match(RG_RE);
    if (rgMatch) {
      currentGroup = {
        id: parseInt(rgMatch[2], 10),
        label: rgMatch[1].trim(),
        requirements: [],
      };
      groups.push(currentGroup);
      selectionParent = null; // parents don't cross RG boundaries
      sectionParentLabel = null;
      continue;
    }

    if (!currentGroup) continue;

    // Case 1: line has an RQ id. Threshold may be explicit ("N required") in
    // the tail, or implicit (already-completed requirement — PSFT drops the
    // "required" text and just shows the completing course). Parse label as
    // a fallback.
    const rqMatch = line.match(RQ_ANY_LINE_RE);
    if (rqMatch) {
      const label = rqMatch[1].trim();
      if (!isInformational(label) && !isParentSummary(label) && !isFragment(label)) {
        const rqId = parseInt(rqMatch[2], 10);
        const tail = rqMatch[3] ?? '';
        let threshold = thresholdFromTail(tail);
        if (!threshold) threshold = thresholdFromLabel(label);
        if (threshold) {
          const codes = extractCourseCodes(label);
          const uses = (rqUseCount.get(rqId) ?? 0) + 1;
          rqUseCount.set(rqId, uses);
          const uniqueId = uses === 1 ? rqId : parseInt(`${rqId}${uses}`, 10);
          const parsedReq: ParsedRQ = {
            id: uniqueId,
            label,
            need: threshold.need,
            countMode: threshold.countMode,
            ...(codes.length ? { courseCodes: codes } : {}),
          };
          currentGroup.requirements.push(parsedReq);
          // If this parent asks for N > 1 and doesn't already have explicit
          // codes, treat subsequent Case-3 sub-rows as its options and roll
          // their codes up into this parent.
          selectionParent = threshold.need > 1 && codes.length === 0 ? parsedReq : null;
          sectionParentLabel = null;
          continue;
        }
        // No threshold from RQ — but if the label itself is a specific course
        // requirement (e.g. "ECON 101 - C or better"), fall through to Case 3.
        if (isSpecificCourseReq(label)) {
          const codes = extractCourseCodes(label);
          currentGroup.requirements.push({
            id: nextSyntheticId.n++,
            label,
            need: 1,
            countMode: 'count',
            courseCodes: codes,
            parentLabel: sectionParentLabel ?? undefined,
          });
          selectionParent = null;
          continue;
        }
      }
      // Section header without threshold and without specific-course details.
      // Subsequent Case-3 rows are NOT sub-options of this — they're the actual
      // requirements (e.g. "Core Courses: Computer Science" is just a section
      // label; EECS 281/370/376 below it are the reqs). Track the section name
      // so children can inherit a semantic label.
      selectionParent = null;
      sectionParentLabel = rqMatch[1].trim();
      continue;
    }

    const subMatch = line.match(SUB_ROW_RE);
    if (subMatch) {
      const label = subMatch[1].trim();
      if (isInformational(label) || isParentSummary(label) || isFragment(label)) continue;
      const need = parseFloat(subMatch[3]);
      if (need === 0) continue;
      const codes = extractCourseCodes(label);
      currentGroup.requirements.push({
        id: nextSyntheticId.n++,
        label,
        need,
        countMode: subMatch[2].toLowerCase() === 'credits' ? 'credits' : 'count',
        ...(codes.length ? { courseCodes: codes } : {}),
        parentLabel: sectionParentLabel ?? undefined,
      });
      continue;
    }

    // Case 3: completed-but-still-a-real requirement. PSFT collapses the
    // threshold to just the completing course, but the "C or better" grade rule
    // stays in the label. If we see specific course codes + "C or better", treat
    // as need=1 count with matchCodes from the label.
    const stripped = splitOffCompletion(line);
    if (isSpecificCourseReq(stripped) && !isFragment(stripped)) {
      const codes = extractCourseCodes(stripped);
      // If we're under a selection parent (like "2 Approved MATH Courses"),
      // fold this row's codes into the parent instead of emitting a separate
      // requirement.
      if (selectionParent) {
        const existing = selectionParent.courseCodes ?? [];
        selectionParent.courseCodes = Array.from(new Set([...existing, ...codes]));
        continue;
      }
      currentGroup.requirements.push({
        id: nextSyntheticId.n++,
        label: stripped,
        need: 1,
        countMode: 'count',
        courseCodes: codes,
        parentLabel: sectionParentLabel ?? undefined,
      });
      continue;
    }
  }

  return groups;
}

/**
 * Turn a raw split label + hint into the display-friendly form:
 *   - Single course → "CODE: Title"; hint keeps other rules (drops "C or better").
 *   - Multi-course pick-one (need=1, multiple codes) → semantic label from
 *     the section-header parent (stripped of "Core Courses:" etc.) if it
 *     provides a real name; otherwise fall back to the first course's title.
 *     Hint lists all the code options.
 *   - Multi-course selection parent (need>1) → keep the label PSFT gave.
 */
function stripSectionPrefix(label: string): string | null {
  const m = label.match(/^(?:Core Courses?|Required Courses?|Approved Courses?|Pre-Declaration|Prerequisites?)\s*:\s*(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  // Reject if the "semantic" part is really just a code list.
  if (/^[A-Z]{2,10}\s+\d/.test(rest)) return null;
  return rest;
}

function cleanHint(hint: string): string {
  return hint
    .split(/\s*·\s*/)
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      if (/^C[- +]?\s+or\s+better\b/i.test(p)) return false;
      if (/^\(?\s*R[GQ]\s*\d/i.test(p)) return false;
      return true;
    })
    .join(' · ');
}

/**
 * Canned descriptions for LSA-wide requirements the PDF doesn't spell out
 * inline. Keyed by exact label so it applies uniformly across every major.
 * These aren't "hallucinated" — they're the same wording LSA uses on its
 * degree-requirements pages, just adapted for display.
 */
/**
 * Determine which course tags a given LSA credit requirement must exclude
 * for the audit engine to enforce the rule correctly. Purely mechanical —
 * derives from LSA's own definitions of each requirement.
 *
 * Returns [] when no exclusions apply, so the caller can safely spread it.
 */
/**
 * Map major-department names (as PSFT writes them in "N Credits outside X"
 * labels) → the course-subject prefixes we tag with `subj-<prefix>`.
 * "outside" credits are what the audit needs to EXCLUDE.
 */
const DEPT_SUBJECTS: Record<string, string[]> = {
  'computer science': ['eecs'],
  'biology': ['biology', 'eeb', 'mcdb'],
  'ecology and evolutionary biology': ['eeb', 'biology'],
  'cellular and molecular biology': ['mcdb', 'biology'],
  'english language & literature': ['english'],
  'english': ['english'],
  'economics': ['econ'],
  'chemistry': ['chem'],
  'psychology': ['psych'],
  'physics': ['physics'],
  'mathematics': ['math'],
  'statistics': ['stats'],
  'sociology': ['soc'],
  'anthropology': ['anthrcul', 'anthrbio', 'anthrarc'],
  'history': ['history'],
  'political science': ['polsci'],
  'philosophy': ['phil'],
  'linguistics': ['ling'],
  'communication studies': ['comm'],
};

function excludeTagsFor(label: string): string[] {
  const tags = new Set<string>();
  const l = label.toLowerCase();

  if (/^100 lsa credits$/i.test(label)) tags.add('non-lsa');

  if (/enrolled\s+in\s+lsa/i.test(l)) {
    tags.add('ap-credit');
    tags.add('non-lsa');
  }

  if (/in[-\s]?residence/i.test(l)) {
    tags.add('ap-credit');
  }

  if (/excluding\s+experiential/i.test(l)) {
    tags.add('experiential');
    tags.add('independent-study');
  }

  // LSA college-wide: AP can't satisfy writing, R&E, or QR (per LSA policy).
  // AP CAN satisfy Language via test proficiency, so intentionally not added.
  if (
    /first\s+year\s+writing/i.test(l) ||
    /upper\s+level\s+writing/i.test(l) ||
    /race\s+and\s+ethnicity/i.test(l) ||
    /quantitative\s+reasoning/i.test(l)
  ) {
    tags.add('ap-credit');
  }

  const outside = l.match(/credits?\s+outside\s+(.+?)\s*$/);
  if (outside) {
    const dept = outside[1].trim().toLowerCase();
    const subjects = DEPT_SUBJECTS[dept];
    if (subjects) {
      for (const s of subjects) tags.add(`subj-${s}`);
    }
  }

  return Array.from(tags);
}

/** Some LSA reqs use a specific tag rather than matchAll. Returns the tag or null. */
function matchTagFor(label: string): string | null {
  if (/BS-Eligible/i.test(label)) return 'lsa-bs';
  if (/^First Year Writing Requirement/i.test(label)) return 'lsa-fywr';
  if (/^Upper Level Writing Requirement/i.test(label)) return 'lsa-ulwr';
  if (/^Race and Ethnicity Requirement/i.test(label)) return 'lsa-race-ethnicity';
  if (/^Quantitative Reasoning Requirement/i.test(label)) return 'lsa-qr';
  if (/^Language Requirement/i.test(label)) return 'lsa-language';
  return null;
}

function cannedHintFor(label: string): string | null {
  if (/^120 Total Credits$/i.test(label))
    return 'All credits completed at U-M plus posted transfer credit.';
  if (/^100 LSA Credits$/i.test(label))
    return 'Credits from courses recognized by LSA (most U-M courses except some SI offerings and other school-specific courses).';
  if (/^60 BS-Eligible Credits/i.test(label))
    return 'Only counts for students pursuing a Bachelor of Science.';
  if (/^90 Credits Excluding Experiential and Independent Study/i.test(label))
    return 'At least 90 credits must come from standard coursework — internships and independent study don\'t count.';
  if (/^90 Credits of Graded Course Work/i.test(label))
    return 'At least 90 credits must carry a letter grade (transfer and test credit included).';
  if (/^60 Credits of In-Residence Course Work/i.test(label))
    return 'Credits taken on the Ann Arbor campus or through an approved U-M study abroad program.';
  if (/^30 Credits Taken While Enrolled in LSA$/i.test(label))
    return 'Credits earned while officially enrolled in LSA (as opposed to another U-M college).';
  const outside = label.match(/^60 Credits outside (.+)$/i);
  if (outside)
    return `Credits earned in courses outside the ${outside[1]} department(s).`;
  if (/^First Year Writing Requirement$/i.test(label))
    return 'ENGLISH 124, 125, or an approved equivalent.';
  if (/^Upper Level Writing Requirement$/i.test(label))
    return 'One writing-intensive course at the 300+ level, typically inside your major.';
  if (/^Race and Ethnicity Requirement$/i.test(label))
    return 'One course from LSA\'s approved R&E list.';
  if (/^Quantitative Reasoning Requirement$/i.test(label))
    return 'One QR1 course, or two QR2 courses.';
  if (/^Language Requirement$/i.test(label))
    return 'A fourth-term proficiency course in a language other than English, or an equivalent placement.';
  return null;
}

function enrichLabel(
  rawLabel: string,
  rawHint: string,
  codes: string[],
  need: number,
  parentLabel: string | undefined,
): { label: string; hint: string } {
  const hint = cleanHint(rawHint);

  // Single course code — use CODE: Title.
  if (codes.length === 1) {
    const title = titleByCode(codes[0]);
    if (title) return { label: `${codes[0]}: ${title}`, hint };
  }

  // Multi-course pick-one — semantic label from parent section, fall back to
  // first course's title.
  if (codes.length > 1 && need === 1) {
    const semantic = parentLabel ? stripSectionPrefix(parentLabel) : null;
    // Format like "EECS 203, MATH 465, or MATH 565" — reads naturally, makes
    // clear that any single course from the list satisfies the requirement.
    const options =
      codes.length === 2
        ? `${codes[0]} or ${codes[1]}`
        : `${codes.slice(0, -1).join(', ')}, or ${codes[codes.length - 1]}`;
    const choice = `Choose 1 of: ${options}`;
    if (semantic) {
      return {
        label: semantic,
        hint: hint ? `${hint} · ${choice}` : choice,
      };
    }
    const firstTitle = titleByCode(codes[0]);
    if (firstTitle) {
      return {
        label: firstTitle,
        hint: hint ? `${hint} · ${choice}` : choice,
      };
    }
  }

  return { label: rawLabel, hint };
}

// --- RG label → category ------------------------------------------------

const CATEGORY_BY_RG_LABEL: { pattern: RegExp; category: string }[] = [
  { pattern: /LSA CREDIT REQUIREMENTS/i, category: 'lsa-credit-min' },
  { pattern: /GRADE REQUIREMENTS/i, category: 'lsa-credit-min' },
  { pattern: /LSA RESIDENCY/i, category: 'lsa-credit-min' },
  { pattern: /COLLEGE WIDE REQUIREMENTS/i, category: 'lsa-college-wide' },
  { pattern: /AREA DISTRIBUTION/i, category: 'lsa-distribution' },
  { pattern: /ADDITIONAL DISTRIBUTION|GRAND CHALLENGES/i, category: 'lsa-add-distribution' },
  { pattern: /PREREQUISITES/i, category: 'prerequisites' },
  { pattern: /CAPSTONE/i, category: 'capstone' },
  { pattern: /ELECTIVES?/i, category: 'electives' },
  { pattern: /TOTAL CREDITS|CREDIT[S]? & GPA/i, category: 'major-credit-min' },
];

function categoryForGroup(label: string): string {
  for (const rule of CATEGORY_BY_RG_LABEL) {
    if (rule.pattern.test(label)) return rule.category;
  }
  // Fallback: derive from the major-specific label. "BIOLOGY REQUIREMENTS" → "core".
  if (/REQUIREMENTS?/i.test(label)) return 'core';
  return 'other';
}

// --- Convert ParsedRG[] to Requirement[] -------------------------------

/**
 * PSFT prints "N Additional Credits in X" rows for categories that don't
 * actually have a base area-distribution requirement (only HU/NS/SS do). For
 * MSA/CE/ID those "Additional" rows are internal counters PSFT uses to track
 * the "ID credit can count toward 1, 2, or all 3 areas" rule, not real
 * distinct requirements.
 */
function isAddDistArtifact(label: string, category: string): boolean {
  if (category !== 'lsa-add-distribution') return false;
  if (!/Additional Credits in/i.test(label)) return false;
  return !/Humanities|Natural Sciences|Social Sciences/i.test(label);
}

/** Map a distribution label → semantic area slug. Used to add matchTag. */
function labelToArea(label: string): string | null {
  if (/\bHumanities\b/i.test(label)) return 'humanities';
  if (/\bNatural Sciences\b/i.test(label)) return 'natural-sciences';
  if (/\bSocial Sciences\b/i.test(label)) return 'social-sciences';
  if (/\bMathematical\b|\bMSA\b/i.test(label)) return 'math-symbolic';
  if (/\bCreative Expression\b/i.test(label)) return 'creative-expression';
  if (/\bInterdisciplinary\b/i.test(label)) return 'interdisciplinary';
  return null;
}

/**
 * Post-process:
 *   - Base area distribution reqs (HU/NS/SS 7 cr) → assign stable IDs and
 *     matchTag so the audit counts only tagged courses.
 *   - Additional distribution: rewrite as one pickFromGroups parent + 6 area
 *     children. Parent shows "complete 3 areas" progress; children get
 *     `satisfiedByParent` treatment once 3 are met. HU/NS/SS children get
 *     `offset: 7` (must exceed the base 7 cr before counting).
 */
function processDistribution(reqs: Requirement[]): Requirement[] {
  const before: Requirement[] = [];
  const after: Requirement[] = [];
  const distReqs: Requirement[] = [];
  const addDistReqs: Requirement[] = [];
  let sawDistribution = false;
  let sawAddDistribution = false;

  for (const r of reqs) {
    if (r.category === 'lsa-distribution') {
      distReqs.push(r);
      sawDistribution = true;
      continue;
    }
    if (r.category === 'lsa-add-distribution') {
      addDistReqs.push(r);
      sawAddDistribution = true;
      continue;
    }
    if (sawAddDistribution || sawDistribution) after.push(r);
    else before.push(r);
  }

  // Canonical area names + hints for the distribution rows. Match the wording
  // the LSA degree-requirements page uses.
  const AREA_NAME: Record<string, string> = {
    humanities: 'Humanities',
    'natural-sciences': 'Natural Sciences',
    'social-sciences': 'Social Sciences',
    'math-symbolic': 'Mathematical & Symbolic Analysis',
    'creative-expression': 'Creative Expression',
    interdisciplinary: 'Interdisciplinary',
  };
  const AREA_TAG_LETTERS: Record<string, string> = {
    humanities: 'HU',
    'natural-sciences': 'NS',
    'social-sciences': 'SS',
    'math-symbolic': 'MSA',
    'creative-expression': 'CE',
    interdisciplinary: 'ID',
  };

  // Base distribution: 3 required buckets (HU / NS / SS).
  const distOut: Requirement[] = [];
  for (const r of distReqs) {
    const area = labelToArea(r.label);
    if (area) {
      const name = AREA_NAME[area] ?? r.label;
      distOut.push({
        ...r,
        id: `lsa-dist-${area}`,
        label: `Area Distribution: 7 Credits in ${name}`,
        hint: `From approved ${AREA_TAG_LETTERS[area]}-designated courses.`,
        matchTag: `lsa-${area}`,
        matchCodes: undefined,
        matchAll: undefined,
        excludeTags: ['ap-credit'],
      });
    } else {
      distOut.push(r);
    }
  }

  // Additional distribution: pick 3 of 6 areas.
  const addDistChildren: Requirement[] = [];
  for (const r of addDistReqs) {
    const area = labelToArea(r.label);
    if (area) {
      const name = AREA_NAME[area] ?? r.label;
      const isBaseArea = ['humanities', 'natural-sciences', 'social-sciences'].includes(area);
      const child: Requirement = {
        ...r,
        id: `lsa-add-dist-${area}`,
        label: isBaseArea
          ? `Additional 3 Credits in ${name}`
          : `3 Credits in ${name}`,
        hint: isBaseArea
          ? `Beyond the initial 7 cr ${name}.`
          : `From approved ${AREA_TAG_LETTERS[area]}-designated courses.`,
        matchTag: `lsa-${area}`,
        matchCodes: undefined,
        matchAll: undefined,
        excludeTags: ['ap-credit'],
      };
      if (isBaseArea) child.offset = 7;
      addDistChildren.push(child);
    } else {
      addDistChildren.push(r);
    }
  }

  const addDistOut: Requirement[] = [];
  if (addDistChildren.length >= 3) {
    addDistOut.push({
      id: 'lsa-add-dist-choose-3',
      label: 'Additional Distribution: complete 3 areas',
      hint: 'Pick any 3 of the 6 area buckets below and hit 3 cr in each.',
      need: 3,
      countMode: 'count',
      category: 'lsa-add-distribution',
      pickFromGroups: addDistChildren.map((c) => c.id),
    });
    addDistOut.push(...addDistChildren);
  } else {
    addDistOut.push(...addDistChildren);
  }

  return [...before, ...distOut, ...addDistOut, ...after];
}

/**
 * Split a full PSFT label into a clean short label + a hint containing the
 * specific rules (grade thresholds, location constraints, sub-descriptions).
 * PSFT concatenates the actual rule details with " - " or ". " separators.
 *
 * Examples:
 *   "First Year Writing Requirement - one course required - C- or better"
 *     → label: "First Year Writing Requirement"
 *       hint:  "one course required · C- or better"
 *   "ECON 401. C- or better. Must be taken at U-M Ann Arbor campus."
 *     → label: "ECON 401"
 *       hint:  "C- or better · Must be taken at U-M Ann Arbor campus"
 *   "Minimum 120 Total Credits"
 *     → label: "Minimum 120 Total Credits"
 *       hint:  ""
 */
function splitLabelForHint(fullLabel: string): { label: string; hint: string } {
  // Strip redundant "Minimum" — every LSA credit threshold uses it and the
  // meaning is implied by the number ("120 Total Credits" reads the same).
  const withoutMinimum = fullLabel.replace(/^Minimum\s+/i, '');
  const parts = withoutMinimum
    .split(/\s+[-·]\s+|\.\s+(?=[A-Z])/)
    .map((p) => p.trim().replace(/[.,\s]+$/, ''))
    .filter(Boolean);
  if (parts.length <= 1) {
    return { label: withoutMinimum.replace(/[.,\s]+$/, ''), hint: '' };
  }
  return {
    label: parts[0],
    hint: parts.slice(1).join(' · '),
  };
}

function toRequirements(groups: ParsedRG[]): Requirement[] {
  const out: Requirement[] = [];
  for (const g of groups) {
    const category = categoryForGroup(g.label);
    // Track labels we've already emitted in this group so PSFT's display
    // artifacts collapse to a single requirement.
    const seenLabels = new Set<string>();
    for (const r of g.requirements) {
      if (/GPA/i.test(r.label)) continue;
      if (r.need === 0) continue;
      if (isAddDistArtifact(r.label, category)) continue;
      const dedupKey = r.label.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenLabels.has(dedupKey)) continue;
      seenLabels.add(dedupKey);

      const { label: baseLabel, hint: baseHint } = splitLabelForHint(r.label);
      // If the label mentions a subject prefix (e.g. "2 Approved MATH Courses"),
      // try to resolve any course names in the hint to their codes and merge in.
      const codes = new Set<string>(r.courseCodes ?? []);
      const subjectMatch = baseLabel.match(/\b([A-Z]{3,10})\b/);
      const subjectHint = subjectMatch ? subjectMatch[1] : undefined;
      if (baseHint) {
        for (const c of codesFromCourseNames(baseHint, subjectHint)) codes.add(c);
      }
      const enriched = enrichLabel(
        baseLabel,
        baseHint,
        Array.from(codes),
        r.need,
        r.parentLabel,
      );
      // Fill in canned LSA descriptions when the PDF didn't provide one inline.
      const finalHint = enriched.hint || cannedHintFor(enriched.label) || '';
      const excludeTags = excludeTagsFor(enriched.label);
      const req: Requirement = {
        id: `whatif-rq-${r.id}`,
        label: enriched.label,
        hint: finalHint,
        need: r.need,
        countMode: r.countMode,
        category,
        ...(excludeTags.length ? { excludeTags } : {}),
      };
      if (codes.size > 0) {
        req.matchCodes = Array.from(codes);
      } else {
        const explicitTag = matchTagFor(enriched.label);
        if (explicitTag) {
          req.matchTag = explicitTag;
        } else {
          req.matchAll = true;
        }
      }
      out.push(req);
    }
  }
  return out;
}

// --- Slug mapping (PDF → JSON) -----------------------------------------

/** Read all major JSON filenames and build a "canonical slug" for each. */
function buildJsonSlugIndex(): Record<string, string> {
  const idx: Record<string, string> = {};
  const files = readdirSync(MAJORS_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const raw = readFileSync(join(MAJORS_DIR, f), 'utf-8');
    let data: { id?: string; name?: string };
    try { data = JSON.parse(raw); } catch { continue; }
    const key = (data.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (key) idx[key] = f;
  }
  return idx;
}

/** Normalize a PDF slug (like "biology") to a canonical major-name key. */
function pdfSlugToKey(slug: string): string {
  return slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Resolve a PDF filename to the matching data/majors/*.json filename.
 * Uses the overrides file for hand-tuned mappings (null value = ignore this
 * PDF entirely) and falls back to direct name matching.
 */
function resolveJsonFilename(
  pdfSlug: string,
  overrides: Record<string, string | null>,
  jsonIdx: Record<string, string>,
): string | null | 'IGNORE' {
  if (pdfSlug in overrides) {
    const v = overrides[pdfSlug];
    return v === null ? 'IGNORE' : v;
  }
  const key = pdfSlugToKey(pdfSlug);
  return jsonIdx[key] ?? null;
}

// --- Merge into JSON ---------------------------------------------------

/**
 * Look up the department course-subject prefixes for a major, from its id.
 * "lsa-computer-science" → ['eecs'], "lsa-biology" → ['biology','eeb','mcdb'].
 */
function subjectsForMajorId(id: string): string[] {
  const key = id.replace(/^lsa-/, '').replace(/-/g, ' ');
  return DEPT_SUBJECTS[key] ?? [];
}

/**
 * For major-specific reqs that PSFT phrases without concrete course codes
 * ("Capstone Course", "Technical Electives for X", "Upper-Level Major
 * Credits"), swap matchAll for the major's upper-level subject tag so the
 * audit only counts qualifying courses.
 */
function applyMajorSubjectRules(r: Requirement, subjects: string[]): Requirement {
  if (!r.matchAll || subjects.length === 0) return r;
  const l = r.label.toLowerCase();
  const needsUpperSubj =
    /\bcapstone\b/i.test(l) ||
    /\btechnical\s+elective/i.test(l) ||
    /\bulcs\s+elective/i.test(l) ||
    /upper[-\s]level.*(major|electives?)/i.test(l) ||
    /total.*elective\s+credits\s+required/i.test(l);
  if (!needsUpperSubj) return r;
  const { matchAll: _drop, ...rest } = r;
  void _drop;
  return { ...rest, matchTag: `subj-${subjects[0]}-upper` };
}

function mergeIntoMajor(jsonPath: string, whatifReqs: Requirement[]): void {
  const raw = readFileSync(jsonPath, 'utf-8');
  const data: { id?: string; requirements?: Requirement[] } & Record<string, unknown> =
    JSON.parse(raw);
  const subjects = subjectsForMajorId(data.id ?? '');
  data.requirements = whatifReqs.map((r) => applyMajorSubjectRules(r, subjects));
  writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/** Wipe requirements from every major we're going to rewrite from a PDF. */
function wipeMajorsWithPdf(pdfSlugs: string[], overrides: Record<string, string | null>, jsonIdx: Record<string, string>) {
  const jsonNames = new Set<string>();
  for (const slug of pdfSlugs) {
    const name = resolveJsonFilename(slug, overrides, jsonIdx);
    if (name && name !== 'IGNORE') jsonNames.add(name);
  }
  for (const name of jsonNames) {
    const path = join(MAJORS_DIR, name);
    if (!existsSync(path)) continue;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    data.requirements = [];
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
  return jsonNames.size;
}

// --- Main --------------------------------------------------------------

async function main() {
  const overrides: Record<string, string | null> = existsSync(OVERRIDES_PATH)
    ? JSON.parse(readFileSync(OVERRIDES_PATH, 'utf-8'))
    : {};
  const jsonIdx = buildJsonSlugIndex();

  const pdfs = readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf'));
  console.log(`Found ${pdfs.length} PDFs.`);

  // Wipe existing requirements on every major we're about to rewrite. Nothing
  // stale carries over from the earlier stub / hand-encoded / previous-parse
  // states.
  const pdfSlugs = pdfs.map((f) => basename(f, '.pdf'));
  const wiped = wipeMajorsWithPdf(pdfSlugs, overrides, jsonIdx);
  console.log(`Wiped requirements on ${wiped} majors before re-parse.`);

  let merged = 0, ignored = 0, unmapped = 0, failed = 0;
  const missingJson: { pdf: string; key: string }[] = [];

  for (const f of pdfs) {
    const slug = basename(f, '.pdf');
    const jsonName = resolveJsonFilename(slug, overrides, jsonIdx);
    if (jsonName === 'IGNORE') { ignored++; continue; }
    if (!jsonName) {
      missingJson.push({ pdf: slug, key: pdfSlugToKey(slug) });
      unmapped++;
      continue;
    }
    const jsonPath = join(MAJORS_DIR, jsonName);
    if (!existsSync(jsonPath)) {
      console.error(`  ${slug}.pdf → ${jsonName} (missing on disk)`);
      failed++;
      continue;
    }
    try {
      const lines = await extractPdfText(join(PDF_DIR, f));
      const groups = parsePdfLines(lines);
      const reqs = processDistribution(toRequirements(groups));
      mergeIntoMajor(jsonPath, reqs);
      console.log(`  ${slug}.pdf → ${jsonName}  (${reqs.length} reqs)`);
      merged++;
    } catch (e) {
      console.error(`  ${slug}.pdf FAILED: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log('');
  console.log(`Merged: ${merged}. Ignored (per overrides): ${ignored}. Unmapped: ${unmapped}. Failed: ${failed}.`);
  if (missingJson.length > 0) {
    console.log('');
    console.log('Unmapped PDFs (add to _whatif-overrides.json):');
    for (const m of missingJson) console.log(`  ${m.pdf}  (key: ${m.key})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
