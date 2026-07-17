/**
 * LSA CG ingest driver.
 *
 * Uses saved .auth/state.json to hit LSA CG authenticated. For each configured
 * term, discovers the subject list from LSA CG itself, fetches results per
 * (term, subject), groups sections into unique courses, then fetches one
 * detail page per unique course. Output → data/courses/lsa.json.
 *
 * Rate limit: REQUEST_DELAY_MS between requests, sequential. No concurrency.
 *
 * ─── Adding a new term (e.g. once Winter 2027 publishes) ────────────────────
 * Add a `term('winter', 2027)` entry to the TERMS array below. Everything
 * else — subject discovery, dedup, output — flows automatically.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * CLI options:
 *   --dry            Print what would be scraped (subjects × terms) and exit.
 *   --subjects=X,Y   Restrict to a comma-separated allowlist (default: all).
 *
 * Prereqs: run `npm run ingest:auth` first.
 * Run: npm run ingest:lsa
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  parseListingPage,
  parseDetailPage,
  parseSubjectList,
  groupSectionsToCourses,
  toCourse,
  term,
  type GroupedCourse,
  type ListingSection,
} from '../../lib/ingest/lsa-cg';
import type { Course } from '../../lib/types';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const OUTPUT_DIR = join(process.cwd(), 'data/courses');
const OUTPUT_PATH = join(OUTPUT_DIR, 'lsa.json');

const CG_BASE = 'https://webapps.lsa.umich.edu/cg';
const REQUEST_DELAY_MS = 500;

// Terms to scrape. To include a newly-published term, add a new `term(...)`
// entry below. Order does not matter — the ingest dedupes across terms.
const TERMS = [
  term('fall', 2026),
  term('winter', 2026),
];

// ── CLI parsing ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const SUBJECTS_ARG = args.find((a) => a.startsWith('--subjects='));
const SUBJECTS_ALLOWLIST = SUBJECTS_ARG
  ? new Set(
      SUBJECTS_ARG
        .slice('--subjects='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0),
    )
  : null;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(page: Page, url: string, retries = 3): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      return await page.content();
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message.split('\n')[0];
      console.log(`  [retry ${attempt}/${retries}] ${msg}`);
      if (attempt < retries) await sleep(2000 * attempt); // 2s, 4s
    }
  }
  throw lastErr;
}

interface ProgressFile {
  courses: Course[];
  errors: { code: string; url: string; message: string }[];
}

function loadProgress(): ProgressFile {
  if (!existsSync(OUTPUT_PATH)) return { courses: [], errors: [] };
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as {
      courses?: Course[];
      errors?: ProgressFile['errors'];
    };
    return {
      courses: parsed.courses ?? [],
      errors: parsed.errors ?? [],
    };
  } catch {
    return { courses: [], errors: [] };
  }
}

function writePartial(
  courses: Course[],
  errors: ProgressFile['errors'],
  subjects: string[],
  status: 'partial' | 'done',
): void {
  const sorted = [...courses].sort((a, b) => a.code.localeCompare(b.code));
  const output = {
    generatedAt: new Date().toISOString(),
    status,
    terms: TERMS.map((t) => t.label),
    subjects,
    count: sorted.length,
    courses: sorted,
    errors,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
}

function subjectListUrl(termCode: string): string {
  const params = new URLSearchParams({
    termArray: termCode,
    cgtype: 'ug',
    allsections: 'true',
  });
  return `${CG_BASE}/cg_subjectlist.aspx?${params.toString()}`;
}

function listingUrl(termCode: string, department: string): string {
  const params = new URLSearchParams({
    termArray: termCode,
    cgtype: 'ug',
    allsections: 'true',
    show: '999',
    department,
  });
  return `${CG_BASE}/cg_results.aspx?${params.toString()}`;
}

function absoluteDetailUrl(relative: string): string {
  if (relative.startsWith('http')) return relative;
  return `${CG_BASE}/${relative.replace(/^\/+/, '')}`;
}

async function main() {
  if (!existsSync(STATE_PATH)) {
    console.error(`No auth state at ${STATE_PATH}. Run: npm run ingest:auth`);
    process.exit(1);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  // Step 1: discover subjects per term (union across terms).
  const allSubjects = new Set<string>();
  for (const t of TERMS) {
    const url = subjectListUrl(t.code);
    console.log(`[subjects] ${t.label} → ${url}`);
    const html = await fetchHtml(page, url);
    const subs = parseSubjectList(html);
    console.log(`           ${subs.length} subjects`);
    for (const s of subs) {
      if (!SUBJECTS_ALLOWLIST || SUBJECTS_ALLOWLIST.has(s)) {
        allSubjects.add(s);
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }
  const subjects = Array.from(allSubjects).sort();
  console.log(
    `\n[subjects] ${subjects.length} unique across ${TERMS.length} term(s)` +
      (SUBJECTS_ALLOWLIST ? ` (filtered by --subjects=)` : ''),
  );

  // If we got 0 subjects across ALL terms, the auth session almost certainly
  // expired — LSA CG returns a login page but our parser sees no department= links.
  // Fail loudly instead of touching the output file.
  if (subjects.length === 0) {
    await browser.close();
    console.error(
      '\n[error] discovered 0 subjects across all terms.\n' +
        '        This almost always means your saved auth session expired.\n' +
        '        Run: npm run ingest:auth\n' +
        '        Then re-run: npm run ingest:lsa',
    );
    process.exit(2);
  }

  if (DRY_RUN) {
    console.log('\n[dry] Would scrape:');
    console.log('  terms   :', TERMS.map((t) => t.label).join(', '));
    console.log('  subjects:', subjects.join(', '));
    console.log(
      `  estimated listings: ${subjects.length * TERMS.length} × 1 = ${subjects.length * TERMS.length}`,
    );
    console.log('  detail-page count is unknown until listings are pulled.');
    await browser.close();
    return;
  }

  // Step 2: collect listing sections for every (term, subject) pair.
  const allSections: ListingSection[] = [];
  let listingIdx = 0;
  const totalListings = subjects.length * TERMS.length;
  for (const t of TERMS) {
    for (const s of subjects) {
      listingIdx++;
      const url = listingUrl(t.code, s);
      const html = await fetchHtml(page, url);
      const sections = parseListingPage(html);
      allSections.push(...sections);
      if (listingIdx % 10 === 0 || sections.length === 0) {
        console.log(
          `[listing ${listingIdx}/${totalListings}] ${t.label} ${s}: ${sections.length} sections`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  // Step 3: dedupe to unique courses across terms + subjects.
  const grouped = groupSectionsToCourses(allSections);
  console.log(
    `\n[dedupe] ${allSections.length} sections → ${grouped.length} unique courses`,
  );

  // Step 4: fetch one detail page per unique course.
  // Resume support: if lsa.json already has some courses, skip re-fetching them.
  const progress = loadProgress();
  const alreadyDone = new Set(progress.courses.map((c) => c.code));
  if (alreadyDone.size > 0) {
    console.log(`\n[resume] skipping ${alreadyDone.size} courses already in lsa.json`);
  }
  const courses: Course[] = [...progress.courses];
  const errors: ProgressFile['errors'] = [...progress.errors];
  const CHECKPOINT_EVERY = 100;

  for (let i = 0; i < grouped.length; i++) {
    const g: GroupedCourse = grouped[i];
    const code = `${g.subject} ${g.catalog}`;
    if (alreadyDone.has(code)) continue;

    const url = absoluteDetailUrl(g.detailUrl);
    if (i % 25 === 0 || i === grouped.length - 1) {
      console.log(
        `[detail ${i + 1}/${grouped.length}] ${g.subject} ${g.catalog} — ${g.title}`,
      );
    }
    try {
      const html = await fetchHtml(page, url);
      const detail = parseDetailPage(html);
      courses.push(toCourse(g, detail));
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      console.log(`  [skip] ${code}: ${msg}`);
      errors.push({ code, url, message: msg });
    }
    await sleep(REQUEST_DELAY_MS);

    // Periodic checkpoint so a crash doesn't lose progress.
    if ((i + 1) % CHECKPOINT_EVERY === 0) {
      writePartial(courses, errors, subjects, 'partial');
      console.log(`  [checkpoint] wrote ${courses.length} courses to disk`);
    }
  }

  await browser.close();

  // Step 5: final write.
  writePartial(courses, errors, subjects, 'done');
  console.log(
    `\n[done] ${courses.length} courses → ${OUTPUT_PATH}` +
      (errors.length > 0 ? ` (${errors.length} skipped after retries)` : ''),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
