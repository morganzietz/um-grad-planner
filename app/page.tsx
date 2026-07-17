'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAppState, useMajorPlans, useTranscript } from '@/lib/state';
import { loadBundledMajor, listBundledMajors } from '@/lib/majors';
import { minors as minorLibrary, courseCatalog } from '@/lib/data';
import { SCHOOLS } from '@/lib/schools';
import { TranscriptSection } from './sections/home/TranscriptSection';
import { PlansAndPicker } from './sections/home/PlansAndPicker';

export default function Home() {
  const { resetToSeed } = useAppState();
  const { plans, starredPlanIds } = useMajorPlans();
  const { transcript } = useTranscript();

  const stats = useMemo(
    () => ({
      schools: SCHOOLS.length,
      programs: listBundledMajors().length + minorLibrary.length,
      courses: courseCatalog.length,
    }),
    [],
  );

  const starredPlan = useMemo(() => {
    const id = starredPlanIds[0];
    if (!id) return null;
    const major = loadBundledMajor(id);
    if (!major) return null;
    return { id, major };
  }, [starredPlanIds]);

  // "Leading" plan: first starred plan that still resolves, else the first
  // saved plan whose major still resolves. Drives the "expected grad" stat.
  const leadingPlan = useMemo(() => {
    const starredMatch = starredPlanIds.find(
      (sid) => plans[sid] && loadBundledMajor(sid),
    );
    const fallbackId = starredMatch
      ? null
      : Object.keys(plans).find((k) => loadBundledMajor(k));
    const id = starredMatch ?? fallbackId ?? null;
    if (!id) return null;
    const major = loadBundledMajor(id)!;
    return {
      id,
      major,
      plan: plans[id],
      isStarred: !!starredMatch,
    };
  }, [starredPlanIds, plans]);

  // If the leading plan set an explicit gradYear, use it. Otherwise assume the
  // typical 4-year track from the transcript start year. Null means we can't
  // guess yet (no plan, no transcript start).
  const expectedGradYear = useMemo(() => {
    const explicit = leadingPlan?.plan.gradYear;
    if (typeof explicit === 'number') return explicit;
    const start = transcript.startYear;
    if (typeof start === 'number') return start + 4;
    return null;
  }, [leadingPlan, transcript.startYear]);

  const totalCreditsFromTranscript = transcript.takenCourses.reduce(
    (s, c) => s + c.credits,
    0,
  );

  // Only count plans whose primary major still resolves. Matches PlansAndPicker's
  // card list so the stat and the visible cards can't disagree.
  const resolvablePlanCount = useMemo(
    () =>
      Object.keys(plans).filter((id) => loadBundledMajor(id) !== undefined).length,
    [plans],
  );

  const hasAnyContext = resolvablePlanCount > 0 || transcript.takenCourses.length > 0;

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md border-[1.5px] border-ink bg-blue text-maize display text-[18px] font-bold leading-none brand-shadow">
              M
            </div>
            <div className="flex flex-col leading-tight">
              <div className="display text-[15px] font-bold text-ink">Grad Planner</div>
              <div className="text-[11px] font-medium text-ink-3">University of Michigan</div>
            </div>
          </div>
          <button
            onClick={() => resetToSeed()}
            className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-ink hover:text-maize"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Hero bento */}
      <section className="border-b-2 border-ink">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-14 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="eyebrow text-[12px] font-semibold uppercase tracking-[0.14em] text-blue">
              4 years, more or less
            </div>
            <h1 className="display mt-3 text-[52px] font-bold leading-[0.98] tracking-[-0.02em] text-ink sm:text-[64px]">
              Michigan degree,
              <br />
              <span className="marker italic">your call.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ink-2">
              Pick any major. Map out your semesters. See exactly what&apos;s left.
              Try a different major and your progress rides along.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#plans" className="btn-primary display text-[15px]">
                {starredPlan ? 'Open your plan' : 'Pick a major'}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
              {!hasAnyContext && (
                <a href="#transcript" className="btn-ghost text-[13px]">
                  Have credits already? Import transcript
                </a>
              )}
            </div>
          </div>

          {/* Right: signature bento tile */}
          <div className="lg:col-span-1">
            {starredPlan ? (
              <Link
                href={`/plan/${starredPlan.id}`}
                className="group relative flex h-full flex-col overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-[#00274C] p-5 text-white transition duration-150 ease-out hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_0_var(--ink)]"
              >
                <div className="absolute -right-8 -top-8 h-32 w-32 rotate-12 bg-maize/20" />
                <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.15em] text-maize">
                  ★ Your starred plan
                </div>
                <div className="display mt-2 text-[22px] font-bold leading-tight text-white">
                  {starredPlan.major.name}
                </div>
                <div className="mt-1 text-[12px] text-white/70">
                  {starredPlan.major.school}
                </div>
                <div className="mt-auto pt-6">
                  <div className="inline-flex items-center gap-2 border-b-2 border-maize pb-0.5 text-[13px] font-semibold text-maize group-hover:gap-3">
                    Resume
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </div>
                </div>
              </Link>
            ) : (
              <div className="relative flex h-full flex-col justify-between rounded-[10px] border-[1.5px] border-ink bg-[#00274C] p-5 text-white">
                <div className="absolute -right-6 -top-6 h-28 w-28 rotate-12 bg-maize/15" />
                <div>
                  <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.15em] text-maize">
                    The whole catalog, bundled
                  </div>
                  <div className="display mt-2 text-[15px] font-medium leading-snug text-white/85">
                    Every U-M program you can pick from, ready right now.
                  </div>
                  <div className="mt-4 space-y-2">
                    <StatLine value={stats.schools} label="schools & colleges" />
                    <StatLine value={stats.programs} label="majors & minors" />
                    <StatLine value={stats.courses.toLocaleString()} label="courses to search" />
                  </div>
                </div>
                <div className="mt-4 border-t border-white/15 pt-3 text-[11px] leading-snug text-white/60">
                  Pick any. Swap any time. Runs in your browser.
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Live stat band (only when user has context) */}
      {hasAnyContext && (
        <section className="border-b-2 border-ink bg-blue text-white">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-0 px-6 md:grid-cols-4">
            <BandStat value={resolvablePlanCount} label="plans" />
            <BandStat value={transcript.takenCourses.length} label="courses taken" />
            <BandStat value={totalCreditsFromTranscript} label="credits earned" />
            <BandStat
              value={expectedGradYear ?? '—'}
              label="expected grad"
            />
          </div>
        </section>
      )}

      <main className="mx-auto max-w-6xl space-y-16 px-6 py-14">
        <section id="transcript" className="scroll-mt-24">
          <TranscriptSection />
        </section>
        <section id="plans" className="scroll-mt-24">
          <PlansAndPicker />
        </section>

        <footer className="border-t-2 border-ink pt-4 text-center text-[11px] text-ink-3">
          Local data. Lives in your browser. Not affiliated with the University of Michigan.
        </footer>
      </main>
    </div>
  );
}

function StatLine({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="display text-[28px] font-bold leading-none tabular-nums text-maize">
        {value}
      </span>
      <span className="text-[13px] font-medium text-white/80">{label}</span>
    </div>
  );
}

function BandStat({
  value,
  label,
  caption,
}: {
  value: number | string;
  label: string;
  caption?: string;
}) {
  return (
    <div className="border-r border-white/15 px-5 py-5 last:border-r-0 md:py-6">
      <div className="display text-[32px] font-bold leading-none tabular-nums text-maize md:text-[36px]">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">
        {label}
      </div>
      {caption && (
        <div className="mt-0.5 truncate text-[10px] font-medium text-white/50">
          {caption}
        </div>
      )}
    </div>
  );
}
