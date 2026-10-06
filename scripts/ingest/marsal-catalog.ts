/**
 * Marsal Family School of Education catalog from the school's official
 * course syllabi table (marsal.umich.edu/academics-admissions/course-
 * syllabi), a paginated Drupal view carrying course number, credit range,
 * and title. All pages are crawled until an empty one.
 *
 * The table covers the teacher-education professional sequence but not
 * the LEAPS curriculum or the newer first-year elementary core, so those
 * are curated below from the two official program pages, which publish
 * code, title, and credits for every requirement:
 *   - marsal.umich.edu/academics-admissions/degrees/bachelors/learning-
 *     equity-and-problem-solving-public-good (LEAPS)
 *   - marsal.umich.edu/academics-admissions/degrees/bachelors-
 *     certification/undergraduate-elementary-teacher-education
 * Table rows win over curated entries when both know a course.
 *
 * Variable-credit courses ("3-12") record the maximum, matching the
 * nursing/kines/sph convention. The LEAPS capstone pair is wired as a
 * sequenceNext (EDUC 481 fall → EDUC 482 winter).
 *
 * Run: npx tsx scripts/ingest/marsal-catalog.ts
 * Output: data/courses/marsal-catalog.json (merged by lib/data.ts,
 * gap-fill only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'marsal-catalog.json');
const PAGE = 'https://marsal.umich.edu/academics-admissions/course-syllabi';
const MAX_PAGES = 40;

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  sequenceNext?: string;
}

/** Program-page entries absent from the syllabi table (see file header). */
const CURATED: Entry[] = [
  // LEAPS core, forum, gen ed, internships, capstones
  { code: 'EDUC 100', title: 'Learning Within and Across Settings', credits: 3, tags: [] },
  { code: 'EDUC 101', title: 'Lower Division Forum', credits: 1, tags: [] },
  { code: 'EDUC 107', title: 'Preparing for Engaged Learning I', credits: 4, tags: [] },
  { code: 'EDUC 108', title: 'Preparing for Engaged Learning II', credits: 3, tags: [] },
  { code: 'EDUC 130', title: 'The City as Identity', credits: 3, tags: [] },
  { code: 'EDUC 131', title: 'Science in the City', credits: 3, tags: [] },
  { code: 'EDUC 140', title: 'Writing With Detroit', credits: 3, tags: [] },
  { code: 'EDUC 202', title: 'Design as Community Inquiry', credits: 3, tags: [] },
  { code: 'EDUC 203', title: 'Inquiry, Partnership, and Research', credits: 3, tags: [] },
  {
    code: 'EDUC 207',
    title: 'Lower Division Community-Engaged Learning Internship',
    credits: 8,
    tags: [],
  },
  { code: 'EDUC 251', title: 'Mathematics and Society', credits: 3, tags: [] },
  { code: 'EDUC 322', title: 'Upper Division Forum', credits: 1, tags: [] },
  { code: 'EDUC 331', title: 'Strategic Communication', credits: 3, tags: [] },
  {
    code: 'EDUC 393',
    title: 'Upper Division Community-Engaged Learning Internship',
    credits: 8,
    tags: [],
  },
  {
    code: 'EDUC 481',
    title: 'Education for Empowerment Capstone I',
    credits: 3,
    tags: [],
    sequenceNext: 'EDUC 482',
  },
  { code: 'EDUC 482', title: 'Education for Empowerment Capstone II', credits: 4, tags: [] },
  // Elementary teacher education pre-professional core
  { code: 'EDUC 141', title: 'Schools, Society, and Self', credits: 2, tags: [] },
  { code: 'EDUC 151', title: 'Youth Serving Community Engagement', credits: 1, tags: [] },
  { code: 'EDUC 160', title: 'Everyday Equitable Practice and Dialogue', credits: 3, tags: [] },
  { code: 'EDUC 241', title: 'Deepening Disciplinary Knowledge', credits: 3, tags: [] },
  { code: 'EDUC 271', title: 'Youth Serving Community Engagement II', credits: 2, tags: [] },
  { code: 'EDUC 291', title: 'Educational Psychology', credits: 3, tags: [] },
];

/** Codes the Marsal major files reference; the run fails if any are absent. */
const REQUIRED_CODES = [
  // LEAPS
  'EDUC 100', 'EDUC 101', 'EDUC 107', 'EDUC 108', 'EDUC 130', 'EDUC 131',
  'EDUC 140', 'EDUC 202', 'EDUC 203', 'EDUC 207', 'EDUC 251', 'EDUC 322',
  'EDUC 331', 'EDUC 393', 'EDUC 481', 'EDUC 482',
  // Elementary teacher education
  'EDUC 118', 'EDUC 141', 'EDUC 151', 'EDUC 160', 'EDUC 241', 'EDUC 271',
  'EDUC 291', 'EDUC 392', 'EDUC 301', 'EDUC 303', 'EDUC 307', 'EDUC 391',
  'EDUC 401', 'EDUC 403', 'EDUC 405', 'EDUC 407', 'EDUC 411', 'EDUC 414',
  'EDUC 415', 'EDUC 416', 'EDUC 417', 'EDUC 421', 'EDUC 430', 'EDUC 431',
  'EDUC 443', 'EDUC 444',
];

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** "3-12" → 12; "1" → 1. Maximum of a range, per catalog convention. */
function parseCredits(raw: string): number | undefined {
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return undefined;
  return Math.max(...nums.map(Number));
}

function parseRows(html: string): Entry[] {
  const out: Entry[] = [];
  const rowRe =
    /views-field-field-course-no[^>]*>\s*(EDUC \d+)\s*<\/td>[\s\S]*?views-field-field-course-duration[^>]*>\s*([^<]*)<\/td>[\s\S]*?class="crs-title"[^>]*>([\s\S]*?)<(?:span|\/a)/g;
  for (const m of html.matchAll(rowRe)) {
    const [, code, rawCredits, rawTitle] = m;
    const credits = parseCredits(rawCredits);
    if (credits === undefined) continue;
    out.push({
      code,
      title: decodeEntities(rawTitle.replace(/<[^>]+>/g, '')),
      credits,
      tags: [],
    });
  }
  return out;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (grad-planner ingest)' },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const byCode = new Map<string, Entry>();
  let total = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = parseRows(await fetchHtml(`${PAGE}?page=${p}`));
    if (rows.length === 0) break;
    total += rows.length;
    for (const r of rows) {
      const prior = byCode.get(r.code);
      // Repeated rows are per-term offerings; keep the larger credit value.
      if (!prior || r.credits > prior.credits) byCode.set(r.code, { ...prior, ...r });
    }
  }
  if (byCode.size < 80) {
    throw new Error(`Only ${byCode.size} courses crawled; pagination or layout changed?`);
  }

  for (const c of CURATED) {
    if (!byCode.has(c.code)) byCode.set(c.code, c);
  }
  // The capstone sequence applies regardless of which source provided 481.
  const cap = byCode.get('EDUC 481');
  if (cap && byCode.has('EDUC 482')) cap.sequenceNext = 'EDUC 482';

  const missing = REQUIRED_CODES.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Required codes missing from catalog: ${missing.join(', ')}`);
  }

  const courses = [...byCode.values()].sort(
    (a, b) => Number(a.code.split(' ')[1]) - Number(b.code.split(' ')[1]),
  );
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source:
          'Marsal course syllabi table (marsal.umich.edu/academics-admissions/course-syllabi, all pages) plus LEAPS and elementary teacher education program-page entries for courses the table does not carry',
        courses,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`Wrote ${courses.length} courses to ${OUT} (${total} table rows crawled)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
