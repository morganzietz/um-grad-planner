/**
 * CoE course backfill from the College of Engineering Bulletin course
 * listings (bulletin.engin.umich.edu/courses/<dept>/). The LSA CG scrape
 * misses CoE-only courses (ENGR 100, most ROB, many 400/500-level dept
 * courses); this fills them until the all-university SOC ingest
 * (scripts/ingest/soc.ts) runs with API credentials.
 *
 * The bulletin blocks direct fetching, so pages are read through the
 * Internet Archive. Entry format on each page:
 *   "SUBJ 123. Course Title"                      (header line)
 *   "...Prerequisite... (3 credits)"              (credits within next lines)
 * Cross-listings like "ROB 422. (EECS 465) Title" produce both codes.
 *
 * Run: npx tsx scripts/ingest/coe-bulletin.ts
 * Output: data/courses/coe-bulletin.json (merged by lib/data.ts, gap-fill
 * only, tagged non-lsa like every non-CG source).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WAYBACK = 'http://web.archive.org/web/2026/';
const INDEX = 'https://bulletin.engin.umich.edu/courses/';
const OUT = join(process.cwd(), 'data', 'courses', 'coe-bulletin.json');

const PAGES = [
  'aero', 'appl-phys', 'bme', 'cee', 'che', 'clasp', 'eecs', 'eer', 'engr',
  'entr', 'ioe', 'macro-se', 'matscie', 'me', 'moep', 'name', 'ners',
  'robotics-courses', 'techcomm', 'uarts-courses',
];

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
}

async function fetchText(url: string, retries = 4): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(WAYBACK + url, { redirect: 'follow' });
      if (res.ok) return await res.text();
      if (attempt >= retries) throw new Error(`${res.status} for ${url}`);
    } catch (e) {
      if (attempt >= retries) throw e;
    }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

function stripHtml(html: string): string[] {
  let t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ');
  t = t.replace(/<[^>]+>/g, '\n');
  t = t
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"');
  return t.split('\n').map((l) => l.trim()).filter(Boolean);
}

// "SUBJ 123. Title", "SUBJ 123 (XL 456). Title", "SUBJ 123. (XL 456) Title"
const HEADER = /^([A-Z]{2,10})\s+(\d{3}[A-Z]?)\s*(?:\(([A-Z]{2,10})\s+(\d{3}[A-Z]?)\))?\.\s*(?:\(([A-Z]{2,10})\s+(\d{3}[A-Z]?)\)\s*)?(.{3,120})$/;
const CREDITS = /\((\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*credits?\)/i;

async function main() {
  const byCode = new Map<string, Entry>();

  for (const page of PAGES) {
    let lines: string[];
    try {
      lines = stripHtml(await fetchText(`${INDEX}${page}/`));
    } catch (e) {
      console.error(`[skip] ${page}: ${e}`);
      continue;
    }
    let added = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(HEADER);
      if (!m) continue;
      const [, subj, nbr, xlSubj1, xlNbr1, xlSubj2, xlNbr2, rawTitle] = m;
      const title = rawTitle.replace(/\s+/g, ' ').trim();
      // Skip lines that are prose, not headers (title starting lowercase or
      // looking like a prerequisite continuation).
      if (/^(or|and|Advisory|Enforced|Prerequisite|Minimum grade)/.test(title)) continue;
      // Find credits within the next few lines.
      let credits: number | null = null;
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        // Stop if we hit the next course header first.
        if (j > i && HEADER.test(lines[j])) break;
        const cm = lines[j].match(CREDITS);
        if (cm) {
          credits = parseFloat(cm[2] ?? cm[1]);
          break;
        }
      }
      if (credits === null) continue; // not a real entry
      const codes = [`${subj} ${nbr}`];
      if (xlSubj1 && xlNbr1) codes.push(`${xlSubj1} ${xlNbr1}`);
      if (xlSubj2 && xlNbr2) codes.push(`${xlSubj2} ${xlNbr2}`);
      for (const code of codes) {
        if (!byCode.has(code)) {
          byCode.set(code, { code, title, credits, tags: [] });
          added++;
        }
      }
    }
    console.log(`[${page}] +${added} (total ${byCode.size})`);
  }

  const courses = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  writeFileSync(
    OUT,
    JSON.stringify({ source: 'bulletin.engin.umich.edu/courses via Internet Archive', courses }, null, 1),
  );
  console.log(`\n[done] ${courses.length} courses -> ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
