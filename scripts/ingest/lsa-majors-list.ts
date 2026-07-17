/**
 * Recon: fetch LSA's public "majors and minors" list page. Public LSA pages
 * are Cloudflare-protected against automated user agents, but a real headless
 * Chromium via Playwright passes fingerprint checks.
 *
 * Reuses .auth/state.json only if present; the LSA site typically doesn't
 * require Shibboleth for the majors-minors index.
 *
 * Run: npm run ingest:lsa-list
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures');
const LIST_URL = 'https://lsa.umich.edu/lsa/academics/majors-minors.html';

async function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // Cloudflare fingerprints headless-mode Chromium and serves a challenge.
  // Headed mode with a real user-agent slips through automatically.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...(existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {}),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log(`→ ${LIST_URL}`);
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // If Cloudflare shows a challenge, wait a bit for it to resolve automatically.
  for (let i = 0; i < 15; i++) {
    const t = await page.title();
    if (!/just a moment/i.test(t)) break;
    console.log(`  [challenge] waiting for CF (${i + 1}/15) — title: "${t}"`);
    await page.waitForTimeout(2000);
  }
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  console.log('  final URL:', page.url());
  console.log('  title    :', await page.title());
  const html = await page.content();
  const fixturePath = join(FIXTURE_DIR, 'lsa-majors-minors.html');
  writeFileSync(fixturePath, html);
  console.log('  saved    :', fixturePath, `(${html.length} bytes)`);

  const $ = load(html);

  // Sniff for structure: look for lists of major names + links.
  console.log('\n[sniff] anchor patterns that mention "major" or "minor":');
  const anchors = $('a[href]')
    .toArray()
    .map((a) => ({
      text: ($(a).text() ?? '').replace(/\s+/g, ' ').trim(),
      href: $(a).attr('href') ?? '',
    }))
    .filter(
      (a) =>
        a.text &&
        a.href &&
        /(major|minor|program)/i.test(a.text + ' ' + a.href) &&
        a.text.length > 3 &&
        a.text.length < 100,
    );

  console.log(`  ${anchors.length} candidate anchors (first 20):`);
  for (const a of anchors.slice(0, 20)) {
    console.log(`    ${a.text.padEnd(60)} → ${a.href}`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
