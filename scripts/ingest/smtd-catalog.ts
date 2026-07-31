/**
 * Full SMTD course catalog from the school's official "SMTD Course
 * Descriptions Index" Google Docs (linked from smtd.umich.edu under
 * Students > Course Descriptions; smtd.umich.edu itself blocks fetching,
 * but the docs are public). One master index doc links ~43 per-subject
 * docs; each lists courses as "SUBJ 123: Title (N credits)" followed by a
 * prose description that usually names the terms the course typically runs.
 *
 * SMTD says the Registrar's Schedule of Classes is authoritative for live
 * offerings; these docs are the school's published catalog of record for
 * titles/credits/descriptions.
 *
 * Run: npx tsx scripts/ingest/smtd-catalog.ts
 * Output: data/courses/smtd-catalog.json (merged by lib/data.ts, gap-fill
 * only; SMTD subjects get smtd-credit/non-lsa tags programmatically).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'smtd-catalog.json');
const MASTER_DOC = '10XmYt-O_KjvnLNnU3DHANnE5XJs_g7qKl7W_8DhwD0M';

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  description?: string;
  offeredTerms?: ('fall' | 'winter' | 'spring' | 'summer')[];
}

function docUrl(id: string, format: 'txt' | 'html'): string {
  return `https://docs.google.com/document/d/${id}/export?format=${format}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/** Subject-doc ids + labels from the master index doc's hyperlinks. */
async function subjectDocs(): Promise<Map<string, string>> {
  const html = await fetchText(docUrl(MASTER_DOC, 'html'));
  const docs = new Map<string, string>();
  const linkRe = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  for (const m of html.matchAll(linkRe)) {
    const qMatch = /[?&]q=([^&]+)/.exec(m[1]);
    const target = qMatch ? decodeURIComponent(qMatch[1]) : m[1];
    const idMatch = /document\/d\/([A-Za-z0-9_-]{20,})/.exec(target);
    if (!idMatch || idMatch[1] === MASTER_DOC) continue;
    const label = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (label) docs.set(idMatch[1], label);
  }
  return docs;
}

/**
 * "SUBJ 123: Title (N credits)" heading. Catalog numbers may be
 * slash-joined crosslists/sequences ("ENS 307/407", "CLARINET 111/112").
 */
const HEADING_RE = /^([A-Z][A-Z&]{1,9}) (\d{3}[A-Z]?(?:\/\d{3}[A-Z]?)*):\s*(.+?)\s*\(([^)]*[Cc]redits?)\)\s*$/;

/** "(2 credits)" | "(1 credit)" | "(1-3 credits)" | "(2 or 4 credits)" | "(1, 2 credits)" → highest listed value. */
function parseCredits(raw: string): number | undefined {
  const nums = Array.from(raw.matchAll(/\d+(?:\.\d+)?/g), (m) => parseFloat(m[0]));
  if (nums.length === 0) return undefined;
  return Math.max(...nums);
}

/** Pull "typically offered Fall, Winter" style phrases out of a description. */
function parseOfferedTerms(description: string): Entry['offeredTerms'] {
  const m = /offered[^.;]*/i.exec(description);
  if (!m) return undefined;
  const terms: NonNullable<Entry['offeredTerms']> = [];
  if (/fall/i.test(m[0])) terms.push('fall');
  if (/winter/i.test(m[0])) terms.push('winter');
  if (/spring/i.test(m[0])) terms.push('spring');
  if (/summer/i.test(m[0])) terms.push('summer');
  return terms.length > 0 ? terms : undefined;
}

async function main() {
  const docs = await subjectDocs();
  console.log(`[index] ${docs.size} subject docs`);
  const byCode = new Map<string, Entry>();

  for (const [id, label] of docs) {
    let text: string;
    try {
      text = await fetchText(docUrl(id, 'txt'));
    } catch (e) {
      console.error(`[${label}] fetch failed: ${e}`);
      continue;
    }
    const lines = text.split(/\r?\n/);
    let added = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = HEADING_RE.exec(lines[i].trim());
      if (!m) continue;
      const [, subject, nbrs, title, creditsRaw] = m;
      const credits = parseCredits(creditsRaw);
      if (credits === undefined) continue;
      // Description: prose lines until the next course heading or blank gap.
      const desc: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (l === '' && desc.length > 0) break;
        if (HEADING_RE.test(l)) break;
        if (l !== '') desc.push(l);
        if (desc.join(' ').length > 600) break;
      }
      const description = desc.join(' ').replace(/\s+/g, ' ').trim();
      const offeredTerms = parseOfferedTerms(description);
      for (const nbr of nbrs.split('/')) {
        const code = `${subject} ${nbr}`;
        if (byCode.has(code)) continue;
        byCode.set(code, {
          code,
          title: title.replace(/\s+/g, ' '),
          credits,
          tags: [],
          ...(description ? { description } : {}),
          ...(offeredTerms ? { offeredTerms } : {}),
        });
        added++;
      }
    }
    console.log(`[${label}] +${added} (total ${byCode.size})`);
  }

  const courses = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code));
  const subjects = Array.from(new Set(courses.map((c) => c.code.split(' ')[0]))).sort();
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source:
          'SMTD Course Descriptions Index Google Docs (linked from smtd.umich.edu Students > Course Descriptions)',
        subjects,
        courses,
      },
      null,
      1,
    ),
  );
  console.log(`[done] ${courses.length} SMTD courses across ${subjects.length} subjects -> ${OUT}`);
  console.log(subjects.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
