import type { Major } from './types';

/**
 * Canonical list of U-M undergraduate-degree-granting schools/colleges.
 * Used by the home page picker to bucket majors by school so a student can
 * pick "LSA CS" vs "Engineering CS" without confusion.
 *
 * `matcher` runs against `Major.school` text to decide bucket membership.
 * Loose keyword regexes on purpose: bundled major JSON files use varying
 * strings for the same school.
 */
export interface School {
  id: string;
  /** Short label for cards + chips. */
  short: string;
  /** Longer descriptive name. */
  full: string;
  /** True when a given major.school string belongs to this school. */
  matcher: (schoolText: string) => boolean;
}

export const SCHOOLS: School[] = [
  {
    id: 'lsa',
    short: 'LSA',
    full: 'College of Literature, Science, and the Arts',
    matcher: (s) => /(lsa|literature.*science)/i.test(s),
  },
  {
    id: 'coe',
    short: 'Engineering',
    full: 'College of Engineering',
    matcher: (s) => /(college of engineering|\bcoe\b)/i.test(s) && !/lsa/i.test(s),
  },
  {
    id: 'ross',
    short: 'Ross',
    full: 'Ross School of Business',
    matcher: (s) => /ross/i.test(s),
  },
  {
    id: 'umsi',
    short: 'School of Information',
    full: 'School of Information',
    matcher: (s) => /school of information|umsi/i.test(s),
  },
  {
    id: 'smtd',
    short: 'SMTD',
    full: 'School of Music, Theatre & Dance',
    matcher: (s) => /(music.*theatre|smtd|school of music)/i.test(s),
  },
  {
    id: 'nursing',
    short: 'Nursing',
    full: 'School of Nursing',
    matcher: (s) => /school of nursing/i.test(s),
  },
  {
    id: 'kines',
    short: 'Kinesiology',
    full: 'School of Kinesiology',
    matcher: (s) => /kinesiology/i.test(s),
  },
  {
    id: 'seas',
    short: 'SEAS',
    full: 'School for Environment & Sustainability',
    matcher: (s) => /(environment.*sustainability|\bseas\b)/i.test(s),
  },
  {
    id: 'sph',
    short: 'Public Health',
    full: 'School of Public Health',
    matcher: (s) => /public health/i.test(s),
  },
  {
    id: 'stamps',
    short: 'Stamps',
    full: 'Stamps School of Art & Design',
    matcher: (s) => /(stamps|art.*design)/i.test(s),
  },
  {
    id: 'taubman',
    short: 'Taubman',
    full: 'Taubman College of Architecture',
    matcher: (s) => /(taubman|architecture)/i.test(s),
  },
];

/** Return the canonical school for a major, or undefined if none matched. */
export function schoolForMajor(major: Pick<Major, 'school'>): School | undefined {
  return SCHOOLS.find((s) => s.matcher(major.school));
}

/** Return the canonical school by id. */
export function schoolById(id: string): School | undefined {
  return SCHOOLS.find((s) => s.id === id);
}
