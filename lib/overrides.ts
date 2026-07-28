import type { RequirementOverride } from './types';

/**
 * Pure list operations for requirement overrides. The invariant maintained
 * here: at most one override per (credentialId, requirementId, courseCode).
 * Kept out of the React state layer so the semantics are unit-testable.
 */

export function overrideKey(o: {
  credentialId: string;
  requirementId: string;
  courseCode: string;
}): string {
  return `${o.credentialId}::${o.requirementId}::${o.courseCode}`;
}

/** Add an override, replacing any existing one for the same course+requirement. */
export function upsertOverride(
  list: RequirementOverride[],
  override: RequirementOverride,
): RequirementOverride[] {
  const key = overrideKey(override);
  return [...list.filter((o) => overrideKey(o) !== key), override];
}

/** Remove the override for a course+requirement, if any. */
export function removeOverride(
  list: RequirementOverride[],
  key: { credentialId: string; requirementId: string; courseCode: string },
): RequirementOverride[] {
  const k = overrideKey(key);
  return list.filter((o) => overrideKey(o) !== k);
}

/** Overrides that apply to one credential (major or minor). */
export function overridesForCredential(
  list: RequirementOverride[] | undefined,
  credentialId: string,
): RequirementOverride[] {
  return (list ?? []).filter((o) => o.credentialId === credentialId);
}

/**
 * Per-requirement include/exclude code sets, precomputed for the audit loop.
 */
export interface OverrideSets {
  include: Set<string>;
  exclude: Set<string>;
}

export function overrideSetsByRequirement(
  overrides: RequirementOverride[],
): Map<string, OverrideSets> {
  const out = new Map<string, OverrideSets>();
  for (const o of overrides) {
    let sets = out.get(o.requirementId);
    if (!sets) {
      sets = { include: new Set(), exclude: new Set() };
      out.set(o.requirementId, sets);
    }
    sets[o.action === 'include' ? 'include' : 'exclude'].add(o.courseCode);
  }
  return out;
}
