'use client';

import type { DegreeAudit, RequirementProgress } from '@/lib/audit';
import type { Course, Major, TakenCourse } from '@/lib/types';

interface DegreeLedgerProps {
  major: Major;
  audit: DegreeAudit;
  onRemove?: () => void;
  canRemove?: boolean;
}

export function DegreeLedger({ major, audit, onRemove, canRemove = true }: DegreeLedgerProps) {
  const buckets = groupRequirements(audit.requirements);
  const childIds = new Set<string>();
  for (const r of audit.requirements) {
    if (r.requirement.pickFromGroups) {
      for (const id of r.requirement.pickFromGroups) childIds.add(id);
    }
  }
  const countableReqs = audit.requirements.filter(
    (r) => !childIds.has(r.requirement.id),
  );
  const allRequirementsMet = countableReqs.every((r) => r.met);
  const isComplete = audit.overallMet;
  const requirementsOnlyComplete = allRequirementsMet && !isComplete;

  return (
    <section className="overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-surface">
      <header className="flex items-start justify-between gap-3 border-b-[1.5px] border-ink bg-paper px-5 py-4">
        <div>
          <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-blue">
            Major
          </div>
          <h2 className="display mt-1 text-[22px] font-bold leading-tight text-ink">
            {major.name}
          </h2>
          <div className="mt-0.5 text-[12px] text-ink-3">{major.school}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <div className="display text-[24px] font-bold leading-none tabular-nums text-ink">
              {countableReqs.filter((r) => r.met).length}
              <span className="text-[14px] text-ink-3"> / {countableReqs.length}</span>
            </div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Requirements met
            </div>
          </div>
          {isComplete && (
            <span className="rounded border-[1.5px] border-ink bg-success px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
              Complete
            </span>
          )}
          {requirementsOnlyComplete && (
            <span
              className="rounded border-[1.5px] border-ink bg-maize px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue"
              title={`All requirements met. Still short ${audit.credits.remainingCredits} credit${audit.credits.remainingCredits === 1 ? '' : 's'} of the ${audit.credits.goalCredits}-credit total.`}
            >
              Reqs met · {audit.credits.remainingCredits} cr short
            </span>
          )}
          {onRemove && canRemove && (
            <button
              onClick={() => onRemove()}
              className="rounded-md border-[1.5px] border-ink px-2 py-1 text-[11px] font-semibold text-ink hover:bg-danger hover:text-white"
            >
              Remove
            </button>
          )}
        </div>
      </header>

      <div className="divide-y-[1.5px] divide-ink">
        {buckets.map((bucket) => (
          <div key={bucket.title} className="px-5 py-4">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-blue">
              {bucket.title}
            </h3>
            <ul className="space-y-2">
              {bucket.items.map((r) => (
                <li key={r.requirement.id}>
                  <RequirementRow progress={r} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RequirementRow({ progress }: { progress: RequirementProgress }) {
  const { requirement: req, taken, planned, met, takenContributors, plannedContributors, satisfiedByParent } = progress;
  const isCreditBucket = req.countMode === 'credits';
  const isMultiCount = req.countMode === 'count' && req.need > 1;
  const optional = !!satisfiedByParent;

  if (!isCreditBucket && req.need === 1) {
    return (
      <div
        className={`flex items-start gap-3 rounded-md border-[1.5px] px-3 py-2 ${
          met
            ? 'border-ink bg-success-tint'
            : 'border-line bg-paper'
        } ${optional ? 'opacity-60' : ''}`}
      >
        <span
          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border-[1.5px] border-ink text-[13px] font-bold ${
            met ? 'bg-maize text-blue' : 'bg-surface text-ink-4'
          }`}
          aria-hidden
        >
          {met ? '✓' : ''}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">{req.label}</div>
          {req.hint && (
            <div className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{req.hint}</div>
          )}
          {optional && (
            <div className="mt-1 text-[11px] italic text-ink-3">
              Not required. Parent group already satisfied.
            </div>
          )}
          {!met && !optional && planned > 0 && (
            <div className="mt-1 text-[11px] font-medium text-warn">
              Planned. Pending term completion.
            </div>
          )}
          <Contributors taken={takenContributors} planned={plannedContributors} />
        </div>
      </div>
    );
  }

  const total = taken + planned;
  const takenPct = Math.min(100, (taken / req.need) * 100);
  const plannedPct = Math.min(100 - takenPct, (planned / req.need) * 100);
  const unit = isCreditBucket ? ' cr' : '';

  return (
    <div
      className={`rounded-md border-[1.5px] px-3 py-2.5 ${
        met ? 'border-ink bg-success-tint' : 'border-line bg-paper'
      } ${optional ? 'opacity-60' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink">
            {req.label}
          </div>
          {req.hint && (
            <div className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{req.hint}</div>
          )}
          {optional && (
            <div className="mt-0.5 text-[11px] italic text-ink-3">
              Not required. Parent group already satisfied.
            </div>
          )}
        </div>
        <div className="display shrink-0 text-[16px] font-bold leading-none tabular-nums text-ink">
          {total}
          <span className="text-[11px] font-medium text-ink-3">
            {' '}
            / {req.need}
            {unit}
          </span>
        </div>
      </div>
      <div className="mt-2 h-[6px] w-full overflow-hidden border-[1.5px] border-ink bg-surface">
        <div className="flex h-full">
          <div
            className={met ? 'bg-success' : 'bg-blue'}
            style={{ width: `${takenPct}%` }}
          />
          <div
            className={met ? 'bg-success/50' : 'bg-maize'}
            style={{ width: `${plannedPct}%` }}
          />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
        <span>
          {taken}
          {unit} taken · {planned}
          {unit} planned
        </span>
        {!met && (
          <span className="font-medium">
            {req.need - total > 0 ? `${req.need - total}${unit} to go` : 'Pending'}
          </span>
        )}
        {met && <span className="font-bold text-success">Met</span>}
      </div>
      <Contributors taken={takenContributors} planned={plannedContributors} />
      {isMultiCount && req.matchCodes && (
        <div className="mono mt-1 text-[10px] text-ink-4">
          From: {req.matchCodes.join(', ')}
        </div>
      )}
    </div>
  );
}

function Contributors({
  taken,
  planned,
}: {
  taken: TakenCourse[];
  planned: Course[];
}) {
  const total = taken.length + planned.length;
  if (total === 0) return null;
  return (
    <details className="group mt-1.5">
      <summary className="cursor-pointer list-none select-none text-[11px] font-medium text-ink-3 hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
        {total === 1 ? '1 contributing course' : `${total} contributing courses`}
      </summary>
      <ul className="mono mt-1 space-y-0.5 pl-3">
        {taken.map((c) => (
          <li key={`t-${c.code}`} className="text-[11px] leading-snug text-ink-2">
            <span className="font-bold">{c.code}</span>
            <span className="text-ink-3"> · {c.title}</span>
            <span className="text-ink-4"> · {c.credits} cr · {c.grade}</span>
          </li>
        ))}
        {planned.map((c) => (
          <li key={`p-${c.code}`} className="text-[11px] leading-snug text-warn">
            <span className="font-bold">{c.code}</span>
            <span className="text-warn/70"> · {c.title}</span>
            <span className="text-warn/60"> · {c.credits} cr · planned</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

interface Bucket {
  title: string;
  items: RequirementProgress[];
}

const CATEGORY_ORDER = [
  // Major-specific first: prereqs → core → everything else major-owned
  'prerequisites',
  'core',
  'capstone',
  'ux-pathway',
  'electives',
  'major-credit-min',
  'credit-minimums',
  'cs-major-credits',
  'other',
  // LSA rules last, in the order the student encounters them
  'lsa-college-wide',
  'lsa-distribution',
  'lsa-add-distribution',
  'lsa-credit-min',
];

const CATEGORY_TITLES: Record<string, string> = {
  prerequisites: 'Prerequisites',
  core: 'Core',
  capstone: 'Capstone',
  'ux-pathway': 'UX pathway',
  electives: 'Electives',
  'major-credit-min': 'Major credit total',
  'credit-minimums': 'Credit minimums',
  'cs-major-credits': 'Upper-level major credits',
  other: 'Other requirements',
  'lsa-college-wide': 'LSA college-wide requirements',
  'lsa-distribution': 'LSA area distribution',
  'lsa-add-distribution': 'LSA additional distribution',
  'lsa-credit-min': 'LSA credit requirements',
};

function categoryTitle(key: string): string {
  if (CATEGORY_TITLES[key]) return CATEGORY_TITLES[key];
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function groupRequirements(reqs: RequirementProgress[]): Bucket[] {
  const byCategory = new Map<string, RequirementProgress[]>();
  for (const r of reqs) {
    const cat = r.requirement.category ?? 'other';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(r);
  }
  const sortedKeys = Array.from(byCategory.keys()).sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return sortedKeys.map((k) => ({
    title: categoryTitle(k),
    items: byCategory.get(k)!,
  }));
}
