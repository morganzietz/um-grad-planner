/**
 * Recon: use saved auth state to fetch LSA CG pages so we can map the
 * site's URL structure and HTML selectors before writing parsers.
 * Saves fixtures to lib/ingest/fixtures/.
 *
 * Prereq: run `npm run ingest:auth` first.
 * Run: npm run ingest:recon
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const AUTH_DIR = join(process.cwd(), '.auth');
const STATE_PATH = join(AUTH_DIR, 'state.json');
const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures');

async function main() {
  if (!existsSync(STATE_PATH)) {
    console.error(`No auth state at ${STATE_PATH}. Run: npm run ingest:auth`);
    process.exit(1);
  }
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  const targets: { name: string; url: string }[] = [
    { name: 'detail-math217', url: 'https://webapps.lsa.umich.edu/cg/cg_detail.aspx?content=2610MATH217001&termArray=f_26_2610' },
    { name: 'detail-math425', url: 'https://webapps.lsa.umich.edu/cg/cg_detail.aspx?content=2610MATH425001&termArray=f_26_2610' },
  ];

  for (const t of targets) {
    console.log(`→ ${t.url}`);
    await page.goto(t.url, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    console.log('  final URL:', page.url());
    console.log('  title    :', await page.title());
    const html = await page.content();
    const fixturePath = join(FIXTURE_DIR, `recon-${t.name}.html`);
    writeFileSync(fixturePath, html);
    console.log('  saved    :', fixturePath, `(${html.length} bytes)`);

    // Collect all anchor links + any candidate subject links
    const links = await page.$$eval('a[href]', (as) =>
      as
        .map((a) => ({ href: (a as HTMLAnchorElement).href, text: (a.textContent || '').trim() }))
        .filter((l) => l.href && l.text),
    );

    // Group by domain path segment for structure discovery
    console.log(`  ${links.length} total links`);
    const subjectLike = links.filter((l) =>
      /math|physics|chem|econ|biology|history|subject|dept|course/i.test(l.text + ' ' + l.href),
    );
    console.log(`  ${subjectLike.length} subject/course-like links (first 30):`);
    for (const l of subjectLike.slice(0, 30)) {
      console.log('    ', l.text.slice(0, 55).padEnd(55), '→', l.href.slice(0, 120));
    }

    // Print form actions in case navigation is via POST forms (common in ASP.NET catalogs)
    const forms = await page.$$eval('form', (fs) =>
      fs.map((f) => ({ action: (f as HTMLFormElement).action, method: (f as HTMLFormElement).method })),
    );
    console.log(`  ${forms.length} forms (first 5):`);
    for (const f of forms.slice(0, 5)) {
      console.log('    ', f.method.toUpperCase().padEnd(4), '→', f.action.slice(0, 120));
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
