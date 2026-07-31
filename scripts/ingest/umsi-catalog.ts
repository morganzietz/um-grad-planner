/**
 * Full UMSI course catalog from the official "[PUBLIC] UMSI Course Catalog"
 * Google Sheet, which si.umich.edu/programs/courses links as the catalog of
 * record (the website itself blocks fetching; the sheet is public and live).
 *
 * Tabs used:
 *  - 451068941: full course inventory (Subject, Catalog #, Title, Descr, Credits)
 *  - 919730351: AY 2026-2027 offerings (adds any course missing from the
 *    inventory tab and confirms live credits)
 *
 * Run: npx tsx scripts/ingest/umsi-catalog.ts
 * Output: data/courses/umsi-catalog.json (merged by lib/data.ts, gap-fill
 * only; SI courses get si-credit/non-lsa tags programmatically).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'umsi-catalog.json');
const BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRc2MbMVeseCzlazMefnLy0ZNo8CHRbvlpuNP9TYBLTfBJ1w2ns75NNxmhP-DErYU--QR0GEoTYXmQv/pub';
const TABS = [
  { gid: '2027687471', label: 'full-inventory' },
  { gid: '2034280409', label: 'undergrad-inventory' },
  { gid: '919730351', label: 'ay-2026-2027-offerings' },
  { gid: '451068941', label: 'study-abroad' },
];

interface Entry { code: string; title: string; credits: number; tags: string[] }

/** Minimal CSV parser handling quoted fields with embedded commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

async function fetchCsv(gid: string): Promise<string[][]> {
  const res = await fetch(`${BASE}?gid=${gid}&single=true&output=csv`, { redirect: 'follow' });
  if (!res.ok) throw new Error(`tab ${gid}: ${res.status}`);
  return parseCsv(await res.text());
}

async function main() {
  const byCode = new Map<string, Entry>();
  for (const tab of TABS) {
    const rows = await fetchCsv(tab.gid);
    // Find the header row and map columns by name.
    const headerIdx = rows.findIndex((r) => r.some((c) => /^subject$/i.test(c.trim())));
    if (headerIdx === -1) { console.error(`[${tab.label}] no header row`); continue; }
    const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
    const col = (re: RegExp) => header.findIndex((h) => re.test(h));
    const cSubj = col(/^subject$/);
    const cNbr = col(/^catalog/);
    const cTitle = col(/^course title/);
    const cCred = col(/^credits?/);
    let added = 0;
    for (const r of rows.slice(headerIdx + 1)) {
      const subj = (r[cSubj] ?? '').trim().toUpperCase();
      const nbr = (r[cNbr] ?? '').trim();
      if (!/^SI(ABRD)?$/.test(subj) || !/^\d{3}$/.test(nbr)) continue;
      const code = `${subj} ${nbr}`;
      let title = (r[cTitle] ?? '').trim().replace(/\s+/g, ' ');
      title = title.replace(/\s*\([^)]*\)\s*$/, ''); // drop trailing (Short) name
      const credRaw = (r[cCred] ?? '').trim();
      const cm = credRaw.match(/([\d.]+)\s*(?:-|to)?\s*([\d.]+)?/);
      const credits = cm ? parseFloat(cm[2] ?? cm[1]) : 3;
      if (!title) continue;
      if (!byCode.has(code)) {
        byCode.set(code, { code, title, credits, tags: [] });
        added++;
      }
    }
    console.log(`[${tab.label}] +${added} (total ${byCode.size})`);
  }

  const courses = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  writeFileSync(
    OUT,
    JSON.stringify(
      { source: 'UMSI public course catalog Google Sheet (linked from si.umich.edu/programs/courses)', courses },
      null,
      1,
    ),
  );
  console.log(`[done] ${courses.length} SI courses -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
