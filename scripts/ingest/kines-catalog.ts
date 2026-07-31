/**
 * School of Kinesiology course catalog from the school's official Drupal
 * course catalog (kines.umich.edu/academics/course-catalog). The live HTML
 * sits behind Cloudflare and rejects non-browser fetches (the school's PDFs
 * fetch fine, its pages do not), so this reads Internet Archive captures of
 * the catalog's paginated views table instead. Coverage was verified capture
 * by capture: the June 2024 per-curriculum facet captures (AT=40, AES=41,
 * KINESLGY=43, SM=44, MOVESCI=45) each reach their last page (no next-pager
 * on the final capture), and the December 2024 to May 2025 captures of the
 * unfaceted listing (?page=0..11) plus the February 2026 capture of page one
 * refresh most entries. Rows carry course code, title, credits, and terms.
 * When the same course appears in several captures the newest capture wins.
 *
 * Six courses referenced by the 2025-2026 Undergraduate Bulletin and the
 * published AES electives list postdate every usable capture and are
 * hand-curated below (AES 337, AES 417, AES 420 from the AES electives doc;
 * SM 464, SM 465, SM 480 from the bulletin's concentration path lists).
 * None of the fetchable sources publish a credit value for these six, so
 * they are asserted at 3 credits, the standard Kinesiology lecture
 * elective load.
 *
 * Variable-credit courses ("1 - 3") record the maximum, matching the
 * nursing-catalog convention.
 *
 * Run: npx tsx scripts/ingest/kines-catalog.ts
 * Output: data/courses/kines-catalog.json (merged by lib/data.ts, gap-fill
 * only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'kines-catalog.json');
const ORIGIN = 'https://www.kines.umich.edu/academics/course-catalog';

/**
 * Verified Internet Archive captures. `q` is the original query string.
 * Facet captures (June 2024) enumerate one curriculum each and are the
 * complete pagination for that facet; the unfaceted page captures and the
 * 2026 capture refresh titles/credits with newer data where archived.
 */
const CAPTURES: { ts: string; q: string }[] = [
  // Athletic Training facet (single page; AT is graduate-only since 2020).
  { ts: '20240615191618', q: '?f%5B0%5D=curriculum%3A40' },
  // AES facet.
  { ts: '20240616005035', q: '?f%5B0%5D=curriculum%3A41&page=0' },
  { ts: '20240616005413', q: '?f%5B0%5D=curriculum%3A41&page=1' },
  // KINESLGY facet.
  { ts: '20240616034245', q: '?f%5B0%5D=curriculum%3A43&page=0' },
  { ts: '20240616035015', q: '?f%5B0%5D=curriculum%3A43&page=1' },
  { ts: '20240616035154', q: '?f%5B0%5D=curriculum%3A43&page=2' },
  // SM facet.
  { ts: '20240616092153', q: '?f%5B0%5D=curriculum%3A44&page=0' },
  { ts: '20240616092220', q: '?f%5B0%5D=curriculum%3A44&page=1' },
  { ts: '20240616092246', q: '?f%5B0%5D=curriculum%3A44&page=2' },
  // MOVESCI facet.
  { ts: '20240616074709', q: '?f%5B0%5D=curriculum%3A45&page=0' },
  { ts: '20240616074755', q: '?f%5B0%5D=curriculum%3A45&page=1' },
  { ts: '20240616074844', q: '?f%5B0%5D=curriculum%3A45&page=2' },
  { ts: '20240616074934', q: '?f%5B0%5D=curriculum%3A45&page=3' },
  // Unfaceted listing, newest archived capture per page.
  { ts: '20241215195123', q: '?page=0' },
  { ts: '20250526003131', q: '?page=1' },
  { ts: '20241215195536', q: '?page=2' },
  { ts: '20241215195809', q: '?page=3' },
  { ts: '20250524003620', q: '?page=4' },
  { ts: '20241215200324', q: '?page=5' },
  { ts: '20241215200720', q: '?page=6' },
  { ts: '20250523052944', q: '?page=7' },
  { ts: '20250524205107', q: '?page=8' },
  { ts: '20240617002729', q: '?page=9' },
  { ts: '20240617005721', q: '?page=10' },
  { ts: '20241215201527', q: '?page=11' },
  // Newest capture of the catalog front page (first 24 rows, AES 100-333).
  { ts: '20260225170336', q: '' },
];

/**
 * Hand-curated entries newer than every archived capture. Titles come from
 * the 2025-2026 Undergraduate Bulletin and the published AES electives doc;
 * credits are asserted (see file header).
 */
const CURATED: Entry[] = [
  {
    code: 'AES 337',
    title: 'Developing Social-Emotional Skills Through Physical Activities for Children',
    credits: 3,
    tags: [],
  },
  { code: 'AES 417', title: 'Intro to Qualitative Research Methods', credits: 3, tags: [] },
  { code: 'AES 420', title: 'Obesity Weight Management & Exercise', credits: 3, tags: [] },
  { code: 'SM 464', title: 'Sport and Development', credits: 3, tags: [] },
  { code: 'SM 465', title: 'Global Perspectives in Sport Management', credits: 3, tags: [] },
  { code: 'SM 480', title: 'Business of Sport and Environmental Sustainability', credits: 3, tags: [] },
];

/** Codes the Kinesiology major files reference; the run fails if any are absent. */
const REQUIRED_CODES = [
  'AES 100', 'AES 110', 'AES 218', 'AES 220', 'AES 221', 'AES 242', 'AES 243',
  'AES 290', 'AES 313', 'AES 315', 'AES 330', 'AES 331', 'AES 332', 'AES 333',
  'AES 334', 'AES 336', 'AES 337', 'AES 402', 'AES 403', 'AES 407', 'AES 408',
  'AES 413', 'AES 416', 'AES 417', 'AES 420', 'AES 425', 'AES 426', 'AES 446',
  'AES 451', 'AES 460', 'AES 470', 'AES 493',
  'MOVESCI 110', 'MOVESCI 219', 'MOVESCI 230', 'MOVESCI 231', 'MOVESCI 250',
  'MOVESCI 320', 'MOVESCI 330', 'MOVESCI 340', 'MOVESCI 413', 'MOVESCI 421',
  'MOVESCI 422', 'MOVESCI 423', 'MOVESCI 424', 'MOVESCI 425', 'MOVESCI 428',
  'MOVESCI 431', 'MOVESCI 434', 'MOVESCI 437', 'MOVESCI 438', 'MOVESCI 442',
  'MOVESCI 443', 'MOVESCI 446', 'MOVESCI 447', 'MOVESCI 448', 'MOVESCI 451',
  'MOVESCI 452', 'MOVESCI 453', 'MOVESCI 465', 'MOVESCI 475',
  'SM 100', 'SM 101', 'SM 111', 'SM 203', 'SM 217', 'SM 238', 'SM 239',
  'SM 241', 'SM 246', 'SM 249', 'SM 313', 'SM 317', 'SM 330', 'SM 331',
  'SM 332', 'SM 333', 'SM 361', 'SM 403', 'SM 428', 'SM 429', 'SM 430',
  'SM 431', 'SM 433', 'SM 434', 'SM 435', 'SM 436', 'SM 437', 'SM 438',
  'SM 439', 'SM 440', 'SM 441', 'SM 442', 'SM 443', 'SM 444', 'SM 445',
  'SM 446', 'SM 451', 'SM 454', 'SM 461', 'SM 462', 'SM 463', 'SM 464',
  'SM 465', 'SM 470', 'SM 480', 'SM 499', 'KINESLGY 302',
];

type TermKind = 'fall' | 'winter' | 'spring' | 'summer';

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  offeredTerms?: TermKind[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "3", "1.5", "1 - 4", "1.5-3" -> maximum listed value. */
function parseCredits(raw: string): number | undefined {
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return undefined;
  return Math.max(...nums.map(Number));
}

function parseTerms(raw: string): TermKind[] {
  const out: TermKind[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim().toLowerCase();
    if (t === 'fall' || t === 'winter' || t === 'spring' || t === 'summer') {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

function parseCapture(html: string): Omit<Entry, 'tags'>[] {
  const rows: Omit<Entry, 'tags'>[] = [];
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = new Map<string, string>();
    for (const td of tr[1].matchAll(
      /class="views-field views-field-([\w-]+)"[^>]*>([\s\S]*?)<\/td>/g,
    )) {
      cells.set(td[1], cellText(td[2]));
    }
    const code = cells.get('title') ?? '';
    if (!/^[A-Z]+ \d+$/.test(code)) continue;
    const credits = parseCredits(cells.get('field-course-credit-hour') ?? '');
    if (credits === undefined) continue;
    const entry: Omit<Entry, 'tags'> = {
      code,
      title: cells.get('field-course-name-ro') || code,
      credits,
    };
    const offeredTerms = parseTerms(cells.get('field-course-term') ?? '');
    if (offeredTerms.length > 0) entry.offeredTerms = offeredTerms;
    rows.push(entry);
  }
  return rows;
}

async function main() {
  // code -> [capture timestamp, entry]; newest capture wins.
  const best = new Map<string, [string, Entry]>();
  for (const { ts, q } of CAPTURES) {
    const url = `https://web.archive.org/web/${ts}/${ORIGIN}${q}`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      const rows = parseCapture(await res.text());
      if (rows.length === 0) throw new Error('no course rows parsed');
      for (const row of rows) {
        const prev = best.get(row.code);
        if (!prev || ts > prev[0]) best.set(row.code, [ts, { ...row, tags: [] }]);
      }
      console.log(`[ok] ${q || '(front page)'} @${ts}: ${rows.length} rows`);
    } catch (e) {
      console.error(`[skip] ${url}: ${e}`);
    }
  }

  const byCode = new Map<string, Entry>();
  for (const [code, [, entry]] of best) byCode.set(code, entry);
  for (const c of CURATED) {
    if (!byCode.has(c.code)) byCode.set(c.code, c);
  }

  const missing = REQUIRED_CODES.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`major-referenced codes missing from catalog: ${missing.join(', ')}`);
  }

  const courses = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  const subjects = Array.from(new Set(courses.map((c) => c.code.split(' ')[0]))).sort();
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source:
          'School of Kinesiology course catalog (kines.umich.edu/academics/course-catalog) via Internet Archive captures, plus hand-curated 2025-2026 bulletin courses',
        subjects,
        courses,
      },
      null,
      1,
    ),
  );
  console.log(`[done] ${courses.length} courses across ${subjects.length} subjects -> ${OUT}`);
  console.log(subjects.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
