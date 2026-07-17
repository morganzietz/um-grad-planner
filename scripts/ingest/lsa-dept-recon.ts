/**
 * One-off recon: fetch a handful of LSA department requirement pages so we
 * can eyeball the variance in structure before committing to a scraping
 * approach.
 *
 * Run: npx tsx scripts/ingest/lsa-dept-recon.ts
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures/lsa-depts');

// Sample majors covering different departments so we can see the range.
const TARGETS = [
  { slug: 'anthropology-req', url: 'https://lsa.umich.edu/lsa/academics/majors-minors/anthropology-major.html' },
  { slug: 'economics-req', url: 'https://lsa.umich.edu/lsa/academics/majors-minors/economics-major.html' },
  { slug: 'biology-req', url: 'https://lsa.umich.edu/lsa/academics/majors-minors/biology-major.html' },
  { slug: 'psych-req', url: 'https://lsa.umich.edu/lsa/academics/majors-minors/psychology-major.html' },
  { slug: 'english-req', url: 'https://lsa.umich.edu/lsa/academics/majors-minors/english-major.html' },
];

async function main() {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    ...(existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {}),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  for (const t of TARGETS) {
    console.log(`\n→ ${t.slug}: ${t.url}`);
    try {
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      // Wait through any CF challenge.
      for (let i = 0; i < 10; i++) {
        const title = await page.title();
        if (!/just a moment/i.test(title)) break;
        await page.waitForTimeout(2000);
      }
      const html = await page.content();
      writeFileSync(join(FIXTURE_DIR, `${t.slug}.html`), html);
      console.log(`  saved  : ${html.length} bytes`);
      console.log(`  title  : ${await page.title()}`);

      // Quick structural sniff: count <li>, <h2>, <h3>, tables
      const $ = load(html);
      console.log(`  <h2>   : ${$('h2').length}`);
      console.log(`  <h3>   : ${$('h3').length}`);
      console.log(`  <li>   : ${$('li').length}`);
      console.log(`  <table>: ${$('table').length}`);
      // Look for course-code-like text to gauge density.
      const bodyText = $('main').text() || $('body').text();
      const courseCodes = bodyText.match(/\b[A-Z]{2,10}\s+\d{2,4}[A-Z]?\b/g) ?? [];
      console.log(`  course-code mentions in main/body: ${courseCodes.length}`);
      console.log(`  first 8 mentions: ${courseCodes.slice(0, 8).join(', ')}`);
    } catch (e) {
      console.log('  ERROR', (e as Error).message.split('\n')[0]);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
