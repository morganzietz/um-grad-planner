/**
 * Parse the saved LSA majors-and-minors page into a structured list:
 * every major, minor, and sub-major with its department link.
 *
 * Writes data/lsa-programs.json for downstream generation of Major/Minor
 * JSON files.
 *
 * Prereq: run `npm run ingest:lsa-list` first (saves the HTML fixture).
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const FIXTURE = join(process.cwd(), 'lib/ingest/fixtures/lsa-majors-minors.html');
const OUTPUT = join(process.cwd(), 'data/lsa-programs.json');

interface LSAProgram {
  slug: string;
  name: string;
  kind: 'major' | 'minor' | 'sub-major';
  /** Body text (description) associated with the program on the index page. */
  description?: string;
  /** Absolute or relative URL to the department's requirements page (if any). */
  detailUrl?: string;
}

function parseAll(html: string): LSAProgram[] {
  const $ = load(html);
  const out: LSAProgram[] = [];

  // Each program is anchored as {slug}-maj / -min / -sub.
  // The container is usually a <div id="{slug}-maj"> ... </div> block that
  // contains a heading and a description.
  $('[id]').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const m = id.match(/^(.+)-(maj|min|sub)$/);
    if (!m) return;
    const [, slug, kindShort] = m;
    const kind =
      kindShort === 'maj' ? 'major' : kindShort === 'min' ? 'minor' : 'sub-major';

    // Pull the display name from any heading inside, or the first strong/anchor.
    let name = $(el).find('h1, h2, h3, h4, h5').first().text().trim();
    if (!name) name = $(el).find('strong').first().text().trim();
    if (!name) {
      // Fall back to top-of-index anchor text keyed to this id
      const linkText = $(`a[href$="#${id}"]`).first().text().trim();
      if (linkText) {
        name = linkText.replace(/\s*\((Major|Minor|Sub-Major)\)\s*$/, '');
      }
    }
    if (!name) name = slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Description: first paragraph or all text inside.
    const description = $(el)
      .find('p')
      .first()
      .text()
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 500);

    // Detail URL: first outbound link that goes to lsa.umich.edu/[dept]/...
    let detailUrl: string | undefined;
    $(el)
      .find('a[href]')
      .each((_, a) => {
        const href = $(a).attr('href') ?? '';
        if (detailUrl) return;
        if (/^https?:\/\/lsa\.umich\.edu\//.test(href) && !/majors-minors/.test(href)) {
          detailUrl = href;
        } else if (/^\/[a-z-]+\//.test(href) && !/lsa\/academics/.test(href)) {
          detailUrl = `https://lsa.umich.edu${href}`;
        }
      });

    out.push({ slug, name, kind, description, detailUrl });
  });

  // Dedupe (some anchors might repeat)
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.kind}:${p.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function main() {
  const html = readFileSync(FIXTURE, 'utf8');
  const programs = parseAll(html);

  const majors = programs.filter((p) => p.kind === 'major');
  const minors = programs.filter((p) => p.kind === 'minor');
  const subs = programs.filter((p) => p.kind === 'sub-major');

  console.log(`Majors     : ${majors.length}`);
  console.log(`Minors     : ${minors.length}`);
  console.log(`Sub-majors : ${subs.length}`);

  writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'https://lsa.umich.edu/lsa/academics/majors-minors.html',
        counts: { majors: majors.length, minors: minors.length, subs: subs.length },
        programs,
      },
      null,
      2,
    ),
  );
  console.log(`\nWrote ${OUTPUT}`);

  console.log('\nSample majors (first 15):');
  for (const m of majors.slice(0, 15)) {
    console.log(`  ${m.name.padEnd(50)} → ${m.detailUrl ?? '(no link)'}`);
  }
  console.log('\nSample minors (first 15):');
  for (const m of minors.slice(0, 15)) {
    console.log(`  ${m.name.padEnd(50)} → ${m.detailUrl ?? '(no link)'}`);
  }
}

main();
