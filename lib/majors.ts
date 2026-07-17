import type { Major } from './types';
import { all as bundledMajors } from '@/data/majors';

const BUNDLED: Record<string, Major> = Object.fromEntries(
  bundledMajors.map((m) => [m.id, m]),
);

export function listBundledMajors(): { id: string; name: string }[] {
  return bundledMajors
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadBundledMajor(id: string): Major | undefined {
  return BUNDLED[id];
}

export function parseUploadedMajor(json: string): Major {
  const parsed = JSON.parse(json);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.id !== 'string' ||
    typeof parsed.name !== 'string' ||
    typeof parsed.goalCredits !== 'number' ||
    !Array.isArray(parsed.requirements)
  ) {
    throw new Error('Invalid Major JSON: missing required fields.');
  }
  return parsed as Major;
}
