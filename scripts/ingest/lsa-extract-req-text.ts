/**
 * Extract the clean "Requirements" section from every saved LSA requirements
 * HTML fixture. Writes one plain-text file per program under
 * data/lsa-req-text/, plus a summary index.
 *
 * The text is our source-of-truth for hand-encoding each program's
 * requirements into JSON.
 *
 * Run: npm run ingest:lsa-extract-text
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const FIXTURE_DIR = join(process.cwd(), 'lib/ingest/fixtures/lsa-req');
const OUT_DIR = join(process.cwd(), 'data/lsa-req-text');

function extract(html: string): { title: string; requirementsText: string; fullText: string } {
  const $ = load(html);
  $('script, style, noscript, header, footer, nav').remove();

  // The page title
  const title = $('title').text().trim() || $('h1').first().text().trim() || '';

  // Try to isolate the main content column. LSA pages have several candidates.
  const candidates = [
    '.column-container',
    '#lsa-content-main',
    'main',
    'body',
  ];
  let mainText = ($('body').text() ?? '').replace(/\s+/g, ' ').trim();
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) {
      const t = (el.text() ?? '').replace(/\s+/g, ' ').trim();
      if (t.length > 500) {
        mainText = t;
        break;
      }
    }
  }
  const fullText = mainText;

  // LSA requirements pages generally have this shape:
  //   ...(nav / dept intro / advising / prereqs)...
  //   Requirements Minimum Credits: N  [ ...actual rules... ]
  //   Residency  [ ... ]  Distribution Policy [ ... ]  Related Programs
  // Home in on the "Requirements Minimum" heading, and stop at Residency /
  // Distribution Policy / Related Programs / Faculty / footer.
  const startPatterns = [
    /Requirements\s+Minimum Credits/i,
    /Requirements\s+Minimum GPA/i,
    /Prerequisites\s+/i, // fallback
  ];
  const endPatterns = [
    /\bResidency\b/,
    /\bDistribution Policy\b/,
    /\bRelated Programs\b/,
    /\bContact\b/,
    /\bCourse Guide\b/,
    /\bFaculty and Staff\b/,
    /©\s*\d{4}/,
  ];
  let start = -1;
  for (const p of startPatterns) {
    const m = fullText.match(p);
    if (m && m.index !== undefined) {
      start = m.index;
      break;
    }
  }
  let end = fullText.length;
  if (start > -1) {
    for (const p of endPatterns) {
      const m = fullText.slice(start + 30).match(p);
      if (m && m.index !== undefined) {
        end = start + 30 + m.index;
        break;
      }
    }
  }
  const requirementsText =
    start > -1 ? fullText.slice(start, end).trim().slice(0, 6000) : '';

  return { title, requirementsText, fullText };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const files = readdirSync(FIXTURE_DIR).filter(
    (f) => f.endsWith('.html') && !f.startsWith('_'),
  );

  const index: {
    slug: string;
    title: string;
    reqLen: number;
    fullLen: number;
    hasReqSection: boolean;
  }[] = [];

  for (const f of files) {
    const html = readFileSync(join(FIXTURE_DIR, f), 'utf8');
    const { title, requirementsText, fullText } = extract(html);
    const slug = f.replace(/\.html$/, '');
    const text = requirementsText || fullText.slice(0, 6000);
    writeFileSync(
      join(OUT_DIR, `${slug}.txt`),
      `# ${title}\n\n## Extracted Requirements Section\n\n${
        requirementsText || '(no explicit Requirements section detected)'
      }\n\n## Full Text (first 4000 chars)\n\n${fullText.slice(0, 4000)}\n`,
    );
    index.push({
      slug,
      title,
      reqLen: requirementsText.length,
      fullLen: fullText.length,
      hasReqSection: requirementsText.length > 100,
    });
  }

  writeFileSync(join(OUT_DIR, '_index.json'), JSON.stringify(index, null, 2));

  const good = index.filter((e) => e.hasReqSection).length;
  console.log(`Extracted text for ${index.length} programs.`);
  console.log(`  ${good} have a detected Requirements section (>100 chars).`);
  console.log(`  ${index.length - good} do not (full text saved as fallback).`);
  console.log(`\nOutput: ${OUT_DIR}`);
}

main();
