/**
 * Recon: click a major row on LSA's majors-minors page and see what URL/API
 * gets called to load the requirements. Print any XHR/fetch requests that
 * fire, plus the resolved HTML in the detail panel.
 *
 * Run: npx tsx scripts/ingest/lsa-detail-recon.ts
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures/lsa-depts');
const LIST_URL = 'https://lsa.umich.edu/lsa/academics/majors-minors.html';

async function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...(existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {}),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Log every network request whose URL contains "anthropology" or "program-detail"
  // or JSON-ish content types, so we can spot the requirements-loading call.
  page.on('request', (req) => {
    const url = req.url();
    if (
      /anthropology|program|requirement|jcr:|\.json|api/i.test(url) &&
      !url.includes('.png') &&
      !url.includes('.jpg') &&
      !url.includes('.css')
    ) {
      console.log(`  [req]  ${req.method()} ${url}`);
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] ?? '';
    if (/anthropology|program|requirement/i.test(url) && /json|html/i.test(ct)) {
      console.log(`  [res]  ${res.status()} ${ct.split(';')[0]} ${url}`);
      try {
        const body = await res.text();
        const fname = url.replace(/[^a-z0-9]/gi, '_').slice(-60) + '.txt';
        writeFileSync(join(FIXTURE_DIR, fname), body);
        console.log(`         saved ${body.length} bytes`);
      } catch { /* ignore */ }
    }
  });

  console.log(`→ ${LIST_URL}`);
  await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    const t = await page.title();
    if (!/just a moment/i.test(t)) break;
    await page.waitForTimeout(2000);
  }
  console.log('  landed:', await page.title());

  // Click the Anthropology (Major) row and see what happens.
  console.log('\n→ Clicking anthropology-maj...');
  await page.click('#anthropology-maj a, tr#anthropology-maj').catch((e) => {
    console.log('  click error:', e.message.split('\n')[0]);
  });

  await page.waitForTimeout(3000);

  // Capture whatever detail panel now exists in the DOM
  const detail = await page.evaluate(() => {
    // Try common detail-panel selectors
    const sels = [
      '.program-detail-content',
      '.lsa-program-detail',
      '.program-detail',
      '[class*="program-detail"]',
      '#anthropology-maj + tr',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.innerHTML.length > 500) return { sel: s, html: el.outerHTML };
    }
    return null;
  });

  if (detail) {
    console.log(`  detail panel found via ${detail.sel} (${detail.html.length} chars)`);
    writeFileSync(join(FIXTURE_DIR, 'anthropology-detail.html'), detail.html);
    console.log(`  saved anthropology-detail.html`);
  } else {
    console.log('  no detail panel detected. Saving full page HTML for inspection.');
    writeFileSync(join(FIXTURE_DIR, 'after-click.html'), await page.content());
  }

  // Give a moment to look
  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
