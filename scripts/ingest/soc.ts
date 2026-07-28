/**
 * Full-university course ingest via the official U-M Schedule of Classes API
 * (ITS API Directory). Unlike the LSA Course Guide scrape (scripts/ingest/
 * lsa.ts), this covers EVERY school and college: Engineering-only courses
 * (ENGR 100, most ROB), Ross, SEAS, SPH, Stamps, SMTD, Nursing, Kines, etc.
 *
 * One-time setup (requires a U-M login, so Morgan does this once):
 *   1. Go to https://api.umich.edu and sign in.
 *   2. Create an application, then subscribe it to the "SOC - Schedule of
 *      Classes" API (a.k.a. Curriculum SOC).
 *   3. Put the credentials in .env.local at the repo root:
 *        UM_API_CLIENT_ID=...
 *        UM_API_CLIENT_SECRET=...
 *   4. Run: npx tsx scripts/ingest/soc.ts            (default terms)
 *      or:  npx tsx scripts/ingest/soc.ts 2560 2570  (explicit term codes)
 *
 * Output: data/courses/soc.json  { terms: [...], courses: Course[] }
 * lib/data.ts merges it under the LSA CG scrape: CG entries win (they carry
 * distribution tags and descriptions); SOC fills every gap. Programmatic
 * tags (subj-*, upper-level, CoE liberal arts) apply to both.
 *
 * Resume: reruns skip (term, subject) pairs already present in soc.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const GW = 'https://gw.api.it.umich.edu';
const TOKEN_URL = `${GW}/um/oauth2/token`;
const SOC_BASE = `${GW}/um/Curriculum/SOC`;
const OUT_PATH = join(process.cwd(), 'data', 'courses', 'soc.json');

// Preferred terms: the same cycle the LSA scrape targets. Term codes are
// PeopleSoft 4-digit codes (Fall 2026 = 2560, Winter 2027 = 2570). If none
// of these exist yet, the two most recent published terms are used.
const PREFERRED_TERM_DESCRS = [/fall 2026/i, /winter 2027/i];

interface SocCourse {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  description?: string;
}

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env.local', '.env']) {
    const p = join(process.cwd(), file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...out, ...process.env } as Record<string, string>;
}

async function getToken(id: string, secret: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
    scope: 'umscheduleofclasses',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`token request failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error(`no access_token in ${JSON.stringify(json)}`);
  return json.access_token;
}

/** GET a SOC path and unwrap the IBM-style envelope to the first array/object of interest. */
async function socGet(token: string, path: string, retries = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${SOC_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`GET ${path}: ${res.status}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    if (res.status === 404) return null; // e.g. subject with no catalog numbers
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

/** Depth-first: find the first array under a key matching `keyHint`, else the first array anywhere. */
function findArray(node: unknown, keyHint: RegExp): unknown[] {
  const queue: unknown[] = [node];
  let fallback: unknown[] | null = null;
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object') continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        if (keyHint.test(k)) return v;
        fallback = fallback ?? v;
      } else if (v && typeof v === 'object') {
        if (keyHint.test(k)) return [v]; // single-item responses come unwrapped
        queue.push(v);
      }
    }
  }
  return fallback ?? [];
}

function str(o: unknown, ...keys: string[]): string {
  if (!o || typeof o !== 'object') return '';
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) return String(v).trim();
  }
  return '';
}

async function main() {
  const env = loadEnv();
  const id = env.UM_API_CLIENT_ID;
  const secret = env.UM_API_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      'Missing UM_API_CLIENT_ID / UM_API_CLIENT_SECRET.\n\n' +
        'One-time setup: sign in at https://api.umich.edu, create an app,\n' +
        'subscribe it to the "SOC - Schedule of Classes" API, and put the\n' +
        'client id/secret in .env.local. Then rerun this script.',
    );
    process.exit(1);
  }

  console.log('[auth] requesting token...');
  const token = await getToken(id, secret);

  // 1. Terms
  const termsRaw = await socGet(token, '/Terms');
  const terms = findArray(termsRaw, /term/i);
  const termOf = (t: unknown) => ({
    code: str(t, 'TermCode', 'termCode', 'code'),
    descr: str(t, 'TermDescr', 'termDescr', 'descr', 'TermShortDescr'),
  });
  const allTerms = terms.map(termOf).filter((t) => t.code);
  console.log(`[terms] ${allTerms.map((t) => `${t.code}=${t.descr}`).join(', ')}`);

  const argTerms = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
  let targetTerms = argTerms.length
    ? allTerms.filter((t) => argTerms.includes(t.code))
    : allTerms.filter((t) => PREFERRED_TERM_DESCRS.some((re) => re.test(t.descr)));
  if (targetTerms.length === 0) {
    targetTerms = allTerms.slice(-2);
    console.log('[terms] preferred terms not published; falling back to latest two');
  }
  console.log(`[terms] ingesting: ${targetTerms.map((t) => `${t.descr} (${t.code})`).join(', ')}`);

  // Resume state
  let existing: { terms?: string[]; courses?: SocCourse[]; fetched?: string[] } = {};
  if (existsSync(OUT_PATH)) {
    existing = JSON.parse(readFileSync(OUT_PATH, 'utf-8'));
    console.log(`[resume] ${existing.courses?.length ?? 0} courses already on disk`);
  }
  const byCode = new Map<string, SocCourse>((existing.courses ?? []).map((c) => [c.code, c]));
  const fetched = new Set<string>(existing.fetched ?? []);

  const save = () => {
    writeFileSync(
      OUT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          terms: targetTerms.map((t) => t.descr),
          fetched: Array.from(fetched).sort(),
          courses: Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code)),
        },
        null,
        1,
      ),
    );
  };

  for (const term of targetTerms) {
    // 2. Schools per term
    const schoolsRaw = await socGet(token, `/Terms/${term.code}/Schools`);
    const schools = findArray(schoolsRaw, /school/i)
      .map((s) => ({
        code: str(s, 'SchoolCode', 'schoolCode', 'code'),
        descr: str(s, 'SchoolDescr', 'schoolDescr', 'descr'),
      }))
      .filter((s) => s.code);
    console.log(`\n[${term.descr}] ${schools.length} schools`);

    for (const school of schools) {
      // 3. Subjects per school
      const subjectsRaw = await socGet(
        token,
        `/Terms/${term.code}/Schools/${school.code}/Subjects`,
      );
      const subjects = findArray(subjectsRaw, /subject/i)
        .map((s) => ({
          code: str(s, 'SubjectCode', 'subjectCode', 'code'),
          descr: str(s, 'SubjectDescr', 'subjectDescr', 'descr'),
        }))
        .filter((s) => s.code);

      for (const subject of subjects) {
        const key = `${term.code}:${school.code}:${subject.code}`;
        if (fetched.has(key)) continue;

        // 4. Catalog numbers per subject
        const nbrsRaw = await socGet(
          token,
          `/Terms/${term.code}/Schools/${school.code}/Subjects/${subject.code}/CatalogNbrs`,
        );
        const nbrs = findArray(nbrsRaw, /catalog/i);
        let added = 0;
        for (const n of nbrs) {
          const nbr = str(n, 'CatalogNumber', 'CatalogNbr', 'catalogNbr', 'nbr').replace(/\s+/g, '');
          if (!nbr) continue;
          const code = `${subject.code} ${nbr}`;
          const title = str(n, 'CourseDescr', 'courseDescr', 'CourseTitle', 'descr');
          const max = parseFloat(str(n, 'MaxUnits', 'maxUnits', 'UnitsMax'));
          const min = parseFloat(str(n, 'MinUnits', 'minUnits', 'UnitsMin'));
          const credits = Number.isFinite(max) ? max : Number.isFinite(min) ? min : 3;
          const prev = byCode.get(code);
          if (!prev) {
            byCode.set(code, { code, title: title || code, credits, tags: [] });
            added++;
          } else if (!prev.title || prev.title === prev.code) {
            prev.title = title || prev.title;
          }
        }
        fetched.add(key);
        if (added > 0) {
          console.log(`  [${term.code}] ${school.code}/${subject.code}: +${added} (total ${byCode.size})`);
        }
        if (fetched.size % 25 === 0) save();
      }
    }
    save();
  }

  save();
  console.log(`\n[done] ${byCode.size} unique courses -> ${OUT_PATH}`);
  console.log('Next: lib/data.ts already merges soc.json when present; run npx vitest run and npx tsx scripts/validate-majors.ts to see catalog-gap warnings shrink.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
