/**
 * One-off migration: remove the fabricated `lsa-dist-total` (30-credit
 * distribution total) requirement from every major that has it. Not a real
 * LSA requirement. Idempotent.
 *
 * Run: npx tsx scripts/drop-lsa-dist-total.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAJORS_DIR = join(process.cwd(), 'data', 'majors');

const files = readdirSync(MAJORS_DIR).filter((f) => f.endsWith('.json'));

let updated = 0;
let skipped = 0;

for (const f of files) {
  const path = join(MAJORS_DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf-8'));
  const reqs: { id: string }[] = data.requirements ?? [];

  const idx = reqs.findIndex((r) => r.id === 'lsa-dist-total');
  if (idx === -1) {
    skipped++;
    continue;
  }

  data.requirements = [...reqs.slice(0, idx), ...reqs.slice(idx + 1)];
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  updated++;
}

console.log(`Updated ${updated} · skipped ${skipped} · total ${files.length}`);
