'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { auditDegree, projectGraduation } from '@/lib/audit';
import { courseCatalog } from '@/lib/data';
import { listBundledMajors, loadBundledMajor } from '@/lib/majors';
import { useMajorPlans, useTranscript } from '@/lib/state';
import type { Major, Profile } from '@/lib/types';
import { SchoolFirstPicker, type PickerItem } from '../SchoolFirstPicker';

function joinMajorNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function PlansAndPicker() {
  const { transcript } = useTranscript();
  const { plans, addPlanForMajor, removePlan, toggleStar, isStarred } = useMajorPlans();
  const [pickerOpen, setPickerOpen] = useState(false);

  const pickerItems: PickerItem[] = useMemo(
    () =>
      listBundledMajors().map((m) => {
        const full = loadBundledMajor(m.id)!;
        return { id: m.id, name: m.name, schoolText: full.school };
      }),
    [],
  );

  const usedAsPrimary = useMemo(() => new Set(Object.keys(plans)), [plans]);

  const savedPlanEntries = useMemo(() => {
    return Object.keys(plans)
      .map((id) => {
        const plan = plans[id];
        const majorIds = [id, ...(plan.additionalMajorIds ?? [])];
        const majors = majorIds
          .map((mid) => loadBundledMajor(mid))
          .filter((m): m is Major => !!m);
        if (majors.length === 0) return null;
        const profile: Profile = {
          takenCourses: transcript.takenCourses,
          plannedTerms: plan.plannedTerms,
          majorId: id,
          majorIds,
          minorIds: plan.minorIds,
          startYear: transcript.startYear,
          gradYear: plan.gradYear,
        };
        const audits = majors.map((m) => ({
          major: m,
          audit: auditDegree(profile, m, courseCatalog),
        }));
        const primary = audits[0];
        const projection = projectGraduation(profile, primary.major, courseCatalog);
        return { id, majors, primary, audits, projection, starred: isStarred(id) };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        if (a.starred === b.starred) return 0;
        return a.starred ? -1 : 1;
      });
  }, [plans, transcript.takenCourses, transcript.startYear, isStarred]);

  const hasPlans = savedPlanEntries.length > 0;

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="display text-[28px] font-bold leading-none tracking-[-0.01em] text-ink">
            {hasPlans ? 'Your plans' : 'Get started'}
          </h2>
          <div className="mt-1.5 text-[13px] text-ink-3">
            {hasPlans
              ? `${savedPlanEntries.length} saved · try a different major any time`
              : 'Pick a major to start planning. You can try a different one anytime.'}
          </div>
        </div>
        {hasPlans && !pickerOpen && (
          <button
            onClick={() => setPickerOpen(true)}
            className="btn-primary display text-[13px]"
          >
            + New plan
          </button>
        )}
      </div>

      {hasPlans && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {savedPlanEntries.map(({ id, majors, primary, projection, starred }, i) => {
            const totalCredits =
              primary.audit.credits.takenCredits + primary.audit.credits.plannedCredits;
            const pct = Math.min(
              100,
              Math.round((totalCredits / primary.audit.credits.goalCredits) * 100),
            );
            const unmet = primary.audit.requirements.filter(
              (r) => !r.met && !r.satisfiedByParent,
            ).length;
            const title = joinMajorNames(majors.map((m) => m.name));
            const schools = Array.from(new Set(majors.map((m) => m.school)));
            const featured = starred && i === 0;

            return (
              <Link
                key={id}
                href={`/plan/${id}`}
                aria-label={`Open ${title}`}
                className={`group relative flex flex-col overflow-hidden rounded-[10px] border-[1.5px] transition duration-150 ease-out ${
                  starred
                    ? 'border-ink bg-maize-tint hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_0_var(--blue)]'
                    : 'border-ink bg-surface hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_0_var(--blue)]'
                } ${featured ? 'sm:col-span-2 lg:col-span-2' : ''}`}
              >
                {starred && (
                  <div className="absolute right-0 top-0 z-10 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px] border-ink bg-maize px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue">
                    ★ Starred
                  </div>
                )}

                <div className="flex-1 p-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                    {schools.join(' · ')}
                  </div>
                  <div className={`display mt-2 font-bold leading-tight tracking-[-0.01em] text-ink ${featured ? 'text-[26px]' : 'text-[20px]'}`}>
                    {title}
                  </div>

                  <div className={`mt-6 grid ${featured ? 'grid-cols-3' : 'grid-cols-1'} gap-4`}>
                    <div>
                      <div className="display text-[44px] font-bold leading-none tabular-nums text-ink">
                        {pct}
                        <span className="text-[24px] text-ink-3">%</span>
                      </div>
                      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                        Complete
                      </div>
                    </div>
                    {featured && (
                      <>
                        <div>
                          <div className="display text-[28px] font-bold leading-none tabular-nums text-ink">
                            {totalCredits}
                            <span className="text-[16px] text-ink-3"> / {primary.audit.credits.goalCredits}</span>
                          </div>
                          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                            Credits
                          </div>
                        </div>
                        <div>
                          {projection.status === 'projected' ? (
                            <>
                              <div className="display text-[22px] font-bold leading-none tabular-nums text-ink">
                                {projection.term.name}
                              </div>
                              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                                Graduates
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="display text-[22px] font-bold leading-none tabular-nums text-warn">
                                {unmet}
                              </div>
                              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">
                                Reqs unmet
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* progress bar */}
                  <div className="mt-5">
                    <div className="h-[7px] w-full overflow-hidden border-[1.5px] border-ink bg-paper">
                      <div className="h-full bg-blue" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t-[1.5px] border-ink bg-surface px-5 py-2.5 text-[12px]">
                  {featured ? (
                    <div className="text-ink-3">Tap to open plan</div>
                  ) : (
                    <div className="min-w-0 truncate text-ink-3">
                      {projection.status === 'projected' ? (
                        <>
                          Grads <span className="font-semibold text-ink">{projection.term.name}</span>
                        </>
                      ) : (
                        <span className="font-semibold text-warn">
                          {unmet} req{unmet === 1 ? '' : 's'} unmet
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleStar(id);
                      }}
                      aria-label={starred ? 'Unstar plan' : 'Star plan'}
                      className={`rounded p-1 transition ${
                        starred
                          ? 'text-maize-deep hover:text-blue'
                          : 'text-ink-4 hover:text-blue'
                      }`}
                    >
                      <StarIcon filled={starred} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removePlan(id);
                      }}
                      aria-label="Delete plan"
                      className="rounded p-1 text-ink-4 hover:bg-danger/10 hover:text-danger"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-1 0v14a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V6h6z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {(pickerOpen || !hasPlans) && (
        <div
          className={
            hasPlans
              ? 'mt-6 rounded-[10px] border-[1.5px] border-ink bg-surface p-5'
              : 'rounded-[10px] border-[1.5px] border-ink bg-surface p-5 brand-shadow-lg'
          }
        >
          <SchoolFirstPicker
            kind="major"
            items={pickerItems}
            excludeIds={usedAsPrimary}
            onCancel={hasPlans ? () => setPickerOpen(false) : undefined}
            onPick={(id) => {
              addPlanForMajor(id);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
    </section>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
