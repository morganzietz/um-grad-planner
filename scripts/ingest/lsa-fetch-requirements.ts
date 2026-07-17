/**
 * Fetch every LSA major and minor's requirements HTML.
 *
 * For each program in data/lsa-programs.json:
 *   1. Hit the AEM detail endpoint to get the "REQUIREMENTS" link.
 *   2. Fetch that link.
 *   3. Save the raw HTML to lib/ingest/fixtures/lsa-req/{slug}-{kind}.html.
 *
 * Rate limit: 250ms between fetches. Cloudflare-friendly.
 *
 * Prereq: run `npm run ingest:lsa-list` at least once so we have the program
 * inventory in data/lsa-programs.json.
 *
 * Run: npm run ingest:lsa-requirements
 */
import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const PROGRAMS = join(process.cwd(), 'data/lsa-programs.json');
const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures/lsa-req');
const MANIFEST = join(FIXTURE_DIR, '_manifest.json');
const DELAY_MS = 250;

const AEM_BASE =
  'https://lsa.umich.edu/content/michigan-lsa/en/academics/majors-minors/jcr:content/gridpar/lsa_gridwrapper/responsivegrid/lsa_majorsminors.program_detail.html';

interface LSAProgram {
  slug: string;
  name: string;
  kind: 'major' | 'minor' | 'sub-major';
}

interface Manifest {
  generatedAt: string;
  entries: {
    slug: string;
    kind: string;
    fixture: string;
    requirementsUrl?: string;
    error?: string;
  }[];
}

const KIND_SHORT: Record<string, string> = {
  major: 'maj',
  minor: 'min',
  'sub-major': 'sub',
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(page: Page, url: string, retries = 2): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      // Wait through any CF challenge (should be rare after the first pass sets the cookie).
      for (let i = 0; i < 10; i++) {
        const t = await page.title();
        if (!/just a moment/i.test(t)) break;
        await page.waitForTimeout(1500);
      }
      return await page.content();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

async function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const programs = (JSON.parse(readFileSync(PROGRAMS, 'utf8')) as {
    programs: LSAProgram[];
  }).programs;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...(existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {}),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Warm up: load the majors-minors index to pass Cloudflare and get the AEM
  // routing state seeded.
  console.log('[warmup] loading majors-minors index...');
  await fetchWithRetry(page, 'https://lsa.umich.edu/lsa/academics/majors-minors.html');

  const manifest: Manifest = { generatedAt: new Date().toISOString(), entries: [] };
  let ok = 0;
  let miss = 0;

  for (let idx = 0; idx < programs.length; idx++) {
    const p = programs[idx];
    const short = KIND_SHORT[p.kind];
    const aemUrl = `${AEM_BASE}/${p.slug}-${short}.html`;
    const fixtureName = `${p.slug}-${short}.html`;
    const fixturePath = join(FIXTURE_DIR, fixtureName);
    const entry = {
      slug: p.slug,
      kind: p.kind,
      fixture: fixtureName,
    } as Manifest['entries'][number];

    try {
      // Step 1: get the AEM detail panel HTML
      const detailHtml = await fetchWithRetry(page, aemUrl);
      const $d = load(detailHtml);
      // Look for REQUIREMENTS button link
      const reqAnchor = $d('a')
        .toArray()
        .find((a) => ($d(a).text() ?? '').trim().toUpperCase() === 'REQUIREMENTS');
      if (!reqAnchor) {
        entry.error = 'no REQUIREMENTS link';
        miss++;
      } else {
        let reqHref = $d(reqAnchor).attr('href') ?? '';
        if (reqHref.startsWith('/')) reqHref = `https://lsa.umich.edu${reqHref}`;
        entry.requirementsUrl = reqHref;
        // Step 2: fetch the requirements page
        const reqHtml = await fetchWithRetry(page, reqHref);
        writeFileSync(fixturePath, reqHtml);
        ok++;
      }
    } catch (e) {
      entry.error = (e as Error).message.split('\n')[0].slice(0, 200);
      miss++;
    }

    manifest.entries.push(entry);
    if ((idx + 1) % 5 === 0 || idx === programs.length - 1) {
      console.log(
        `[${idx + 1}/${programs.length}] ${p.kind.padEnd(9)} ${p.slug.padEnd(50)} ok=${ok} miss=${miss}`,
      );
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    }
    await sleep(DELAY_MS);
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\n[done] ${ok} fetched, ${miss} missed. Manifest: ${MANIFEST}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
