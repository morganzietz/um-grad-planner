/**
 * Stamps School of Art & Design course catalog from the school's official
 * course browser (stamps.umich.edu/courses). The live site publishes one
 * term at a time (currently Fall 2026) as a plain server-rendered table,
 * plus topic filters (?topic=ID) that expose the school's own course
 * designations: Studio, Academic, Elective, Required, Engagement, Mini,
 * HTC (history/theory/criticism), ULWR Approved, Non-Major, and Graduate.
 * Those designations drive the BFA/BA studio-elective and academic rules,
 * so each filtered view is fetched and recorded as tags.
 *
 * Winter coverage comes from the November 2025 Internet Archive capture of
 * the same page, which carries the Fall 2025 + Winter 2026 listings. The
 * Wayback Machine has no captures of the topic-filtered views or (usably)
 * of the per-course detail pages, so archive-only courses get designations
 * from the curated map below: the two writing courses are academic, study
 * abroad terms are tagged as such, 500+ numbers are graduate, and every
 * other archive-only ARTDES 200-499 entry is a studio elective (verified
 * against the capture's titles by hand; the school's winter studios are
 * exactly the rows that look like studios).
 *
 * When a course appears both live and archived, the live row wins on
 * title/credits and offered terms are unioned.
 *
 * Run: npx tsx scripts/ingest/stamps-catalog.ts
 * Output: data/courses/stamps-catalog.json (merged by lib/data.ts, gap-fill
 * only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'stamps-catalog.json');
const LIVE = 'https://stamps.umich.edu/courses';
const ARCHIVE =
  'https://web.archive.org/web/20251123162134/https://stamps.umich.edu/courses';

/** Topic filter ids from the course browser's designation facets. */
const TOPICS: { id: number; tag: string }[] = [
  { id: 112505, tag: 'stamps-studio' },
  { id: 112595, tag: 'stamps-academic' },
  { id: 112506, tag: 'stamps-elective' },
  { id: 112514, tag: 'stamps-required' },
  { id: 112509, tag: 'stamps-engagement' },
  { id: 112664, tag: 'stamps-mini' },
  { id: 173279, tag: 'stamps-htc' },
  { id: 112825, tag: 'stamps-ulwr-approved' },
  { id: 112500, tag: 'stamps-nonmajor' },
  { id: 112870, tag: 'stamps-grad' },
];

/**
 * Designations for archive-only courses (see file header). Codes absent
 * from this map default to studio elective when ARTDES 100-499, graduate
 * when 500+, and study-abroad when the subject is ADABRD.
 */
const ARCHIVE_DESIGNATIONS: Record<string, string[]> = {
  'ARTDES 389': ['stamps-academic', 'stamps-elective', 'stamps-htc', 'stamps-ulwr-approved'],
  'ARTDES 406': ['stamps-academic', 'stamps-elective'],
  'ARTDES 220': ['stamps-studio', 'stamps-required'],
  'ARTDES 151': ['stamps-academic', 'stamps-required'],
  'ARTDES 499': ['stamps-studio', 'stamps-elective'],
  'UARTS 150': [],
  'UARTS 250': [],
  'INTPERF 150': [],
};

/** Codes the Stamps major files reference; the run fails if any are absent. */
const REQUIRED_CODES = [
  'ARTDES 100', 'ARTDES 105', 'ARTDES 115', 'ARTDES 120', 'ARTDES 125',
  'ARTDES 130', 'ARTDES 220', 'ARTDES 150', 'ARTDES 151', 'ARTDES 160',
  'ARTDES 399', 'ARTDES 499',
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
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseTermKind(sem: string): TermKind | undefined {
  if (/fall/i.test(sem)) return 'fall';
  if (/winter/i.test(sem)) return 'winter';
  if (/spring/i.test(sem)) return 'spring';
  if (/summer/i.test(sem)) return 'summer';
  return undefined;
}

interface Row {
  code: string;
  title: string;
  credits: number;
  terms: Set<TermKind>;
}

/** Parse the course table: one row per section; collapse to one per code. */
function parseRows(html: string): Map<string, Row> {
  const out = new Map<string, Row>();
  const rowRe =
    /<td data-label="Course Name">\s*<a href="[^"]*\/courses\/\d+">([^<]+)<\/a>\s*<\/td>\s*<td data-label="Course Number">\s*([A-Z]+ \d+)\.\d+\s*<\/td>\s*<td data-label="Course details">\s*Credit Hours: ([\d.]+)\s*(?:<br>Semester: ([^<]+))?/g;
  for (const m of html.matchAll(rowRe)) {
    const [, rawTitle, code, rawCredits, rawSem] = m;
    const term = rawSem ? parseTermKind(rawSem) : undefined;
    const prior = out.get(code);
    if (prior) {
      if (term) prior.terms.add(term);
      // Sections of the same course occasionally differ in credits
      // (variable-credit topics); record the maximum, per catalog convention.
      prior.credits = Math.max(prior.credits, Number(rawCredits));
    } else {
      out.set(code, {
        code,
        title: decodeEntities(rawTitle),
        credits: Number(rawCredits),
        terms: new Set(term ? [term] : []),
      });
    }
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

function defaultArchiveTags(code: string): string[] {
  const curated = ARCHIVE_DESIGNATIONS[code];
  if (curated) return curated;
  const [subject, num] = code.split(' ');
  if (subject === 'ADABRD') return ['stamps-abroad'];
  const n = Number(num);
  if (n >= 500) return ['stamps-grad'];
  if (subject === 'ARTDES' && n >= 100 && n <= 499) {
    return ['stamps-studio', 'stamps-elective'];
  }
  return [];
}

async function main() {
  const live = parseRows(await fetchHtml(LIVE));
  if (live.size < 60) {
    throw new Error(`Live page: only ${live.size} courses parsed; layout changed?`);
  }

  // Designation tags for live courses, from the topic-filtered views.
  const tagsByCode = new Map<string, Set<string>>();
  for (const { id, tag } of TOPICS) {
    const rows = parseRows(await fetchHtml(`${LIVE}?topic=${id}`));
    for (const code of rows.keys()) {
      if (!tagsByCode.has(code)) tagsByCode.set(code, new Set());
      tagsByCode.get(code)!.add(tag);
    }
  }
  if ((tagsByCode.get('ARTDES 100') ?? new Set()).size === 0) {
    throw new Error('Topic filters returned no designations; layout changed?');
  }

  const archived = parseRows(await fetchHtml(ARCHIVE));
  if (archived.size < 100) {
    throw new Error(`Archive capture: only ${archived.size} courses parsed`);
  }

  const byCode = new Map<string, Entry>();
  for (const r of live.values()) {
    byCode.set(r.code, {
      code: r.code,
      title: r.title,
      credits: r.credits,
      tags: [...(tagsByCode.get(r.code) ?? [])].sort(),
      offeredTerms: [...r.terms],
    });
  }
  for (const r of archived.values()) {
    const prior = byCode.get(r.code);
    if (prior) {
      const terms = new Set<TermKind>([...(prior.offeredTerms ?? []), ...r.terms]);
      prior.offeredTerms = [...terms];
    } else {
      byCode.set(r.code, {
        code: r.code,
        title: r.title,
        credits: r.credits,
        tags: defaultArchiveTags(r.code).sort(),
        offeredTerms: [...r.terms],
      });
    }
  }

  // The Integrative Project spans senior fall into winter; planning the
  // fall half auto-places the winter half.
  const ip = byCode.get('ARTDES 498');
  if (ip && byCode.has('ARTDES 499')) {
    (ip as Entry & { sequenceNext?: string }).sequenceNext = 'ARTDES 499';
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
          'Stamps course browser (stamps.umich.edu/courses, live Fall 2026 listing + designation topic filters, plus the 2025-11-23 Internet Archive capture for Fall 2025/Winter 2026 listings)',
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
