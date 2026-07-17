/**
 * Structured audit encoding pass for LSA majors.
 *
 * For each LSA major JSON, replace the single `major-specific` (matchAll:true)
 * requirement with structured entries derived from the cleaned requirement
 * text at data/lsa-req-text/<slug>-maj.txt.
 *
 * Two paths:
 *   1) Hand-crafted overrides (see MAJOR_OVERRIDES). These are majors we've
 *      read carefully and encoded by hand. Highest fidelity.
 *   2) Auto baseline. For any major without an override, pull the "Minimum
 *      Credits: N" line + guess the primary subject prefix from the codes
 *      appearing in the text, then emit a real `major-min-credits` req
 *      using matchTag:`subj-<prefix>`. Preserve the raw text as a `major-detail`
 *      fallback for the parts we can't audit yet.
 *
 * Idempotent: reruns replace only the major-specific block, keeping the LSA
 * boilerplate that add-lsa-add-dist.ts + the initial stub generator produced.
 *
 * Run: npx tsx scripts/encode-lsa-majors.ts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface Requirement {
  id: string;
  label: string;
  hint: string;
  need: number;
  countMode: 'credits' | 'count';
  matchAll?: boolean;
  matchTag?: string;
  matchCodes?: string[];
  excludeTags?: string[];
  offset?: number;
  pickFromGroups?: string[];
  category?: string;
}

const MAJORS_DIR = join(process.cwd(), 'data', 'majors');
const TEXT_DIR = join(process.cwd(), 'data', 'lsa-req-text');

// ── LSA boilerplate (identical across every LSA major) ─────────────────
// Never re-emitted by this script — we only touch the tail. Kept here for
// reference so we can validate the base is intact.

const LSA_REQ_IDS = new Set([
  'lsa-total-credits',
  'lsa-credits',
  'lsa-upper-level',
  'lsa-fywr',
  'lsa-ulwr',
  'lsa-race-ethnicity',
  'lsa-qr',
  'lsa-language',
  'lsa-dist-humanities',
  'lsa-dist-natural-sciences',
  'lsa-dist-social-sciences',
  'lsa-add-dist-choose-3',
  'lsa-add-dist-humanities',
  'lsa-add-dist-natural-sciences',
  'lsa-add-dist-social-sciences',
  'lsa-add-dist-math-symbolic',
  'lsa-add-dist-creative-expression',
  'lsa-add-dist-interdisciplinary',
]);

// ── Hand-crafted overrides ──────────────────────────────────────────────
// Slug (JSON id, minus the "lsa-" prefix) → the ordered list of structured
// requirements to append after the LSA distribution boilerplate.

const OVERRIDES: Record<string, Requirement[]> = {
  // CS and Economics were hand-edited directly before this script existed;
  // we skip them here to avoid clobbering.
  'computer-science': [],
  economics: [],

  english: [
    {
      id: 'eng-min-credits',
      label: '27 Credits in ENGLISH',
      hint: 'Minimum 27 credits in ENGLISH courses (General Program). C- or better in all major courses.',
      need: 27,
      countMode: 'credits',
      matchTag: 'subj-english',
      category: 'major-credit-min',
    },
    {
      id: 'eng-foundations-methods',
      label: 'Foundations & Methods — 2 courses (6 credits)',
      hint: 'One 200-level from the approved list + one 300/400-level. See English Course Requirements list.',
      need: 6,
      countMode: 'credits',
      matchTag: 'subj-english',
      category: 'core',
    },
    {
      id: 'eng-regions',
      label: 'Regions — 2 upper-level courses (6 credits)',
      hint: 'One 300/400 from Americas/UK/Australia/NZ/Ireland + one from Africa/Asia/Middle East/Pacific. See approved list.',
      need: 6,
      countMode: 'credits',
      matchTag: 'subj-english-upper',
      category: 'core',
    },
    {
      id: 'eng-time',
      label: 'Time — 2 upper-level courses (6 credits)',
      hint: 'One 300/400 from two of: Medieval/Early Modern, 18th/19th Centuries, Modern/Contemporary. See approved list.',
      need: 6,
      countMode: 'credits',
      matchTag: 'subj-english-upper',
      category: 'core',
    },
    {
      id: 'eng-ulwr-in-major',
      label: 'Upper-Level Writing within the Major',
      hint: 'ENGLISH 325, 398, 401, 425, 428, or 496 satisfies both the major ULWR and the LSA ULWR.',
      need: 1,
      countMode: 'count',
      matchCodes: ['ENGLISH 325', 'ENGLISH 398', 'ENGLISH 401', 'ENGLISH 425', 'ENGLISH 428', 'ENGLISH 496'],
      category: 'core',
    },
  ],

  'general-biology': [
    {
      id: 'bhs-min-credits',
      label: '24 Major Credits (Biology, Health, & Society)',
      hint: 'From BIOLOGY, EEB, MCDB courses. Prereqs and non-specific transfer excluded from the 24.',
      need: 24,
      countMode: 'credits',
      matchTag: 'bhs-major-eligible',
      category: 'major-credit-min',
    },
    {
      id: 'bhs-group-a-gateway',
      label: 'Group A: Gateway Biology (2 courses, 6 cr)',
      hint: 'Choose 2 of BIOLOGY 205, 207, 222 (through FA21), 225, 230, 252, 255, 256, 272, 288, 290.',
      need: 6,
      countMode: 'credits',
      matchCodes: ['BIOLOGY 205', 'BIOLOGY 207', 'BIOLOGY 222', 'BIOLOGY 225', 'BIOLOGY 230', 'BIOLOGY 252', 'BIOLOGY 255', 'BIOLOGY 256', 'BIOLOGY 272', 'BIOLOGY 288', 'BIOLOGY 290'],
      category: 'core',
    },
    {
      id: 'bhs-group-c-core-bio',
      label: 'Group C: Core Biology (2 courses, 6 cr)',
      hint: 'Genetics BIOLOGY 305; Biochem MCDB 310 / BIOLCHEM 415 / CHEM 351; Evolution EEB 390/391/392; Ecology BIOLOGY 281/282 or EEB 381.',
      need: 6,
      countMode: 'credits',
      matchCodes: ['BIOLOGY 305', 'MCDB 310', 'BIOLCHEM 415', 'CHEM 351', 'EEB 390', 'EEB 391', 'EEB 392', 'BIOLOGY 281', 'BIOLOGY 282', 'EEB 381'],
      category: 'core',
    },
    {
      id: 'bhs-group-d-elective',
      label: 'Group D: Biology Elective (1 course, 3 cr)',
      hint: 'BIOLOGY, EEB, or MCDB at 200/300/400 level. Exclusions in text: 200, 212, 241, 299; MCDB/EEB 300-302, 360, 396, 397, 399, 400, 412, 460, 461, 494, 499.',
      need: 3,
      countMode: 'credits',
      matchTag: 'bhs-major-eligible',
      category: 'core',
    },
    {
      id: 'bhs-group-b-health-society',
      label: 'Group B: Health & Society (2 courses, 6 cr)',
      hint: 'From an approved cross-department list including AAS/WGS/AMCULT/ENVIRON/PUBHLTH/SOC. See department page for the full list.',
      need: 6,
      countMode: 'credits',
      matchTag: 'bhs-health-society',
      category: 'electives',
    },
  ],

  biology: [
    {
      id: 'bio-min-credits',
      label: '30 Major Credits (Biology)',
      hint: 'From BIOLOGY, EEB, MCDB courses + approved cognates. Prereqs and non-specific transfer excluded from the 30.',
      need: 30,
      countMode: 'credits',
      matchTag: 'bio-major-eligible',
      category: 'major-credit-min',
    },
    {
      id: 'bio-group-i-mcdb',
      label: 'Group I: MCDB Elective (1 course)',
      hint: 'BIOLOGY 205, 207, 225, 230, 272.',
      need: 1,
      countMode: 'count',
      matchCodes: ['BIOLOGY 205', 'BIOLOGY 207', 'BIOLOGY 225', 'BIOLOGY 230', 'BIOLOGY 272'],
      category: 'core',
    },
    {
      id: 'bio-group-ii-eeb',
      label: 'Group II: EEB Elective (1 course)',
      hint: 'BIOLOGY 207, 230, 252, 255, 256, 281, 282, 288, or EEB 381.',
      need: 1,
      countMode: 'count',
      matchCodes: ['BIOLOGY 207', 'BIOLOGY 230', 'BIOLOGY 252', 'BIOLOGY 255', 'BIOLOGY 256', 'BIOLOGY 281', 'BIOLOGY 282', 'BIOLOGY 288', 'EEB 381'],
      category: 'core',
    },
    {
      id: 'bio-genetics',
      label: 'Genetics: BIOLOGY 305',
      hint: 'Required.',
      need: 1,
      countMode: 'count',
      matchCodes: ['BIOLOGY 305'],
      category: 'core',
    },
    {
      id: 'bio-biochem',
      label: 'Biochemistry (1 course)',
      hint: 'MCDB 310, BIOLCHEM 415, or CHEM 351.',
      need: 1,
      countMode: 'count',
      matchCodes: ['MCDB 310', 'BIOLCHEM 415', 'CHEM 351'],
      category: 'core',
    },
    {
      id: 'bio-evolution',
      label: 'Evolution (1 course)',
      hint: 'EEB 390, 391, or 392.',
      need: 1,
      countMode: 'count',
      matchCodes: ['EEB 390', 'EEB 391', 'EEB 392'],
      category: 'core',
    },
    {
      id: 'bio-upper-elective',
      label: 'Upper-Level Elective (1 course)',
      hint: 'EEB or MCDB at 300/400 level. See department page for exclusions.',
      need: 1,
      countMode: 'count',
      matchTag: 'bio-upper-elective',
      category: 'electives',
    },
    {
      id: 'bio-labs',
      label: '3 Lab Courses',
      hint: 'Approved lab courses from BIOLOGY, EEB, MCDB. May overlap with other requirements.',
      need: 3,
      countMode: 'count',
      matchTag: 'bio-lab',
      category: 'core',
    },
  ],

  'psychology-general-social-science': [
    {
      id: 'psych-prereq-intro',
      label: 'Intro Psychology prerequisite',
      hint: 'PSYCH 111, 112, or 114. C or better.',
      need: 1,
      countMode: 'count',
      matchCodes: ['PSYCH 111', 'PSYCH 112', 'PSYCH 114'],
      category: 'prerequisites',
    },
    {
      id: 'psych-prereq-stats',
      label: 'Stats prerequisite',
      hint: 'DATASCI 101 or STATS 250 or STATS 280. C- or better, or P.',
      need: 1,
      countMode: 'count',
      matchCodes: ['DATASCI 101', 'STATS 250', 'STATS 280'],
      category: 'prerequisites',
    },
    {
      id: 'psych-min-credits',
      label: '32 Major Credits (PSYCH)',
      hint: '32 credits in PSYCH courses, excluding prereqs.',
      need: 32,
      countMode: 'credits',
      matchTag: 'subj-psych',
      category: 'major-credit-min',
    },
    {
      id: 'psych-breadth-i',
      label: 'Breadth Group I: PSYCH 220 or 235 or 240',
      hint: 'Sensation & Perception / Learning / Cognition.',
      need: 1,
      countMode: 'count',
      matchCodes: ['PSYCH 220', 'PSYCH 235', 'PSYCH 240'],
      category: 'core',
    },
    {
      id: 'psych-breadth-ii',
      label: 'Breadth Group II: PSYCH 250 or 270',
      hint: 'Developmental / Personality.',
      need: 1,
      countMode: 'count',
      matchCodes: ['PSYCH 250', 'PSYCH 270'],
      category: 'core',
    },
    {
      id: 'psych-breadth-iii',
      label: 'Breadth Group III: PSYCH 280 or 290 or 291',
      hint: 'Social / Abnormal / Biopsychology.',
      need: 1,
      countMode: 'count',
      matchCodes: ['PSYCH 280', 'PSYCH 290', 'PSYCH 291'],
      category: 'core',
    },
    {
      id: 'psych-lab',
      label: 'Lab Requirement',
      hint: 'Two 3+ cr Methods-based Lab courses, OR one Methods + one Experiential Lab, OR the Psychology Thesis Research sequence (6+ cr). See dept course info page.',
      need: 1,
      countMode: 'count',
      matchTag: 'psych-lab',
      category: 'core',
    },
    {
      id: 'psych-upper-electives',
      label: 'Upper-Level Electives (4 courses, 12+ credits)',
      hint: 'At least 2 at 300-level (PSYCH 225 or COGSCI 200 may sub for one), at least 1 at 400-level. See dept course info page.',
      need: 12,
      countMode: 'credits',
      matchTag: 'subj-psych-upper',
      category: 'electives',
    },
  ],
};

// ── Subject-prefix hints per major slug ─────────────────────────────────
// Used for the AUTO baseline when a major doesn't have an override. Maps
// the LSA slug (JSON id minus "lsa-") to the subject prefix we expect to
// see in course codes for that major.

const SUBJECT_HINTS: Record<string, string> = {
  'afroamerican-and-african-studies': 'AAS',
  'american-culture': 'AMCULT',
  anthropology: 'ANTHRCUL',
  'archaeology-of-the-ancient-mediterranean': 'CLARCH',
  'arts-and-ideas-in-the-humanities': 'RCHUMS',
  'asian-studies': 'ASIAN',
  'astronomy-and-astrophysics': 'ASTRO',
  'biochemistry-bs': 'BIOLCHEM',
  'biomolecular-science-ab-or-bs': 'MCDB',
  'biophyschology-cognition-and-neuroscience-bcn': 'PSYCH',
  'biophysics-bs': 'BIOPHYS',
  'biotechnology-and-bioenvironmental-sciences': 'BIOLOGY',
  'cell-and-molecular-biology': 'MCDB',
  'cell-and-molecular-biology-and-biomedical-engineering': 'MCDB',
  chemistry: 'CHEM',
  'classical-civilization': 'CLCIV',
  'classical-languages-and-literatures': 'GREEK',
  'cognitive-science': 'COGSCI',
  'communication-studies': 'COMM',
  'comparative-literature-arts-and-media': 'COMPLIT',
  'creative-writing-and-literature': 'ENGLISH',
  'data-science': 'DATASCI',
  drama: 'THTREMUS',
  'earth-and-environmental-sciences': 'EARTH',
  'ecology-and-evolutionary-biology-eeb': 'EEB',
  environment: 'ENVIRON',
  'french-and-francophone-studies': 'FRENCH',
  'gender-and-health': 'WOMENSTD',
  'general-studies': 'ALA',
  german: 'GERMAN',
  'greek-ancient-language-and-literature': 'GREEK',
  'greek-modern-language-and-culture': 'GREEKMOD',
  'history-of-art': 'HISTART',
  history: 'HISTORY',
  'human-origins-biology-and-behavior': 'ANTHRBIO',
  'interdisciplinary-astronomy-ba-or-bs': 'ASTRO',
  'interdisciplinary-chemical-sciences-ics-ab-or-bs': 'CHEM',
  'interdiscplinary-physics-ab-or-bs': 'PHYSICS',
  'international-studies': 'IS',
  italian: 'ITALIAN',
  'judaic-studies': 'JUDAIC',
  'latin-american-and-caribbean-studies': 'LACS',
  'latin-language-and-literature': 'LATIN',
  'latina-latino-studies': 'LATINOAM',
  linguistics: 'LING',
  mathematics: 'MATH',
  microbiology: 'MICRBIOL',
  'middle-eastern-and-north-african-studies': 'MIDEAST',
  'near-eastern-studies': 'MIDEAST',
  neuroscience: 'NEUROSCI',
  'organizational-studies': 'ORGSTUDY',
  'philosophy-political-science-economics': 'PPE',
  philosophy: 'PHIL',
  physics: 'PHYSICS',
  polish: 'POLISH',
  'political-science': 'POLSCI',
  'psychology-general-social-science': 'PSYCH',
  'romance-languages-and-literatures': 'ROMLANG',
  'russian-east-european-and-eurasian-studies': 'REES',
  russian: 'RUSSIAN',
  'screen-arts-and-cultures': 'SAC',
  'social-theory-and-practice': 'STP',
  sociology: 'SOC',
  spanish: 'SPANISH',
  statistics: 'STATS',
  translation: 'TRNSLATN',
  'womens-studies': 'WOMENSTD',
};

// ── Helpers ──────────────────────────────────────────────────────────────

function jsonSlug(fileName: string): string {
  // "lsa-english.json" → "english"
  return fileName.replace(/^lsa-/, '').replace(/\.json$/, '');
}

function candidateTextSlugs(jsonSlug: string): string[] {
  // Text files use inconsistent conventions — some underscore-separated,
  // some hyphen-separated. Try both.
  return [
    jsonSlug.replaceAll('-', '_') + '-maj',
    jsonSlug + '-maj',
  ];
}

function extractRequirementsSection(text: string): string {
  // Text files have "## Extracted Requirements Section\n\n" then the section.
  // Everything before "## Full Text" (if any) is the section.
  const start = text.indexOf('## Extracted Requirements Section');
  if (start === -1) return text;
  const after = text.slice(start);
  const end = after.indexOf('## Full Text');
  const body = end === -1 ? after : after.slice(0, end);
  return body.replace('## Extracted Requirements Section', '').trim();
}

function extractMinCredits(reqText: string): number | undefined {
  const m = reqText.match(/Minimum Credits:\s*(\d+)/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function autoBaseline(slug: string, reqText: string): Requirement[] {
  const out: Requirement[] = [];
  const minCredits = extractMinCredits(reqText);
  const subject = SUBJECT_HINTS[slug];

  if (minCredits && subject) {
    out.push({
      id: `${slug}-min-credits`,
      label: `${minCredits} Major Credits`,
      hint: `Minimum ${minCredits} credits in ${subject} courses (see department page for exact eligible list and constraints).`,
      need: minCredits,
      countMode: 'credits',
      matchTag: `subj-${subject.toLowerCase()}`,
      category: 'major-credit-min',
    });
  } else if (minCredits) {
    out.push({
      id: `${slug}-min-credits`,
      label: `${minCredits} Major Credits`,
      hint: `Minimum ${minCredits} major credits. Verify exact eligible courses with the department.`,
      need: minCredits,
      countMode: 'credits',
      matchAll: true,
      category: 'major-credit-min',
    });
  }

  // Preserve the raw text so users can still see the full requirements while
  // we work on more precise auditing.
  out.push({
    id: `${slug}-detail`,
    label: 'Major requirements (from LSA — full text)',
    hint: collapseWhitespace(reqText).slice(0, 3800),
    need: 1,
    countMode: 'count',
    matchAll: true,
    category: 'major-detail',
  });

  return out;
}

// ── Main loop ────────────────────────────────────────────────────────────

const files = readdirSync(MAJORS_DIR).filter(
  (f) => f.startsWith('lsa-') && f.endsWith('.json'),
);

let overridden = 0;
let autoed = 0;
let skipped = 0;
let missingText = 0;

for (const f of files) {
  const slug = jsonSlug(f);
  if (slug === 'computer-science' || slug === 'economics') {
    // These were hand-edited before this script existed; leave them alone.
    skipped++;
    continue;
  }

  const path = join(MAJORS_DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const reqs: Requirement[] = data.requirements ?? [];

  // Keep everything before the first non-LSA req (which is `major-specific`
  // in the current stubs). Drop any existing tail so reruns are clean.
  const baseTail = reqs.findIndex((r) => !LSA_REQ_IDS.has(r.id));
  const base = baseTail === -1 ? reqs : reqs.slice(0, baseTail);

  let tail = OVERRIDES[slug];
  if (tail && tail.length > 0) {
    overridden++;
  } else {
    const textPath = candidateTextSlugs(slug)
      .map((s) => join(TEXT_DIR, s + '.txt'))
      .find((p) => existsSync(p));
    if (!textPath) {
      missingText++;
      console.warn(`  ${f}: no text file, skipping`);
      continue;
    }
    const raw = readFileSync(textPath, 'utf-8');
    const reqText = extractRequirementsSection(raw);
    tail = autoBaseline(slug, reqText);
    autoed++;
  }

  data.requirements = [...base, ...tail];
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

console.log(
  `Overrides applied: ${overridden} · auto baseline: ${autoed} · skipped (hand-edited): ${skipped} · missing text: ${missingText} · total: ${files.length}`,
);
