/**
 * Bulk-download every Ross School of Business What-If PDF from Wolverine Access.
 * Adapted from whatif-coe.ts; career target is UBA (Undergraduate Business Admin).
 *
 * Same poll-based design as whatif-bulk.ts (the LSA run), with one addition:
 * the What-if scenario defaults to the student's own program (LSA), so this
 * script first switches the scenario's career/program dropdowns to the
 * College of Engineering, waits for the Area of Study dropdown to repopulate
 * with engineering majors, then iterates. PeopleSoft resets the scenario on
 * "Create New Report", so the selections that produced the engineering list
 * are recorded (select id -> value) and replayed after every report.
 *
 * Flow:
 *   1. You drive the browser through Weblogin/Duo to
 *      My Academics -> Create a what-if scenario -> Create New Report.
 *   2. Script scans every <select> and tries to switch career/program to
 *      Engineering by itself. If it cannot, just pick College of Engineering
 *      manually in the window; the script detects the engineering list either
 *      way and takes over.
 *   3. Every unique major (BSE variants deduped) is submitted and its Detail
 *      Report PDF saved to data/whatif-pdfs/coe/<base-slug>.pdf. Resumable:
 *      PDFs already on disk are skipped.
 *
 * Run: npx tsx scripts/ingest/whatif-ross.ts
 * Optional: --only "Computer Science BSE"
 */
import { chromium, type BrowserContext, type Page, type Frame } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const AUTH_STATE = join(process.cwd(), '.auth', 'wolverine-state.json');
const PDF_DIR = join(process.cwd(), 'data', 'whatif-pdfs', 'ross');
const MAPPING_PATH = join(PDF_DIR, '_mapping.json');
const SELECT_SNAPSHOT_PATH = join(PDF_DIR, '_page-selects.json');
const SCENARIO_PATH = join(PDF_DIR, '_scenario-selections.json');
const START_URL =
  'https://csprod.dsc.umich.edu/psp/csprodnonop/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_LIST.GBL?authType=0S';

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

/** Collapse degree-variant labels to one canonical major name. */
function baseMajorName(label: string): string {
  return label
    .replace(/\s+(BBA|BSE|BS Engin|BSE\/BS|BA\/BS|AB\/BS|AB or BS|BS\/BA|BSChem|BS|BA|AB)\s*$/i, '')
    .trim();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type Ctx = Page | Frame;

interface SelectInfo {
  id: string;
  selectedValue: string;
  selectedLabel: string;
  options: { value: string; label: string }[];
}

/** Read every <select> in a context: id, current value, all options. */
async function readAllSelects(ctx: Ctx): Promise<SelectInfo[]> {
  return await ctx.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
    return selects.map((s) => ({
      id: s.id || s.name || '',
      selectedValue: s.value,
      selectedLabel: (s.selectedOptions[0]?.textContent ?? '').trim(),
      options: Array.from(s.options).map((o) => ({
        value: o.value,
        label: (o.textContent ?? '').trim(),
      })),
    }));
  });
}

/** An Area of Study select currently showing ROSS plans (labels end in BBA). */
function isRossAreaSelect(info: SelectInfo): boolean {
  const labels = info.options.map((o) => o.label);
  const bbaCount = labels.filter((l) => /\bBBA\b\s*$/.test(l)).length;
  return bbaCount >= 1;
}

/** An Area of Study select in ANY mode (LSA's is recognizable by its size). */
function isAreaSelect(info: SelectInfo): boolean {
  return info.options.length >= 25;
}

async function findRossAreaCtx(page: Page): Promise<{ ctx: Ctx; info: SelectInfo } | null> {
  let contexts: Ctx[];
  try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
  for (const ctx of contexts) {
    try {
      const selects = await readAllSelects(ctx);
      const area = selects.find((s) => isRossAreaSelect(s));
      if (area) return { ctx, info: area };
    } catch {}
  }
  return null;
}

/** Any context that at least has the scenario page's selects on it. */
async function findScenarioCtx(page: Page): Promise<Ctx | null> {
  let contexts: Ctx[];
  try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
  for (const ctx of contexts) {
    try {
      const selects = await readAllSelects(ctx);
      if (selects.some((s) => isAreaSelect(s))) return ctx;
      // Pre-area scenario page: career/program dropdowns exist but area not yet.
      if (
        selects.some((s) =>
          s.options.some((o) => /business/i.test(o.label) && o.label.length < 60),
        )
      ) {
        return ctx;
      }
    } catch {}
  }
  return null;
}

async function setSelect(ctx: Ctx, selectId: string, value: string): Promise<boolean> {
  return await ctx.evaluate(
    ({ selectId, value }) => {
      const selects = Array.from(document.querySelectorAll('select')) as HTMLSelectElement[];
      const target = selects.find((s) => (s.id || s.name) === selectId);
      if (!target) return false;
      if (target.value === value) return true;
      target.value = value;
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { selectId, value },
  );
}

interface ScenarioSelection {
  id: string;
  value: string;
  label: string;
}

/**
 * Try to switch the scenario to the College of Engineering by scanning every
 * SMALL select (career / program pickers, not the big area list) for an
 * engineering-looking option and selecting it. Repeats until the area select
 * shows engineering majors or attempts run out. Returns the selections made.
 */
async function autoSelectRoss(page: Page): Promise<ScenarioSelection[] | null> {
  const made: ScenarioSelection[] = [];
  for (let round = 0; round < 6; round++) {
    const found = await findRossAreaCtx(page);
    if (found) return made;

    const ctx = await findScenarioCtx(page);
    if (!ctx) { await sleep(1500); continue; }

    let selects: SelectInfo[] = [];
    try { selects = await readAllSelects(ctx); } catch { await sleep(1000); continue; }

    let actedThisRound = false;
    for (const s of selects) {
      if (isAreaSelect(s)) continue; // never touch the area list here
      if (/business/i.test(s.selectedLabel)) continue; // already business
      const engOption = s.options.find(
        (o) => o.value && /business/i.test(o.label) && !/minor/i.test(o.label),
      );
      if (!engOption) continue;
      console.log(`  [scenario] "${s.selectedLabel}" -> "${engOption.label}" (select ${s.id})`);
      try {
        const ok = await setSelect(ctx, s.id, engOption.value);
        if (ok) {
          made.push({ id: s.id, value: engOption.value, label: engOption.label });
          actedThisRound = true;
          await sleep(2500); // PSFT partial refresh
          break; // re-scan from scratch: the change may swap other selects
        }
      } catch {}
    }
    if (!actedThisRound) await sleep(1500);
  }
  return (await findRossAreaCtx(page)) ? made : null;
}

/** Replay recorded scenario selections (after Create New Report resets them). */
async function replayScenario(page: Page, selections: ScenarioSelection[]): Promise<boolean> {
  for (let round = 0; round < 4; round++) {
    if (await findRossAreaCtx(page)) return true;
    const ctx = await findScenarioCtx(page);
    if (!ctx) { await sleep(1500); continue; }
    for (const sel of selections) {
      try {
        const done = await setSelect(ctx, sel.id, sel.value);
        if (done) await sleep(2000);
      } catch {}
    }
    await sleep(1500);
  }
  if (await findRossAreaCtx(page)) return true;
  // Recorded ids may have changed; fall back to autodetect.
  const auto = await autoSelectRoss(page);
  return auto !== null;
}

function realOption(o: { value: string; label: string }): boolean {
  if (!o.label || !o.value) return false;
  if (/^none$/i.test(o.label)) return false;
  if (/undeclared|undecided|undec\b|common first year|unclassified|first year/i.test(o.label)) {
    return false;
  }
  // Overlay plans, not standalone majors: minors crossed with a host major,
  // honors and supplemental-studies programs offered per host major.
  if (
    /minor|mino |min -|eng global lead|fund of public hlth|global hlth|global health|prog in entrepreneur|program in entrepren|prog in global engin|soc engaged design|sustainable engin|sustainability scholars|teaching cert/i.test(
      o.label,
    )
  ) {
    return false;
  }
  return true;
}

async function selectAreaOfStudy(page: Page, value: string): Promise<void> {
  const found = await findRossAreaCtx(page);
  if (!found) throw new Error('Engineering Area of Study select not found');
  const ok = await setSelect(found.ctx, found.info.id, value);
  if (!ok) throw new Error('Could not set Area of Study value');
}

async function clickAcrossFrames(page: Page, name: RegExp, timeoutMs = 15_000): Promise<boolean> {
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
  while (Date.now() - t0 < 150_000) {
    for (const ctx of [page, ...page.frames()] as Ctx[]) {
      const b = ctx.getByText(/Detail Report PDF/i);
      if ((await b.count().catch(() => 0)) > 0) return;
    }
    await sleep(500);
  }
  throw new Error('Report did not render (Detail Report PDF never appeared)');
}

async function capturePdf(page: Page, context: BrowserContext, dest: string) {
  let btn: ReturnType<Ctx['getByText']> | null = null;
  for (const ctx of [page, ...page.frames()] as Ctx[]) {
    const b = ctx.getByRole('button', { name: /Detail Report PDF/i });
    if ((await b.count().catch(() => 0)) > 0) { btn = b.first(); break; }
    const l = ctx.getByRole('link', { name: /Detail Report PDF/i });
    if ((await l.count().catch(() => 0)) > 0) { btn = l.first(); break; }
    const t = ctx.getByText(/Detail Report PDF/i);
    if ((await t.count().catch(() => 0)) > 0) { btn = t.first(); break; }
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

async function clickBackArrow(page: Page): Promise<boolean> {
  const selectors = [
    'a[aria-label*="Back" i]',
    'button[aria-label*="Back" i]',
    'a[title*="Back" i]',
    'button[title*="Back" i]',
    '[id*="PT_BUTTON_BACK" i]',
    '[id*="PT_HEADER_BACK" i]',
    '[id*="PT_LNK_BACK" i]',
    '[id*="PTNUI_BACK" i]',
    '[class*="ptas_back" i]',
    '[class*="psc_backicon" i]',
    'header a:has(img)',
    'header a:has(svg)',
    '[role="banner"] a:has(img)',
  ];
  let contexts: Ctx[];
  try { contexts = [page, ...page.frames()]; } catch { contexts = [page]; }
  for (const sel of selectors) {
    for (const ctx of contexts) {
      try {
        const loc = ctx.locator(sel).first();
        if ((await loc.count().catch(() => 0)) === 0) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.click({ timeout: 3000 });
        return true;
      } catch {}
    }
  }
  try { await page.goBack({ timeout: 5000 }); return true; } catch {}
  try { await page.keyboard.press('Alt+ArrowLeft'); return true; } catch {}
  return false;
}

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

async function tryReturnToEngineeringPicker(
  page: Page,
  selections: ScenarioSelection[],
  attempts = 3,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) console.log(`         retry return (${i + 1}/${attempts})`);
    if (await findRossAreaCtx(page)) return true;
    try {
      await clickBackArrow(page);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await sleep(1000);
      if (await findRossAreaCtx(page)) return true;
      const createReady = await pollForButton(page, /Create New Report/i, 15_000);
      if (createReady) {
        const clicked = await clickAcrossFrames(page, /Create New Report/i, 5_000);
        if (clicked) {
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await sleep(1500);
        }
      }
      // Fresh scenario page: put it back into engineering mode.
      if (await replayScenario(page, selections)) return true;
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

  console.log('→ Opening Wolverine Access student page...');
  await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('');
  console.log('======================================================');
  console.log('  In the browser window:');
  console.log('   1. Complete Weblogin + Duo if prompted.');
  console.log('   2. Go to: My Academics -> Create a what-if scenario');
  console.log('      -> Create New Report.');
  console.log('   3. Stop there. The script will switch the scenario to');
  console.log('      the Ross School of Business by itself; if it cannot,');
  console.log('      pick the Engineering career/program manually.');
  console.log('  The script polls and takes over automatically.');
  console.log('======================================================');
  console.log('');

  // Wait (up to 25 min) for the scenario page to exist at all.
  const t0 = Date.now();
  let scenarioSeen = false;
  while (Date.now() - t0 < 25 * 60_000) {
    if (await findScenarioCtx(page)) { scenarioSeen = true; break; }
    await sleep(1500);
  }
  if (!scenarioSeen) {
    console.error('Timed out waiting for the What-if scenario page.');
    await browser.close();
    return;
  }

  console.log('→ Scenario page detected. Switching to College of Engineering...');
  await context.storageState({ path: AUTH_STATE });

  let selections = (await autoSelectRoss(page)) ?? [];
  let engineering = await findRossAreaCtx(page);
  if (!engineering) {
    console.log('  Automatic switch did not work. Pick the Engineering');
    console.log('  career/program in the window; polling for up to 15 min...');
    const t1 = Date.now();
    while (Date.now() - t1 < 15 * 60_000) {
      engineering = await findRossAreaCtx(page);
      if (engineering) break;
      await sleep(1500);
    }
  }
  if (!engineering) {
    console.error('Never saw an engineering Area of Study list. Exiting.');
    await browser.close();
    return;
  }

  // Record whatever scenario state produced the engineering list so it can be
  // replayed after each report, regardless of who made the selections.
  try {
    const ctxSelects = await readAllSelects(engineering.ctx);
    const small = ctxSelects.filter((s) => !isAreaSelect(s) && s.selectedValue);
    selections = small.map((s) => ({ id: s.id, value: s.selectedValue, label: s.selectedLabel }));
    writeFileSync(SCENARIO_PATH, JSON.stringify(selections, null, 2));
    writeFileSync(SELECT_SNAPSHOT_PATH, JSON.stringify(ctxSelects, null, 2));
  } catch {}

  const options = engineering.info.options.filter(realOption);
  console.log(`→ Engineering list detected: ${options.length} concrete options`);
  for (const o of options) console.log(`     - ${o.label}`);

  // Dedup by base name.
  const dedupOrder: { value: string; label: string; baseSlug: string }[] = [];
  const seenBase = new Set<string>();
  for (const opt of options) {
    const baseSlug = slugify(baseMajorName(opt.label));
    if (seenBase.has(baseSlug)) continue;
    seenBase.add(baseSlug);
    dedupOrder.push({ ...opt, baseSlug });
  }
  console.log(`  after degree-variant dedup: ${dedupOrder.length} unique majors`);

  const targets = ARG_ONLY
    ? dedupOrder.filter(
        (o) =>
          o.label.toLowerCase() === ARG_ONLY.toLowerCase() ||
          o.baseSlug === slugify(baseMajorName(ARG_ONLY)),
      )
    : dedupOrder;
  if (ARG_ONLY && targets.length === 0) {
    console.error(`  --only "${ARG_ONLY}" matched nothing`);
    await browser.close();
    return;
  }

  const mapping: Record<string, { label: string; baseSlug: string }> = existsSync(MAPPING_PATH)
    ? JSON.parse(readFileSync(MAPPING_PATH, 'utf-8'))
    : {};
  for (const o of options) {
    mapping[slugify(o.label)] = { label: o.label, baseSlug: slugify(baseMajorName(o.label)) };
  }
  writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2));

  console.log(`→ Downloading ${targets.length} engineering report(s)...`);
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

    console.log(`  [ do ] ${opt.label} -> ${opt.baseSlug}.pdf`);
    try {
      if (!(await findRossAreaCtx(page))) {
        const back = await tryReturnToEngineeringPicker(page, selections, 3);
        if (!back) throw new Error('Cannot return to engineering picker');
      }
      await selectAreaOfStudy(page, opt.value);
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

    const returned = await tryReturnToEngineeringPicker(page, selections, 3);
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
  console.log('======================================================');

  await context.storageState({ path: AUTH_STATE });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
