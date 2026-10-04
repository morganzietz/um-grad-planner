/**
 * School of Public Health course catalog from the school's official course
 * browser (sph.umich.edu/research-education/courses/undergrad.php). Unlike
 * the Kinesiology site, these pages are plain server-rendered tables and
 * fetch fine without a browser. Each term page carries two tables: the
 * undergraduate courses, and the graduate courses undergraduates are also
 * allowed to enroll in (which the SPH degree pages explicitly let count as
 * public health electives). Both are ingested.
 *
 * Rows carry course code, title, term(s) offered, and credits. When the same
 * course appears on both the Fall and Winter pages, offered terms are
 * unioned and the newer fetch wins on title/credits (they have never
 * disagreed in practice).
 *
 * Variable-credit courses ("1 - 4") record the maximum, matching the
 * nursing-catalog and kines-catalog convention.
 *
 * Run: npx tsx scripts/ingest/sph-catalog.ts
 * Output: data/courses/sph-catalog.json (merged by lib/data.ts, gap-fill
 * only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'sph-catalog.json');
const PAGE = 'https://sph.umich.edu/research-education/courses/undergrad.php';
const TERMS = ['Fall', 'Winter'] as const;

/** Codes the SPH major files reference; the run fails if any are absent. */
const REQUIRED_CODES = [
  // Integrated core + culminating experience
  'PUBHLTH 380', 'PUBHLTH 381', 'PUBHLTH 382', 'PUBHLTH 383', 'PUBHLTH 384',
  'PUBHLTH 481',
  // BA requirements
  'PUBHLTH 350', 'PUBHLTH 360',
  // BS requirement + science selective
  'PUBHLTH 370', 'PUBHLTH 305', 'PUBHLTH 310', 'PUBHLTH 311',
  // Health equity approved list (PUBHLTH 333 is topic-section based)
  'PUBHLTH 308', 'PUBHLTH 313', 'PUBHLTH 320', 'PUBHLTH 328', 'PUBHLTH 450',
];

type TermKind = 'fall' | 'winter' | 'spring' | 'summer';

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  offeredTerms?: TermKind[];
}

/** "PUBHLTH200" → "PUBHLTH 200". */
function normalizeCode(raw: string): string {
  const m = raw.trim().match(/^([A-Z]+)\s*(\d+)$/);
  if (!m) throw new Error(`Unparseable course code: ${raw}`);
  return `${m[1]} ${m[2]}`;
}

/** "1 - 4" → 4; "3" → 3. Maximum of a range, per catalog convention. */
function parseCredits(raw: string): number {
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) throw new Error(`Unparseable credits: ${raw}`);
  return Math.max(...nums.map(Number));
}

function parseTerms(raw: string): TermKind[] {
  const out: TermKind[] = [];
  if (/fall/i.test(raw)) out.push('fall');
  if (/winter/i.test(raw)) out.push('winter');
  if (/spring/i.test(raw)) out.push('spring');
  if (/summer/i.test(raw)) out.push('summer');
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse every <tr> whose first cell is a course code. The title cell's
 * anchor carries `title="CODE: Full Title"`, which preserves casing better
 * than the capitalized link text, so prefer it.
 */
function parseRows(html: string): Entry[] {
  const entries: Entry[] = [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  for (const row of html.matchAll(rowRe)) {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 5) continue;
    const codeText = stripTags(cells[0]);
    if (!/^[A-Z]+\s*\d+$/.test(codeText)) continue;
    const code = normalizeCode(codeText);
    const titleAttr = cells[1].match(/title="([^"]+)"/)?.[1] ?? '';
    const title = (titleAttr.includes(':')
      ? titleAttr.slice(titleAttr.indexOf(':') + 1)
      : stripTags(cells[1])
    ).trim();
    if (!title) throw new Error(`No title parsed for ${code}`);
    entries.push({
      code,
      title,
      credits: parseCredits(stripTags(cells[4])),
      tags: [],
      offeredTerms: parseTerms(stripTags(cells[3])),
    });
  }
  return entries;
}

async function fetchTerm(term: string): Promise<Entry[]> {
  const res = await fetch(`${PAGE}?term=${term}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (grad-planner ingest)' },
  });
  if (!res.ok) throw new Error(`${term} page: HTTP ${res.status}`);
  const entries = parseRows(await res.text());
  if (entries.length < 20) {
    throw new Error(`${term} page: only ${entries.length} rows parsed; layout changed?`);
  }
  return entries;
}

async function main() {
  const byCode = new Map<string, Entry>();
  for (const term of TERMS) {
    for (const e of await fetchTerm(term)) {
      const prior = byCode.get(e.code);
      if (prior) {
        const terms = new Set<TermKind>([
          ...(prior.offeredTerms ?? []),
          ...(e.offeredTerms ?? []),
        ]);
        byCode.set(e.code, { ...e, offeredTerms: [...terms] });
      } else {
        byCode.set(e.code, e);
      }
    }
  }

  const missing = REQUIRED_CODES.filter((c) => !byCode.has(c));
  if (missing.length > 0) {
    throw new Error(`Required codes missing from catalog: ${missing.join(', ')}`);
  }

  const courses = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source:
          'SPH course browser (sph.umich.edu/research-education/courses/undergrad.php, Fall + Winter term pages, undergraduate and graduate-open-to-undergraduate tables)',
        courses,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(`Wrote ${courses.length} courses to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
