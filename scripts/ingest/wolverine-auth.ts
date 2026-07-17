/**
 * One-time interactive login for Wolverine Access.
 *
 * Opens a real Chromium window pointed at Wolverine Access. You complete
 * Weblogin + Duo yourself, then navigate to the What If / degree audit tool.
 * When you're actually ON the What If page (not the portal, not SSO), come
 * back to this terminal and press Enter. The script saves your session
 * storage state to `.auth/wolverine-state.json` (gitignored) and exits.
 *
 * The manual "I'm ready" prompt avoids fragile URL detection — Wolverine
 * Access routes through several subdomains and portal tiles, so guessing
 * "you're logged in now" from the URL alone is unreliable.
 *
 * Run: npx tsx scripts/ingest/wolverine-auth.ts
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'wolverine-state.json');
const START_URL = 'https://wolverineaccess.umich.edu/';

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  console.log('→ Opening Wolverine Access...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {
    console.log('  (initial navigation errored — keep going in the browser)');
  });

  console.log('');
  console.log('======================================================');
  console.log('  In the browser:');
  console.log('    1. Do Weblogin + Duo.');
  console.log('    2. Navigate to the What If / degree audit tool.');
  console.log('    3. Get to the page where you would pick a major to');
  console.log('       generate a What If report.');
  console.log('');
  console.log('  Come back here and press ENTER when you are on that page.');
  console.log('  I will save the session + capture the URL for you.');
  console.log('======================================================');
  console.log('');

  await prompt('Press ENTER when you\'re on the What If tool page → ');

  const finalUrl = page.url();
  console.log('');
  console.log(`→ Current URL: ${finalUrl}`);
  console.log('→ Saving session storage state...');
  await context.storageState({ path: STATE_PATH });
  console.log(`→ Saved to ${STATE_PATH}`);
  console.log('');
  console.log('Paste that URL back to me in the chat, plus a screenshot');
  console.log('of the What If page. I need both to write the bulk script.');
  console.log('');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
