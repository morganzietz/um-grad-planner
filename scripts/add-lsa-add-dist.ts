/**
 * One-off migration: insert the "LSA additional distribution" requirement block
 * into every LSA major JSON that doesn't already have it. The block sits
 * between `lsa-dist-total` and `major-specific`. Idempotent — skips files that
 * already contain `lsa-add-dist-choose-3`.
 *
 * Run: npx tsx scripts/add-lsa-add-dist.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAJORS_DIR = join(process.cwd(), 'data', 'majors');

// Same shape as cs-ba.json's additional-distribution block.
const ADD_DIST_BLOCK = [
  {
    id: 'lsa-add-dist-choose-3',
    label: 'Additional Distribution: complete 3 areas',
    hint: 'Pick any 3 of the 6 area buckets below and hit 3 cr in each. Interdisciplinary credit can count toward 1, 2, or 3 areas.',
    need: 3,
    countMode: 'count',
    category: 'lsa-add-distribution',
    pickFromGroups: [
      'lsa-add-dist-humanities',
      'lsa-add-dist-natural-sciences',
      'lsa-add-dist-social-sciences',
      'lsa-add-dist-math-symbolic',
      'lsa-add-dist-creative-expression',
      'lsa-add-dist-interdisciplinary',
    ],
  },
  {
    id: 'lsa-add-dist-humanities',
    label: 'Additional 3 Credits in Humanities',
    hint: 'Beyond the initial 7 cr Humanities.',
    need: 3,
    offset: 7,
    matchTag: 'lsa-humanities',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
  {
    id: 'lsa-add-dist-natural-sciences',
    label: 'Additional 3 Credits in Natural Sciences',
    hint: 'Beyond the initial 7 cr Natural Sciences.',
    need: 3,
    offset: 7,
    matchTag: 'lsa-natural-sciences',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
  {
    id: 'lsa-add-dist-social-sciences',
    label: 'Additional 3 Credits in Social Sciences',
    hint: 'Beyond the initial 7 cr Social Sciences.',
    need: 3,
    offset: 7,
    matchTag: 'lsa-social-sciences',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
  {
    id: 'lsa-add-dist-math-symbolic',
    label: '3 Credits in Mathematical & Symbolic Analysis',
    hint: 'From approved MSA-designated courses.',
    need: 3,
    matchTag: 'lsa-math-symbolic',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
  {
    id: 'lsa-add-dist-creative-expression',
    label: '3 Credits in Creative Expression',
    hint: 'From approved CE-designated courses.',
    need: 3,
    matchTag: 'lsa-creative-expression',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
  {
    id: 'lsa-add-dist-interdisciplinary',
    label: '3 Credits in Interdisciplinary',
    hint: 'From approved ID-designated courses.',
    need: 3,
    matchTag: 'lsa-interdisciplinary',
    countMode: 'credits',
    category: 'lsa-add-distribution',
  },
];

const files = readdirSync(MAJORS_DIR).filter(
  (f) => f.startsWith('lsa-') && f.endsWith('.json'),
);

let updated = 0;
let skipped = 0;

for (const f of files) {
  const path = join(MAJORS_DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const reqs: { id: string }[] = data.requirements ?? [];

  if (reqs.some((r) => r.id === 'lsa-add-dist-choose-3')) {
    skipped++;
    continue;
  }

  const distTotalIdx = reqs.findIndex((r) => r.id === 'lsa-dist-total');
  if (distTotalIdx === -1) {
    console.warn(`  ${f}: no lsa-dist-total found, skipping`);
    skipped++;
    continue;
  }

  data.requirements = [
    ...reqs.slice(0, distTotalIdx + 1),
    ...ADD_DIST_BLOCK,
    ...reqs.slice(distTotalIdx + 1),
  ];

  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  updated++;
}

console.log(`Updated ${updated} · skipped ${skipped} · total ${files.length}`);
