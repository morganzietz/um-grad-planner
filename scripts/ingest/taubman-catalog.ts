/**
 * Taubman College course catalog from the college's official course listing
 * (taubmancollege.umich.edu/courses). The live WordPress listing publishes
 * one term at a time (currently Fall 2026) with rich data attributes per
 * section (code, title, program); credits live only on each course's detail
 * page, so one detail page per unique live course is fetched.
 *
 * Winter coverage comes from the November 2025 Internet Archive capture of
 * the same listing (the Winter 2026 term). Archived detail pages are not
 * reliably captured, so archive-only courses take credits from the curated
 * map below (required-course credits transcribed from the college's 2025
 * undergraduate booklet curriculum charts) and are otherwise asserted at
 * 3 credits, the standard Taubman lecture/seminar load, matching the
 * kines-catalog convention for unfetchable credit values.
 *
 * UT 350 (Strategic Foresight, 3 cr per the booklet chart) appears in
 * neither term's listing and is hand-curated.
 *
 * The in-order UT sequences from the curriculum chart are wired as
 * sequenceNext pairs where the follow-up lands in the next term (UT 435 →
 * UT 230, UT 330 → UT 360, UT 430 → UT 401), as are the consecutive
 * architecture studio pairs (ARCH 312 → 322, ARCH 432 → 442).
 *
 * Run: npx tsx scripts/ingest/taubman-catalog.ts
 * Output: data/courses/taubman-catalog.json (merged by lib/data.ts,
 * gap-fill only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'taubman-catalog.json');
const LIVE = 'https://taubmancollege.umich.edu/courses/';
const ARCHIVE =
  'https://web.archive.org/web/20251111170553/https://taubmancollege.umich.edu/courses/';

/** Booklet-chart credits for archive-only required courses. */
const CURATED_CREDITS: Record<string, number> = {
  'ARCH 251': 2, 'ARCH 252': 2, 'ARCH 253': 2, 'ARCH 254': 2, 'ARCH 255': 2,
  'ARCH 256': 2, 'ARCH 257': 2, 'ARCH 258': 2, 'ARCH 259': 2,
  'ARCH 322': 6, 'ARCH 324': 3, 'ARCH 326': 3, 'ARCH 425': 3, 'ARCH 442': 6,
  'UT 201': 3, 'UT 210': 3, 'UT 230': 4, 'UT 350': 3, 'UT 360': 6,
  'UT 401': 3, 'UT 411': 3,
};

/** Courses in neither term's listing, transcribed from the booklet chart. */
const CURATED: { code: string; title: string; credits: number }[] = [
  { code: 'UT 350', title: 'Strategic Foresight', credits: 3 },
];

const SEQUENCES: Record<string, string> = {
  'UT 435': 'UT 230',
  'UT 330': 'UT 360',
  'UT 430': 'UT 401',
  'ARCH 312': 'ARCH 322',
  'ARCH 432': 'ARCH 442',
};

/** Codes the Taubman major files reference; the run fails if any are absent. */
const REQUIRED_CODES = [
  'ARCH 208', 'ARCH 251', 'ARCH 252', 'ARCH 253', 'ARCH 254', 'ARCH 255',
  'ARCH 256', 'ARCH 257', 'ARCH 258', 'ARCH 259', 'ARCH 312', 'ARCH 313',
  'ARCH 314', 'ARCH 316', 'ARCH 317', 'ARCH 322', 'ARCH 323', 'ARCH 324',
  'ARCH 326', 'ARCH 425', 'ARCH 432', 'ARCH 442',
  'UT 102', 'UT 103', 'UT 201', 'UT 202', 'UT 210', 'UT 230', 'UT 330',
  'UT 340', 'UT 350', 'UT 360', 'UT 401', 'UT 411', 'UT 430', 'UT 435',
];

type TermKind = 'fall' | 'winter' | 'spring' | 'summer';

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  offeredTerms?: TermKind[];
  sequenceNext?: string;
}

interface Item {
  code: string;
  title: string;
  term?: TermKind;
  detailUrl?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Parse the FacetWP listing: one block per section; collapse to codes. */
function parseList(html: string): Map<string, Item> {
  const out = new Map<string, Item>();
  const itemRe =
    /<div id="post-\d+"[^>]*data-title="([^"]*)"[^>]*data-prognum="([A-Z]+)-(\d+)"[^>]*class="[^"]*course-term-([a-z]+)-\d+[^"]*"[^>]*>([\s\S]*?)(?=<div id="post-\d+"|$)/g;
  for (const m of html.matchAll(itemRe)) {
    const [, rawTitle, subject, num, rawTerm, body] = m;
    const code = `${subject} ${num}`;
    if (out.has(code)) continue;
    const href = body.match(
      /href="(?:https:\/\/web\.archive\.org\/web\/\d+\/)?(https:\/\/taubmancollege\.umich\.edu\/course\/[^"]+)"/,
    )?.[1];
    const term =
      rawTerm === 'fall' || rawTerm === 'winter' || rawTerm === 'spring' || rawTerm === 'summer'
        ? (rawTerm as TermKind)
        : undefined;
    out.set(code, { code, title: decodeEntities(rawTitle), term, detailUrl: href });
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

async function fetchCredits(url: string): Promise<number | undefined> {
  try {
    const html = await fetchHtml(url);
    const m = html
      .replace(/<[^>]+>/g, '\n')
      .match(/Credits:\s*\n\s*([\d.]+)/);
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const live = parseList(await fetchHtml(LIVE));
  if (live.size < 60) {
    throw new Error(`Live listing: only ${live.size} courses parsed; layout changed?`);
  }
  const archived = parseList(await fetchHtml(ARCHIVE));
  if (archived.size < 60) {
    throw new Error(`Archive capture: only ${archived.size} courses parsed`);
  }

  const byCode = new Map<string, Entry>();

  for (const item of live.values()) {
    const credits = item.detailUrl ? await fetchCredits(item.detailUrl) : undefined;
    if (credits === undefined) {
      throw new Error(`No credits found for live course ${item.code} (${item.detailUrl})`);
    }
    byCode.set(item.code, {
      code: item.code,
      title: item.title,
      credits,
      tags: [],
      offeredTerms: item.term ? [item.term] : [],
    });
  }

  let asserted = 0;
  for (const item of archived.values()) {
    const prior = byCode.get(item.code);
    if (prior) {
      if (item.term && !(prior.offeredTerms ?? []).includes(item.term)) {
        prior.offeredTerms = [...(prior.offeredTerms ?? []), item.term];
      }
      continue;
    }
    let credits = CURATED_CREDITS[item.code];
    if (credits === undefined) {
      credits = 3;
      asserted++;
    }
    byCode.set(item.code, {
      code: item.code,
      title: item.title,
      credits,
      tags: [],
      offeredTerms: item.term ? [item.term] : [],
    });
  }

  for (const c of CURATED) {
    if (!byCode.has(c.code)) {
      byCode.set(c.code, { ...c, tags: [], offeredTerms: [] });
    }
  }

  for (const [code, next] of Object.entries(SEQUENCES)) {
    const e = byCode.get(code);
    if (e && byCode.has(next)) e.sequenceNext = next;
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
          'Taubman course listing (taubmancollege.umich.edu/courses, live Fall 2026 listing + per-course detail pages for credits, plus the 2025-11-11 Internet Archive capture for Winter 2026 listings; archive-only credits from the 2025 undergraduate booklet charts or asserted at 3)',
        courses,
      },
      null,
      1,
    ) + '\n',
  );
  console.log(
    `Wrote ${courses.length} courses to ${OUT} (${asserted} archive-only credits asserted at 3)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
