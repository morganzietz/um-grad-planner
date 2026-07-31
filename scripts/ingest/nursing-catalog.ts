/**
 * School of Nursing course catalog from the school's official Program Plans
 * application (nursing.umich.edu/program_plans). The app is driven by one
 * public JSON file containing every course (credits, descriptions, terms
 * offered, enforced prerequisites, clinical hours) plus the published
 * program plans for each degree and admit year.
 *
 * nursing.umich.edu blocks non-browser fetches, so this tries the live URL
 * first and falls back to the latest Internet Archive capture.
 *
 * Run: npx tsx scripts/ingest/nursing-catalog.ts
 * Output: data/courses/nursing-catalog.json (merged by lib/data.ts,
 * gap-fill only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'nursing-catalog.json');
const LIVE = 'https://nursing.umich.edu/program_plans/program_plan_data.json';
const ARCHIVE = `https://web.archive.org/web/2026/${LIVE}`;

/** Placeholder pseudo-subjects the plan app uses for "elective slot" rows. */
const PSEUDO_SUBJECTS = new Set([
  'AGACNPREQ', 'BSNREQ', 'CHIREQ', 'CNEREQ', 'GENREQ', 'GLOBALHTHREQ',
  'LAIREQ', 'NOTE', 'OHNREQ', 'PHDREQ',
]);

interface RawCourse {
  c2_subject: string;
  c2_number: string;
  c2_title: string;
  c2_description?: string;
  c2_credits_min?: string;
  c2_credits_max?: string;
  c2_term_fall?: string;
  c2_term_winter?: string;
  c2_term_spring_summer?: string;
  c2_prereq_enforced?: string;
  c2_prereq_other?: string;
}

async function fetchData(): Promise<Record<string, RawCourse>> {
  for (const url of [LIVE, ARCHIVE]) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.text();
      const parsed = JSON.parse(body) as {
        data: { courses: { records: Record<string, RawCourse> } };
      };
      console.log(`[source] ${url}`);
      return parsed.data.courses.records;
    } catch (e) {
      console.error(`[skip] ${url}: ${e}`);
    }
  }
  throw new Error('no source reachable');
}

async function main() {
  const records = await fetchData();
  const courses = [];
  for (const [code, r] of Object.entries(records)) {
    if (PSEUDO_SUBJECTS.has(r.c2_subject)) continue;
    const credits = parseFloat(r.c2_credits_max || r.c2_credits_min || '');
    if (!Number.isFinite(credits)) continue;
    const offeredTerms: string[] = [];
    if (r.c2_term_fall === '1') offeredTerms.push('fall');
    if (r.c2_term_winter === '1') offeredTerms.push('winter');
    if (r.c2_term_spring_summer === '1') offeredTerms.push('spring');
    const description = (r.c2_description ?? '')
      .replace(/^.*?---\s*/s, '')
      .replace(/\s+/g, ' ')
      .trim();
    const prereqRaw = [r.c2_prereq_enforced, r.c2_prereq_other]
      .filter((p) => p && p.trim())
      .join('; ');
    courses.push({
      code,
      title: r.c2_title.replace(/\s+/g, ' ').trim(),
      credits,
      tags: [],
      ...(description ? { description } : {}),
      ...(offeredTerms.length > 0 ? { offeredTerms } : {}),
      ...(prereqRaw ? { prereqRaw } : {}),
    });
  }
  courses.sort((a, b) => a.code.localeCompare(b.code));
  const subjects = Array.from(new Set(courses.map((c) => c.code.split(' ')[0]))).sort();
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source:
          'UMSN Program Plans application data (nursing.umich.edu/program_plans/program_plan_data.json)',
        subjects,
        courses,
      },
      null,
      1,
    ),
  );
  console.log(`[done] ${courses.length} courses across ${subjects.length} subjects -> ${OUT}`);
  console.log(subjects.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
