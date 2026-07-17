/**
 * Bulk-download every LSA major What-If PDF from Wolverine Access.
 *
 * Poll-based, no interactive stdin (safe in foreground OR background):
 *   - You drive the browser to the "Create What-if Scenario" page.
 *   - Script polls the DOM every 1.5s. As soon as it sees the Area of Study
 *     dropdown, it starts iterating.
 *   - BA/BS dedup: the report content is the same across degree variants of
 *     the same major, so we compute a base name (strip trailing " BA" / " BS"
 *     / " BSChem" / etc.), save each PDF as data/whatif-pdfs/<base-slug>.pdf,
 *     and skip if already on disk.
 *   - After each report, tries to click the PSFT blue back arrow, then
 *     "Create New Report" to get back to the picker. If that fails, retries
 *     a few times, then continues.
 *   - Fully resumable.
 *
 * Run: npx tsx scripts/ingest/whatif-bulk.ts
 * Optional: --only "Biology BS"   (single option, useful for testing)
 */
import { chromium, type BrowserContext, type Page, type Frame } from 'playwright';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const AUTH_STATE = join(process.cwd(), '.auth', 'wolverine-state.json');
const PDF_DIR = join(process.cwd(), 'data', 'whatif-pdfs');
const MAPPING_PATH = join(PDF_DIR, '_mapping.json');
const START_URL =
  'https://csprod.dsc.umich.edu/psp/csprodnonop/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_LIST.GBL?authType=0S';

// CLI flags
const ARG_ONLY = process.argv.slice(2).reduce<string | null>((acc, a, i, arr) => {
  if (a === '--only' && arr[i + 1]) return arr[i + 1];
  return acc;
}, null);

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strip trailing degree-type suffix so BA / BS / BSChem variants of the same
 * major collapse to a single canonical name. "Biology BS" → "Biology";
 * "Interdis Chemical Sciences BS" → "Interdis Chemical Sciences".
 */
function baseMajorName(label: string): string {
  return label
    .replace(/\s+(BA\/BS|AB\/BS|AB or BS|BS\/BA|BA\/BSChem|BSChem|BS|BA|AB)\s*$/i, '')
    .trim();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Ctx = Page | Frame;

async function findAreaOfStudyContext(page: Page): Promise<Ctx | null> {
  let contexts: Ctx[];
  try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
  for (const ctx of contexts) {
    try {
      const has = await ctx.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
        return selects.some((s) =>
          Array.from(s.options).some((o) => /Biology BS/i.test(o.textContent ?? '')),
        );
      });
      if (has) return ctx;
    } catch {}
  }
  return null;
}

async function waitForPicker(page: Page, hint: string, timeoutMs = 20 * 60_000): Promise<Ctx> {
  const t0 = Date.now();
  let printed = false;
  while (Date.now() - t0 < timeoutMs) {
    const ctx = await findAreaOfStudyContext(page);
    if (ctx) return ctx;
    if (!printed) { console.log(hint); printed = true; }
    await sleep(1500);
  }
  throw new Error('Timed out waiting for Area of Study dropdown');
}

async function readAreaOfStudyOptions(ctx: Ctx): Promise<{ value: string; label: string }[]> {
  return await ctx.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    const target = selects.find((s) =>
      Array.from(s.options).some((o) => /Biology BS/i.test(o.textContent ?? '')),
    );
    if (!target) return [];
    return Array.from(target.options).map((o) => ({
      value: o.value,
      label: (o.textContent ?? '').trim(),
    }));
  });
}

function realOption(o: { value: string; label: string }): boolean {
  if (!o.label) return false;
  if (/^none$/i.test(o.label)) return false;
  if (/undeclared/i.test(o.label)) return false;
  return true;
}

async function selectAreaOfStudy(ctx: Ctx, value: string) {
  await ctx.evaluate((v) => {
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    const target = selects.find((s) =>
      Array.from(s.options).some((o) => /Biology BS/i.test(o.textContent ?? '')),
    );
    if (!target) throw new Error('Area of Study select not found');
    target.value = v;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * Iterate every possible clickable and try to click it. Defensive against
 * frame detachment — any error just skips to the next candidate.
 */
async function clickAcrossFrames(page: Page, name: RegExp | string, timeoutMs = 15_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let contexts: Ctx[];
    try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
    for (const ctx of contexts) {
      for (const role of ['link', 'button', 'tab'] as const) {
        try {
          const loc = ctx.getByRole(role, { name });
          const c = await loc.count().catch(() => 0);
          if (c > 0) {
            await loc.first().click({ timeout: 2500 });
            return true;
          }
        } catch {}
      }
      try {
        const text = ctx.getByText(name, { exact: false });
        const c = await text.count().catch(() => 0);
        if (c > 0) {
          await text.first().click({ timeout: 2500 });
          return true;
        }
      } catch {}
    }
    await sleep(500);
  }
  return false;
}

async function submitAndAwaitReport(page: Page) {
  const clicked = await clickAcrossFrames(page, /^Submit Request$/i, 15_000);
  if (!clicked) throw new Error('Could not click "Submit Request"');
  await page.waitForLoadState('domcontentloaded');
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    for (const ctx of [page, ...page.frames()] as Ctx[]) {
      const b = ctx.getByText(/Detail Report PDF/i);
      if ((await b.count()) > 0) return;
    }
    await sleep(500);
  }
  throw new Error('Report did not render (Detail Report PDF never appeared)');
}

async function capturePdf(page: Page, context: BrowserContext, dest: string) {
  let btn: Awaited<ReturnType<Page['getByRole']>> | null = null;
  for (const ctx of [page, ...page.frames()] as Ctx[]) {
    const b = ctx.getByRole('button', { name: /Detail Report PDF/i });
    if ((await b.count()) > 0) { btn = b.first(); break; }
    const l = ctx.getByRole('link', { name: /Detail Report PDF/i });
    if ((await l.count()) > 0) { btn = l.first(); break; }
    const t = ctx.getByText(/Detail Report PDF/i);
    if ((await t.count()) > 0) { btn = t.first(); break; }
  }
  if (!btn) throw new Error('Could not find "Detail Report PDF"');

  const [event] = await Promise.all([
    Promise.race([
      context.waitForEvent('page', { timeout: 60_000 }).then((p) => ({ kind: 'page' as const, p })),
      page.waitForEvent('download', { timeout: 60_000 }).then((d) => ({ kind: 'download' as const, d })),
    ]),
    btn.click(),
  ]);

  if (event.kind === 'download') {
    await event.d.saveAs(dest);
    return;
  }
  const newPage = event.p;
  await newPage.waitForLoadState('domcontentloaded').catch(() => {});
  const pdfUrl = newPage.url();
  const resp = await context.request.get(pdfUrl);
  if (!resp.ok()) throw new Error(`PDF fetch failed: ${resp.status()} for ${pdfUrl}`);
  const buf = await resp.body();
  writeFileSync(dest, buf);
  await newPage.close();
}

/**
 * Click the PSFT blue back arrow in the top-left of the page. Tries a lot of
 * different selectors because PS Fluid renders it inconsistently. Falls back
 * to browser back if nothing matches.
 */
async function clickBackArrow(page: Page): Promise<boolean> {
  const selectors = [
    'a[aria-label*="Back" i]',
    'button[aria-label*="Back" i]',
    'a[title*="Back" i]',
    'button[title*="Back" i]',
    'a[alt*="Back" i]',
    'img[alt*="Back" i]',
    // PS Fluid common IDs
    '[id*="PT_BUTTON_BACK" i]',
    '[id*="PT_HEADER_BACK" i]',
    '[id*="PT_LNK_BACK" i]',
    '[id*="PT_BCK_BUTTON" i]',
    '[id*="PT_BACKICON" i]',
    '[id*="PTNUI_BACK" i]',
    '[class*="ptas_back" i]',
    '[class*="psc_backicon" i]',
    '[class*="ptmods_backbutton" i]',
    '[class*="ptnui-back" i]',
    'a[href*="PT_BACK"]',
    // Header icon: first anchor in the header area that wraps an img/svg
    'header a:has(img)',
    'header a:has(svg)',
    '[role="banner"] a:has(img)',
    '[role="banner"] a:has(svg)',
  ];
  let contexts: Ctx[];
  try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
  for (const sel of selectors) {
    for (const ctx of contexts) {
      try {
        const loc = ctx.locator(sel).first();
        const c = await loc.count().catch(() => 0);
        if (c === 0) continue;
        const vis = await loc.isVisible().catch(() => false);
        if (!vis) continue;
        await loc.click({ timeout: 3000 });
        return true;
      } catch { /* try next */ }
    }
  }
  // Fallback: browser back
  try { await page.goBack({ timeout: 5000 }); return true; } catch {}
  // Last resort: keyboard shortcut
  try { await page.keyboard.press('Alt+ArrowLeft'); return true; } catch {}
  return false;
}

/** Poll for the picker to appear on the page. */
async function pollForPicker(page: Page, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await findAreaOfStudyContext(page)) return true;
    await sleep(500);
  }
  return false;
}

/** Poll for a text-labeled button to be visible + clickable. */
async function pollForButton(page: Page, name: RegExp, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let contexts: Ctx[];
    try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
    for (const ctx of contexts) {
      try {
        const b = ctx.getByText(name, { exact: false });
        const c = await b.count().catch(() => 0);
        if (c > 0 && (await b.first().isVisible().catch(() => false))) return true;
      } catch {}
    }
    await sleep(500);
  }
  return false;
}

async function tryReturnToPicker(page: Page, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) console.log(`         retry return (${i + 1}/${attempts})`);

    // Maybe we're already on the picker.
    if (await findAreaOfStudyContext(page)) return true;

    try {
      // Step 1: click the PSFT blue back arrow. From the report page, this
      // lands on the "View What-if Report" page (with a "Create New Report"
      // button and a list of saved reports).
      await clickBackArrow(page);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(1000);

      // Maybe back landed us directly on the picker.
      if (await findAreaOfStudyContext(page)) return true;

      // Step 2: wait for "Create New Report" to appear + be visible.
      const createReady = await pollForButton(page, /Create New Report/i, 15_000);
      if (!createReady) {
        console.log('         "Create New Report" never appeared after back');
        continue;
      }

      // Step 3: click it.
      const clicked = await clickAcrossFrames(page, /Create New Report/i, 5_000);
      if (!clicked) {
        console.log('         "Create New Report" was visible but click failed');
        continue;
      }
      await page.waitForLoadState('domcontentloaded').catch(() => {});

      // Step 4: wait up to 20s for the Area of Study dropdown to hydrate.
      if (await pollForPicker(page, 20_000)) return true;
      console.log('         picker never appeared after clicking Create New Report');
    } catch (e) {
      const msg = (e as Error).message;
      if (!/detached|closed|Target/.test(msg)) {
        console.log(`         return-attempt error: ${msg}`);
      }
    }
    await sleep(1500);
  }
  return false;
}

async function main() {
  mkdirSync(PDF_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: existsSync(AUTH_STATE) ? AUTH_STATE : undefined,
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
  });
  const page = await context.newPage();

  console.log('→ Opening SA enrollment page...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('');
  console.log('======================================================');
  console.log('  Navigate manually:');
  console.log('    SSO → My Academics → Create a what-if scenario');
  console.log('        → Create New Report');
  console.log('  Stop on the Area of Study dropdown page.');
  console.log('  Script polls DOM and starts automatically.');
  console.log('======================================================');
  console.log('');

  const pickerCtx = await waitForPicker(
    page,
    '  ...waiting for Area of Study dropdown...',
  );

  console.log('→ Detected picker. Reading options...');
  await context.storageState({ path: AUTH_STATE });

  const options = (await readAreaOfStudyOptions(pickerCtx)).filter(realOption);
  console.log(`  found ${options.length} concrete options in dropdown`);
  if (options.length === 0) {
    console.error('  no options readable; exiting');
    await browser.close();
    return;
  }

  // Dedup by base name — same major, different degree variants collapse to one.
  const dedupOrder: { value: string; label: string; baseSlug: string }[] = [];
  const seenBase = new Set<string>();
  for (const opt of options) {
    const baseSlug = slugify(baseMajorName(opt.label));
    if (seenBase.has(baseSlug)) continue;
    seenBase.add(baseSlug);
    dedupOrder.push({ ...opt, baseSlug });
  }
  console.log(`  after BA/BS dedup: ${dedupOrder.length} unique majors`);

  const targets = ARG_ONLY
    ? dedupOrder.filter((o) => o.label.toLowerCase() === ARG_ONLY.toLowerCase() ||
                                  o.baseSlug === slugify(baseMajorName(ARG_ONLY)))
    : dedupOrder;
  if (ARG_ONLY && targets.length === 0) {
    console.error(`  --only "${ARG_ONLY}" did not match any option`);
    await browser.close();
    return;
  }

  // Persist full mapping (every dropdown label → its slug, plus base slug).
  const mapping: Record<string, { label: string; baseSlug: string }> = existsSync(MAPPING_PATH)
    ? JSON.parse(readFileSync(MAPPING_PATH, 'utf-8'))
    : {};
  for (const o of options) {
    const slug = slugify(o.label);
    mapping[slug] = { label: o.label, baseSlug: slugify(baseMajorName(o.label)) };
  }
  writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));
  console.log(`  wrote mapping to ${MAPPING_PATH}`);

  console.log(`→ Downloading ${targets.length} unique major report(s)...`);
  let ok = 0, skip = 0, failed = 0;
  const failures: { label: string; error: string }[] = [];
  let consecutiveFailures = 0;

  for (const opt of targets) {
    const dest = join(PDF_DIR, `${opt.baseSlug}.pdf`);
    if (existsSync(dest)) {
      console.log(`  [skip] ${opt.label} (already have ${opt.baseSlug}.pdf)`);
      skip++;
      continue;
    }

    console.log(`  [ do ] ${opt.label} → ${opt.baseSlug}.pdf`);
    try {
      let ctx = await findAreaOfStudyContext(page);
      if (!ctx) {
        console.log('         (picker missing — retrying return)');
        const ok = await tryReturnToPicker(page, 3);
        if (!ok) throw new Error('Cannot return to picker');
        ctx = await findAreaOfStudyContext(page);
        if (!ctx) throw new Error('Picker still not detected after return');
      }
      await selectAreaOfStudy(ctx, opt.value);
      await submitAndAwaitReport(page);
      await capturePdf(page, context, dest);
      console.log(`         saved ${opt.baseSlug}.pdf`);
      ok++;
      consecutiveFailures = 0;
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`         FAILED: ${msg}`);
      failures.push({ label: opt.label, error: msg });
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= 5) {
        console.error('  5 consecutive failures — bailing out to save progress.');
        break;
      }
    }

    const returned = await tryReturnToPicker(page, 3);
    if (!returned) {
      console.error('         auto-return failed after retries — bailing.');
      break;
    }
  }

  console.log('');
  console.log('======================================================');
  console.log(`  done: ${ok} downloaded, ${skip} skipped, ${failed} failed`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(`    - ${f.label}: ${f.error}`);
  }
  console.log(`  PDFs in: ${PDF_DIR}`);
  console.log(`  mapping in: ${MAPPING_PATH}`);
  console.log('======================================================');

  await context.storageState({ path: AUTH_STATE });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
