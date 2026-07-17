/**
 * Generate placeholder Major/Minor JSON files for every LSA program.
 *
 * For each major/minor in data/lsa-programs.json, writes a JSON file with:
 *   - id, name, school
 *   - goalCredits (120 majors, 15 minors — LSA defaults)
 *   - shared LSA college-wide requirements (writing, language, distributions,
 *     QR, R&E, credit minimums) so audits are meaningful even without major-
 *     specific rules
 *   - a "major-specific requirements coming soon" placeholder
 *
 * Files land in:
 *   data/majors/lsa-*.json
 *   data/minors/lsa-*.json
 *
 * Also generates:
 *   data/majors/index.ts  (imports + re-exports all major JSONs)
 *   data/minors/index.ts  (imports + re-exports all minor JSONs)
 *
 * Run: npm run ingest:lsa-generate
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const PROGRAMS = join(process.cwd(), 'data/lsa-programs.json');
const MAJORS_DIR = join(process.cwd(), 'data/majors');
const MINORS_DIR = join(process.cwd(), 'data/minors');
const REQ_TEXT_DIR = join(process.cwd(), 'data/lsa-req-text');
const REQ_MANIFEST = join(process.cwd(), 'lib/ingest/fixtures/lsa-req/_manifest.json');

const LSA_SCHOOL = 'College of Literature, Science, and the Arts';

// Shared LSA college-wide requirements. These are the same for every LSA
// undergraduate degree.
//
// AP / transfer credit note: AP courses count toward Total Credits and LSA
// Credits, and can substitute for prerequisites, but they do NOT satisfy
// distribution categories or the R&E / writing requirements. That's why every
// distribution rule below excludes the `ap-credit` tag.
const LSA_COLLEGE_WIDE_REQS = [
  {
    id: 'lsa-total-credits',
    label: '120 Total Credits',
    hint: 'All credits completed at U-M plus posted transfer credit.',
    need: 120,
    matchAll: true,
    countMode: 'credits',
    category: 'lsa-credit-min',
  },
  {
    id: 'lsa-credits',
    label: '100 LSA Credits',
    hint: 'Credits from courses recognized by LSA.',
    need: 100,
    matchAll: true,
    excludeTags: ['non-lsa'],
    countMode: 'credits',
    category: 'lsa-credit-min',
  },
  {
    id: 'lsa-upper-level',
    label: '39 Upper-Level Credits',
    hint: 'Credits at the 300 level or above.',
    need: 39,
    matchTag: 'upper-level',
    excludeTags: ['ap-credit'],
    countMode: 'credits',
    category: 'lsa-credit-min',
  },
  {
    id: 'lsa-fywr',
    label: 'First-Year Writing Requirement',
    hint: 'ENGLISH 124, 125, or equivalent. C- or better.',
    need: 1,
    matchTag: 'lsa-fywr',
    excludeTags: ['ap-credit'],
    countMode: 'count',
    category: 'lsa-college-wide',
  },
  {
    id: 'lsa-ulwr',
    label: 'Upper Level Writing Requirement',
    hint: 'One approved upper-level writing course. C- or better.',
    need: 1,
    matchTag: 'lsa-ulwr',
    excludeTags: ['ap-credit'],
    countMode: 'count',
    category: 'lsa-college-wide',
  },
  {
    id: 'lsa-race-ethnicity',
    label: 'Race & Ethnicity Requirement',
    hint: 'One approved R&E course.',
    need: 1,
    matchTag: 'lsa-race-ethnicity',
    excludeTags: ['ap-credit'],
    countMode: 'count',
    category: 'lsa-college-wide',
  },
  {
    id: 'lsa-qr',
    label: 'Quantitative Reasoning Requirement',
    hint: 'One approved QR1 course, or two QR2 courses.',
    need: 1,
    matchTag: 'lsa-qr',
    excludeTags: ['ap-credit'],
    countMode: 'count',
    category: 'lsa-college-wide',
  },
  {
    id: 'lsa-language',
    label: 'Language other than English (proficiency)',
    hint: 'One 4th-semester (or higher) proficiency course in a non-English language.',
    need: 1,
    matchTag: 'lsa-language',
    countMode: 'count',
    category: 'lsa-college-wide',
  },
  {
    id: 'lsa-dist-humanities',
    label: 'Area Distribution: 7 Credits in Humanities',
    hint: 'From approved HU-designated courses.',
    need: 7,
    matchTag: 'lsa-humanities',
    excludeTags: ['ap-credit'],
    countMode: 'credits',
    category: 'lsa-distribution',
  },
  {
    id: 'lsa-dist-natural-sciences',
    label: 'Area Distribution: 7 Credits in Natural Sciences',
    hint: 'From approved NS-designated courses.',
    need: 7,
    matchTag: 'lsa-natural-sciences',
    excludeTags: ['ap-credit'],
    countMode: 'credits',
    category: 'lsa-distribution',
  },
  {
    id: 'lsa-dist-social-sciences',
    label: 'Area Distribution: 7 Credits in Social Sciences',
    hint: 'From approved SS-designated courses.',
    need: 7,
    matchTag: 'lsa-social-sciences',
    excludeTags: ['ap-credit'],
    countMode: 'credits',
    category: 'lsa-distribution',
  },
  {
    id: 'lsa-dist-total',
    label: 'Distribution Total: 30 Credits',
    hint: 'Across HU, SS, NS, MSA, ID, and CE. The 21 credits of HU/NS/SS above count toward this total; the remaining 9+ can come from any distribution category.',
    need: 30,
    matchTag: 'lsa-distribution',
    excludeTags: ['ap-credit'],
    countMode: 'credits',
    category: 'lsa-distribution',
  },
];

// Major-specific placeholder to signal work-in-progress until each major is
// filled in with real rules from its department's page.
const MAJOR_PLACEHOLDER_REQ = {
  id: 'major-specific-placeholder',
  label: 'Major-specific requirements',
  hint: 'Detailed requirements for this major are not yet loaded. See your LSA advisor for the authoritative list.',
  need: 1,
  matchAll: true,
  countMode: 'count',
  category: 'major-specific',
};

const MINOR_PLACEHOLDER_REQ = {
  id: 'minor-specific-placeholder',
  label: 'Minor-specific requirements',
  hint: 'Detailed requirements for this minor are not yet loaded. See the sponsoring department for the authoritative list.',
  need: 1,
  matchAll: true,
  countMode: 'count',
  category: 'minor-specific',
};

interface LSAProgram {
  slug: string;
  name: string;
  kind: 'major' | 'minor' | 'sub-major';
  description?: string;
  detailUrl?: string;
}

function kebabize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function programIdMajor(slug: string): string {
  return `lsa-${kebabize(slug)}`;
}
function programIdMinor(slug: string): string {
  return `lsa-${kebabize(slug)}-minor`;
}

interface ReqManifestEntry {
  slug: string;
  kind: string;
  fixture: string;
  requirementsUrl?: string;
}

function loadReqManifest(): Map<string, ReqManifestEntry> {
  const map = new Map<string, ReqManifestEntry>();
  if (!existsSync(REQ_MANIFEST)) return map;
  const m = JSON.parse(readFileSync(REQ_MANIFEST, 'utf8')) as {
    entries: ReqManifestEntry[];
  };
  for (const e of m.entries ?? []) {
    map.set(`${e.slug}-${e.kind}`, e);
  }
  return map;
}

function loadRequirementText(slug: string, kindShort: string): string | undefined {
  const path = join(REQ_TEXT_DIR, `${slug}-${kindShort}.txt`);
  if (!existsSync(path)) return undefined;
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(
    /## Extracted Requirements Section\s*([\s\S]*?)(?=\n## Full Text|$)/,
  );
  if (!m) return undefined;
  const text = m[1].trim();
  if (text.length < 100 || /no explicit Requirements section detected/i.test(text)) {
    return undefined;
  }
  // Strip navigation boilerplate that often leaks in.
  const cleaned = text
    .replace(/^.*?(?:Requirements|Program Requirements)\b/i, 'Requirements')
    .trim();
  return cleaned.length > 100 ? cleaned : text;
}

function truncateHint(s: string, max = 2400): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + '... (see LSA for full text)';
}

const KIND_SHORT: Record<string, string> = {
  major: 'maj',
  minor: 'min',
};

function generate() {
  mkdirSync(MAJORS_DIR, { recursive: true });
  mkdirSync(MINORS_DIR, { recursive: true });

  // Delete previously-generated lsa-*.json files so removed programs don't linger
  for (const f of readdirSync(MAJORS_DIR)) {
    if (f.startsWith('lsa-') && f.endsWith('.json')) unlinkSync(join(MAJORS_DIR, f));
  }
  for (const f of readdirSync(MINORS_DIR)) {
    if (f.startsWith('lsa-') && f.endsWith('.json')) unlinkSync(join(MINORS_DIR, f));
  }

  const data = JSON.parse(readFileSync(PROGRAMS, 'utf8')) as {
    programs: LSAProgram[];
  };
  const reqManifest = loadReqManifest();

  let majorCount = 0;
  let minorCount = 0;
  let withRealText = 0;

  for (const p of data.programs) {
    if (p.kind === 'sub-major') continue;
    const isMinor = p.kind === 'minor';
    const kindShort = KIND_SHORT[p.kind];
    const id = isMinor ? programIdMinor(p.slug) : programIdMajor(p.slug);

    const realText = loadRequirementText(p.slug, kindShort);
    const reqEntry = reqManifest.get(`${p.slug}-${p.kind}`);
    const sourceUrl = reqEntry?.requirementsUrl ?? p.detailUrl;

    // Build the "specific requirements" block. If we have real text from LSA,
    // put it in the hint so students see actual requirements (unaudited).
    // Otherwise fall back to the generic placeholder.
    const specificReq = isMinor
      ? {
          id: 'minor-specific',
          label: 'Minor requirements (from LSA)',
          hint: realText
            ? truncateHint(realText)
            : 'Requirements text not yet loaded. See the sponsoring department for the authoritative list.',
          need: 1,
          matchAll: true,
          countMode: 'count',
          category: 'minor-specific',
        }
      : {
          id: 'major-specific',
          label: 'Major requirements (from LSA)',
          hint: realText
            ? truncateHint(realText)
            : 'Requirements text not yet loaded. See LSA for the authoritative list.',
          need: 1,
          matchAll: true,
          countMode: 'count',
          category: 'major-specific',
        };

    if (realText) withRealText++;

    const doc = {
      id,
      name: isMinor ? `${p.name} Minor` : p.name,
      school: LSA_SCHOOL,
      goalCredits: isMinor ? 15 : 120,
      requirements: isMinor
        ? [specificReq]
        : [...LSA_COLLEGE_WIDE_REQS, specificReq],
      ...(p.description ? { description: p.description } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    };

    const fname = `${id}.json`;
    const target = isMinor ? MINORS_DIR : MAJORS_DIR;
    writeFileSync(join(target, fname), JSON.stringify(doc, null, 2));
    if (isMinor) minorCount++;
    else majorCount++;
  }

  console.log(`Generated ${majorCount} major stubs in ${MAJORS_DIR}`);
  console.log(`Generated ${minorCount} minor stubs in ${MINORS_DIR}`);
  console.log(`Programs with real requirement text loaded: ${withRealText} / ${majorCount + minorCount}`);

  writeIndex(MAJORS_DIR, 'majors');
  writeIndex(MINORS_DIR, 'minors');
}

/**
 * Emit an index.ts in the given directory that statically imports every JSON
 * file and re-exports them as an array. Skips itself.
 */
function writeIndex(dir: string, kind: 'majors' | 'minors'): void {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const type = kind === 'majors' ? 'Major' : 'Minor';
  const lines: string[] = [];
  lines.push(`// AUTO-GENERATED by scripts/ingest/lsa-generate-stubs.ts. Do not edit by hand.`);
  lines.push(`import type { ${type} } from '@/lib/types';`);
  for (let i = 0; i < files.length; i++) {
    const name = `p${i}`;
    lines.push(`import ${name} from './${files[i]}';`);
  }
  lines.push('');
  lines.push(`export const all: ${type}[] = [`);
  for (let i = 0; i < files.length; i++) {
    lines.push(`  p${i} as ${type},`);
  }
  lines.push(`];`);
  lines.push('');
  writeFileSync(join(dir, 'index.ts'), lines.join('\n'));
  console.log(`  Wrote ${dir}/index.ts (${files.length} entries)`);
}

generate();
