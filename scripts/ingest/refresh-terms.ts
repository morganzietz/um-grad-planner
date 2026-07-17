/**
 * Fast pass: re-fetch the LSA CG listing pages for each configured term and
 * patch `offeredTerms` onto every course in data/courses/lsa.json.
 *
 * Doesn't touch detail pages, so it takes ~3 minutes instead of ~45.
 *
 * Prereqs: run `npm run ingest:auth` first (needs a fresh session).
 * Run: npm run ingest:refresh-terms
 */
import { chromium, type Page } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseListingPage, term as makeTerm } from '../../lib/ingest/lsa-cg';
import type { Course, TermKind } from '../../lib/types';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const OUTPUT_PATH = join(process.cwd(), 'data/courses/lsa.json');
const CG_BASE = 'https://webapps.lsa.umich.edu/cg';
const REQUEST_DELAY_MS = 400;

// Match the TERMS you're currently ingesting. Update alongside lsa.ts.
const TERMS: { kind: TermKind; year: number }[] = [
  { kind: 'fall', year: 2026 },
  { kind: 'winter', year: 2026 },
];

function sleep(ms: number) {
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
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
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

async function main() {
  if (!existsSync(STATE_PATH)) {
    console.error(`No auth. Run: npm run ingest:auth`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as {
    subjects: string[];
    courses: Course[];
    [k: string]: unknown;
  };
  const subjects: string[] = data.subjects ?? [];
  if (subjects.length === 0) {
    console.error('No subjects in lsa.json. Run npm run ingest:lsa first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  const codeToTerms = new Map<string, Set<TermKind>>();
  let listingIdx = 0;
  const total = subjects.length * TERMS.length;

  for (const t of TERMS) {
    const termCode = makeTerm(t.kind, t.year).code;
    for (const s of subjects) {
      listingIdx++;
      const url = listingUrl(termCode, s);
      const html = await fetchHtml(page, url);
      const sections = parseListingPage(html);
      let addedForThisCall = 0;
      for (const sec of sections) {
        const code = `${sec.subject} ${sec.catalog}`;
        if (!codeToTerms.has(code)) codeToTerms.set(code, new Set());
        const set = codeToTerms.get(code)!;
        if (!set.has(t.kind)) {
          set.add(t.kind);
          addedForThisCall++;
        }
      }
      if (listingIdx % 25 === 0 || sections.length === 0) {
        console.log(
          `[${listingIdx}/${total}] ${t.kind} ${s}: ${sections.length} sections (${addedForThisCall} new)`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await browser.close();

  // Patch every course
  const orderedKinds: TermKind[] = ['fall', 'winter', 'spring', 'summer'];
  let patched = 0;
  for (const c of data.courses) {
    const terms = codeToTerms.get(c.code);
    if (!terms) continue;
    const kinds = orderedKinds.filter((k) => terms.has(k));
    c.offeredTerms = kinds;
    patched++;
  }
  data.generatedAt = new Date().toISOString();
  writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
  console.log(
    `\n[done] Patched offeredTerms on ${patched} / ${data.courses.length} courses.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
