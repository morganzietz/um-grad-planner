/**
 * Pure parsers for LSA Course Guide HTML.
 *
 * Two page types:
 *   - Results page (cg_results.aspx): one .ClassRow per section, with
 *     subject/catalog/title/credits/distribution codes. No prereqs or
 *     description here.
 *   - Detail page (cg_detail.aspx): full course info under #ClassDetails
 *     (labeled `Credits:`, `Requirements & Distribution:`, `Advisory
 *     Prerequisites:`, `Enforced Prerequisites:`, `Credit Exclusions:`,
 *     `Cross-Listed Classes:`) and #ClassDescription.
 *
 * All exports are pure functions of the HTML input — no fetch. Ingestion
 * script does the fetching and hands HTML in.
 */
import { load } from 'cheerio';
import type { Course } from '../types';

export interface ListingSection {
  subject: string;
  catalog: string;
  section: string;
  title: string;
  credits: number;
  distributionCodes: string[];
  detailUrl: string;
}

export interface DetailFields {
  credits?: number;
  distributionCodes?: string[];
  advisoryPrereqs?: string;
  enforcedPrereqs?: string;
  creditExclusions?: string;
  crossListed?: string;
  description?: string;
}

/** Normalize whitespace and decode common HTML entities in extracted text. */
function clean(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse "4" or "1-4" or "1 - 4" into the maximum credit value. */
function parseCredits(s: string): number | undefined {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?/);
  if (!m) return undefined;
  const max = m[2] ?? m[1];
  const n = parseFloat(max);
  return Number.isFinite(n) ? n : undefined;
}

/** Split "BS, MSA, QR/1" into ["BS", "MSA", "QR/1"]. */
function parseDistributionCodes(s: string): string[] {
  return s
    .split(/[,;]/)
    .map((x) => clean(x))
    .filter((x) => x.length > 0);
}

/**
 * Parse a cg_results.aspx page into one entry per section.
 * Sections all sharing the same (subject, catalog) get deduplicated later
 * by groupSectionsToCourses().
 */
export function parseListingPage(html: string): ListingSection[] {
  const $ = load(html);
  const sections: ListingSection[] = [];

  $('.ClassRow').each((_, el) => {
    const $row = $(el);
    const detailUrl = $row.attr('data-url') ?? '';

    // Title area: <a>...<font>SUBJ CATALOG - TITLE</font></a>
    const titleFont = $row.find('a font').first().text();
    const titleText = clean(titleFont);
    // Match "MATH 115 - Calculus I" or "MATH 115 Calculus I" (with weird whitespace)
    const titleMatch = titleText.match(/^([A-Z][A-Z0-9]*)\s+(\S+)\s*-?\s*(.+)$/);
    if (!titleMatch) return;
    const [, subject, catalog, title] = titleMatch;

    // Section: "Section 001 (LEC)"
    let section = '';
    let credits = 0;
    let distributionCodes: string[] = [];

    $row.find('div.col-sm-3, div.col-sm-2, div.col-sm-1').each((_, col) => {
      const text = clean($(col).text());
      const secMatch = text.match(/Section\s+(\S+)/);
      if (secMatch) section = secMatch[1];
      const credMatch = text.match(/Credits:\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)/);
      if (credMatch) {
        const n = parseCredits(credMatch[1]);
        if (n !== undefined) credits = n;
      }
      const reqMatch = text.match(/Reqs:\s*(.+)$/);
      if (reqMatch) distributionCodes = parseDistributionCodes(reqMatch[1]);
    });

    sections.push({
      subject,
      catalog,
      section,
      title: clean(title),
      credits,
      distributionCodes,
      detailUrl,
    });
  });

  return sections;
}

/**
 * Group sections by (subject, catalog) and pick canonical values.
 * Different sections of the same course have identical subject/catalog/title/
 * credits/distributionCodes, so we use the first section as canonical.
 */
export interface GroupedCourse {
  subject: string;
  catalog: string;
  title: string;
  credits: number;
  distributionCodes: string[];
  /** Detail URL for the first observed section — used to fetch the detail page. */
  detailUrl: string;
  sectionCount: number;
}

export function groupSectionsToCourses(
  sections: ListingSection[],
): GroupedCourse[] {
  const byKey = new Map<string, GroupedCourse>();
  for (const s of sections) {
    const key = `${s.subject} ${s.catalog}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sectionCount += 1;
      continue;
    }
    byKey.set(key, {
      subject: s.subject,
      catalog: s.catalog,
      title: s.title,
      credits: s.credits,
      distributionCodes: s.distributionCodes,
      detailUrl: s.detailUrl,
      sectionCount: 1,
    });
  }
  return Array.from(byKey.values());
}

/**
 * Parse the LSA CG subject listing page (cg_subjectlist.aspx) into the set of
 * subject codes visible. Codes are extracted from `department=<CODE>` URL
 * parameters, which are the canonical identifiers used everywhere else.
 * Returns sorted, deduped, uppercase codes.
 */
export function parseSubjectList(html: string): string[] {
  const $ = load(html);
  const codes = new Set<string>();
  $('a[href*="department="]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = href.match(/[?&]department=([A-Z0-9]+)/);
    if (m) codes.add(m[1]);
  });
  return Array.from(codes).sort();
}

/** Parse a cg_detail.aspx page for the per-course fields the listing doesn't have. */
export function parseDetailPage(html: string): DetailFields {
  const $ = load(html);
  const out: DetailFields = {};

  // Every field lives inside a div.classdetailsrow as "Label: Value".
  $('.classdetailsrow').each((_, el) => {
    const text = clean($(el).text());
    // Take everything after the FIRST ": " as the value.
    const idx = text.indexOf(':');
    if (idx < 0) return;
    const label = clean(text.slice(0, idx));
    const value = clean(text.slice(idx + 1));

    switch (label) {
      case 'Credits': {
        const n = parseCredits(value);
        if (n !== undefined) out.credits = n;
        break;
      }
      case 'Requirements & Distribution':
        out.distributionCodes = parseDistributionCodes(value);
        break;
      case 'Advisory Prerequisites':
        out.advisoryPrereqs = value;
        break;
      case 'Enforced Prerequisites':
        out.enforcedPrereqs = value;
        break;
      case 'Credit Exclusions':
        out.creditExclusions = value;
        break;
      case 'Cross-Listed Classes':
      case 'Cross-Listed With':
        out.crossListed = value;
        break;
    }
  });

  // Description lives in the #ClassDescription tab, marked by
  // "Background and Goals:" or just body text after the header.
  const desc = $('#ClassDescription').text();
  if (desc) {
    const cleaned = clean(desc);
    // Strip the "Description" header prefix if present.
    out.description = cleaned.replace(/^Description\s*/, '');
  }

  return out;
}

/**
 * Combine a listing + a fetched detail into a Course. `prereqRaw` prefers the
 * enforced string over the advisory one (enforced is what actually blocks
 * registration).
 */
export function toCourse(group: GroupedCourse, detail: DetailFields): Course {
  const code = `${group.subject} ${group.catalog}`;
  // Prefer detail-page credits (may have finer precision) over listing.
  const credits = detail.credits ?? group.credits;
  const distributionCodes =
    detail.distributionCodes ?? group.distributionCodes;
  const prereqRaw = detail.enforcedPrereqs ?? detail.advisoryPrereqs;

  const tags = tagsFromDistribution(distributionCodes, group.subject, group.catalog);

  const course: Course = {
    code,
    title: group.title,
    credits,
    tags,
  };
  if (distributionCodes.length > 0) course.distributionCodes = distributionCodes;
  if (prereqRaw) course.prereqRaw = prereqRaw;
  if (detail.description) course.description = detail.description;
  return course;
}

export type TermKind = 'fall' | 'winter' | 'spring' | 'sprsum' | 'summer';

/**
 * Compute the LSA CG term id string for a given season + calendar year.
 * LSA numbers terms sequentially (+10 per term, 5 terms per academic year).
 * Anchor: Fall 2025 = code 2560.
 *
 * Examples:
 *   term('fall', 2026)   → { code: 'f_26_2610', label: 'Fall 2026' }
 *   term('winter', 2027) → { code: 'w_27_2620', label: 'Winter 2027' }
 */
export function term(
  kind: TermKind,
  calendarYear: number,
): { code: string; label: string } {
  const ANCHOR_FALL_YEAR = 2025;
  const ANCHOR_CODE = 2560;
  const kindOffsets: Record<TermKind, number> = {
    fall: 0,
    winter: 1,
    spring: 2,
    sprsum: 3,
    summer: 4,
  };
  const academicYearStart = kind === 'fall' ? calendarYear : calendarYear - 1;
  const termsFromAnchor =
    (academicYearStart - ANCHOR_FALL_YEAR) * 5 + kindOffsets[kind];
  const lsaCode = ANCHOR_CODE + termsFromAnchor * 10;
  const prefix: Record<TermKind, string> = {
    fall: 'f',
    winter: 'w',
    spring: 'sp',
    sprsum: 'ss',
    summer: 'su',
  };
  const label: Record<TermKind, string> = {
    fall: 'Fall',
    winter: 'Winter',
    spring: 'Spring',
    sprsum: 'Spring/Summer',
    summer: 'Summer',
  };
  const yy = String(calendarYear).slice(-2).padStart(2, '0');
  return {
    code: `${prefix[kind]}_${yy}_${lsaCode}`,
    label: `${label[kind]} ${calendarYear}`,
  };
}

/**
 * Map LSA distribution codes + course level to the tags already used by the
 * audit engine. This is the ONE place scraped data gets normalized to the
 * planner's vocabulary — keep the mapping tight.
 */
export function tagsFromDistribution(
  codes: string[],
  subject: string,
  catalog: string,
): string[] {
  const tags = new Set<string>();

  const catalogNum = parseInt(catalog, 10);
  if (Number.isFinite(catalogNum) && catalogNum >= 300) {
    tags.add('upper-level');
  }

  for (const code of codes) {
    switch (code) {
      case 'HU':
        tags.add('lsa-humanities');
        break;
      case 'SS':
        tags.add('lsa-social-sciences');
        break;
      case 'NS':
        tags.add('lsa-natural-sciences');
        break;
      case 'MSA':
        tags.add('lsa-math-symbolic');
        break;
      case 'CE':
        tags.add('lsa-creative-expression');
        break;
      case 'ID':
        tags.add('lsa-interdisciplinary');
        break;
      case 'RE':
      case 'R&E':
        tags.add('lsa-race-ethnicity');
        break;
      case 'FYWR':
        tags.add('lsa-fywr');
        break;
      case 'ULWR':
        tags.add('lsa-ulwr');
        break;
      case 'QR/1':
      case 'QR/2':
        tags.add('lsa-qr');
        break;
      case 'Lang':
      case 'Language':
        tags.add('lsa-language');
        break;
      case 'BS':
        // Counts toward the 60 math/science credits required for a BS degree.
        tags.add('lsa-bs');
        break;
      case 'Experiential':
      case 'EXP':
        tags.add('lsa-experiential');
        break;
    }
  }

  return Array.from(tags);
}
