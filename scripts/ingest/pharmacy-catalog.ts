/**
 * College of Pharmacy catalog entries for the BSPS. The college's online
 * course catalog is a JavaScript-driven search with no server-rendered
 * listing to scrape, but the LSA Course Guide already carries every BSPS
 * course except five 1-credit professional seminars. Those five are
 * curated here from two official college PDFs:
 *
 *   - BSPS Degree Checklist (wp-content/uploads/Bachelors-BSPS-Degree-
 *     Checklist.pdf): codes, credits, and the term each is offered.
 *   - BSPS Seminars (wp-content/uploads/BSPS-Seminars.pdf): full titles
 *     and descriptions, including "PharmSci 402, 1 credit taken two
 *     times".
 *
 * Run: npx tsx scripts/ingest/pharmacy-catalog.ts
 * Output: data/courses/pharmacy-catalog.json (merged by lib/data.ts,
 * gap-fill only; entries get the non-lsa tag at merge time).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'courses', 'pharmacy-catalog.json');

type TermKind = 'fall' | 'winter' | 'spring' | 'summer';

interface Entry {
  code: string;
  title: string;
  credits: number;
  tags: string[];
  offeredTerms?: TermKind[];
}

const CURATED: Entry[] = [
  {
    code: 'PHARMACY 102',
    title: 'Exploring Careers in Pharmaceutical Sciences and Healthcare',
    credits: 1,
    tags: [],
    offeredTerms: ['fall'],
  },
  {
    code: 'PHARMACY 212',
    title: 'Contemporary Research in the Pharmaceutical Sciences',
    credits: 1,
    tags: [],
    offeredTerms: ['fall'],
  },
  {
    code: 'PHARMACY 302',
    title: 'Developing Your Professional Self',
    credits: 1,
    tags: [],
    offeredTerms: ['fall'],
  },
  {
    code: 'PHARMACY 312',
    title: 'Clinical and Research Ethics',
    credits: 1,
    tags: [],
    offeredTerms: ['winter'],
  },
  {
    code: 'PHARMSCI 402',
    title: 'Undergraduate Seminar',
    credits: 1,
    tags: [],
    offeredTerms: ['fall', 'winter'],
  },
];

writeFileSync(
  OUT,
  JSON.stringify(
    {
      source:
        'Curated from the College of Pharmacy BSPS Degree Checklist and BSPS Seminars PDFs (pharmacy.umich.edu/wp-content/uploads); all other BSPS courses come from the LSA Course Guide scrape',
      courses: CURATED,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Wrote ${CURATED.length} courses to ${OUT}`);
