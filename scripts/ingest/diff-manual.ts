/**
 * Diff hand-authored courses in lib/data.ts against scraped LSA data.
 *
 * For each manual entry, look up the scraped version and report differences
 * in title, credits, LSA-standard tags (lsa-*), and distribution codes.
 * Does NOT modify data.ts — this is a read-only report so the user can
 * eyeball what would change before we apply.
 *
 * Run: npm run ingest:diff
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { courseCatalog } from '../../lib/data';
import type { Course } from '../../lib/types';

const LSA_JSON = join(process.cwd(), 'data/courses/lsa.json');

interface ScrapedFile {
  courses: Course[];
}

const scraped = (JSON.parse(readFileSync(LSA_JSON, 'utf8')) as ScrapedFile).courses;
const byCode = new Map(scraped.map((c) => [c.code, c]));

const LSA_TAG_PREFIX = 'lsa-';
function lsaTags(tags: string[]): string[] {
  return tags.filter((t) => t.startsWith(LSA_TAG_PREFIX)).sort();
}
function customTags(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith(LSA_TAG_PREFIX)).sort();
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Discrepancy {
  code: string;
  field: string;
  manual: unknown;
  scraped: unknown;
}

const discrepancies: Discrepancy[] = [];
const manualOnly: string[] = [];
const scrapedMissing: string[] = [];

for (const m of courseCatalog) {
  const s = byCode.get(m.code);
  if (!s) {
    manualOnly.push(m.code);
    continue;
  }

  if (m.title !== s.title) {
    discrepancies.push({ code: m.code, field: 'title', manual: m.title, scraped: s.title });
  }
  if (m.credits !== s.credits) {
    discrepancies.push({ code: m.code, field: 'credits', manual: m.credits, scraped: s.credits });
  }
  const mLsa = lsaTags(m.tags);
  const sLsa = lsaTags(s.tags);
  if (!eq(mLsa, sLsa)) {
    discrepancies.push({ code: m.code, field: 'lsa-tags', manual: mLsa, scraped: sLsa });
  }
  const mDist = (m.distributionCodes ?? []).slice().sort();
  const sDist = (s.distributionCodes ?? []).slice().sort();
  if (!eq(mDist, sDist)) {
    discrepancies.push({ code: m.code, field: 'distributionCodes', manual: mDist, scraped: sDist });
  }
  if (!m.prereqRaw && s.prereqRaw) {
    discrepancies.push({ code: m.code, field: 'prereqRaw (add)', manual: undefined, scraped: s.prereqRaw });
  }
  if (!m.description && s.description) {
    discrepancies.push({
      code: m.code,
      field: 'description (add)',
      manual: undefined,
      scraped: s.description!.slice(0, 80) + (s.description!.length > 80 ? '…' : ''),
    });
  }
}

// Report
console.log('═'.repeat(72));
console.log(`Manual courses     : ${courseCatalog.length}`);
console.log(`Scraped courses    : ${scraped.length}`);
console.log(`Manual entries not in scrape (may be custom / non-LSA):`);
for (const code of manualOnly) console.log(`  · ${code}`);

console.log('');
console.log(`Discrepancies      : ${discrepancies.length}`);
console.log('═'.repeat(72));

// Group by course code for readability
const byCourse = new Map<string, Discrepancy[]>();
for (const d of discrepancies) {
  if (!byCourse.has(d.code)) byCourse.set(d.code, []);
  byCourse.get(d.code)!.push(d);
}

for (const [code, ds] of byCourse) {
  console.log(`\n${code}`);
  for (const d of ds) {
    const m = JSON.stringify(d.manual);
    const s = JSON.stringify(d.scraped);
    console.log(`  ${d.field}`);
    console.log(`    manual : ${m}`);
    console.log(`    scraped: ${s}`);
  }
}

// Also flag any manual courses whose custom tags we should preserve
const CUSTOM_TAGS_IN_USE = new Set<string>();
for (const m of courseCatalog) {
  for (const t of customTags(m.tags)) CUSTOM_TAGS_IN_USE.add(t);
}
console.log('\n═'.repeat(72));
console.log('Custom tags in use (will be preserved on merge):');
for (const t of Array.from(CUSTOM_TAGS_IN_USE).sort()) console.log(`  · ${t}`);
