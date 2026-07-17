/**
 * One-time interactive login for LSA Course Guide.
 *
 * Opens a real Chromium window. You complete Weblogin + Duo yourself.
 * The script polls the browser URL every 2 seconds — as soon as you land
 * on any lsa.umich.edu/cg/ page, it saves your session cookies to
 * .auth/state.json (gitignored) and exits.
 *
 * If you hit a "Bad Request" during SSO, just hit back / reload and try again.
 *
 * Run: npm run ingest:auth
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const START_URL = 'https://www.lsa.umich.edu/cg/';
const OVERALL_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

async function waitForLoggedInUrl(page: Page): Promise<string> {
  const start = Date.now();
  let lastUrl = '';
  while (Date.now() - start < OVERALL_TIMEOUT_MS) {
    const url = page.url();
    if (url !== lastUrl) {
      console.log(`  [url] ${url}`);
      lastUrl = url;
    }
    // Consider us "logged in" when the URL points at any *.lsa.umich.edu path
    // that isn't SSO. LSA CG actually lives on webapps.lsa.umich.edu after login.
    if (
      /^https:\/\/[a-z0-9-]+\.lsa\.umich\.edu\//.test(url) &&
      !url.includes('shibboleth')
    ) {
      return url;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for LSA CG login (${OVERALL_TIMEOUT_MS / 1000}s)`);
}

async function main() {
  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('→ Opening LSA Course Guide...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {
    console.log('  (initial navigation errored — that is OK, keep going in the browser)');
  });

  console.log('');
  console.log('Complete Weblogin + Duo in the browser window.');
  console.log('If you see a Bad Request, use back / reload and try again.');
  console.log('Once you can see LSA CG content, the script will auto-save and exit.');
  console.log('');

  const finalUrl = await waitForLoggedInUrl(page);
  console.log(`→ Detected LSA CG page: ${finalUrl}`);
  console.log('→ Saving session state...');
  await context.storageState({ path: STATE_PATH });
  console.log(`→ Saved to ${STATE_PATH}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
