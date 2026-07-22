'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auditDegree, checkMinors, countableProgress, projectGraduation } from '@/lib/audit';
import { courseCatalog, minors as minorLibrary } from '@/lib/data';
import { listBundledMajors, loadBundledMajor } from '@/lib/majors';
import { useAppState, useMajorPlans, usePlannerState } from '@/lib/state';
import type { Major, Minor } from '@/lib/types';
import { DegreeLedger } from '../../sections/DegreeLedger';
import { TermPlanner } from '../../sections/TermPlanner';
import { CourseLibrary } from '../../sections/CourseLibrary';
import { MinorCard } from '../../sections/MinorCard';
import { SchoolFirstPicker, type PickerItem } from '../../sections/SchoolFirstPicker';

type Tab = 'terms' | 'requirements' | 'library';

export default function PlanPage({
  params,
}: {
  params: Promise<{ majorId: string }>;
}) {
  const { majorId } = use(params);
  const router = useRouter();
  const { plans } = useMajorPlans();
  const { setState, resetToSeed } = useAppState();
  const {
    profile,
    hydrated,
    addCourseToTerm,
    removeCourseFromTerm,
    addExtraTerm,
    removeTerm,
    setStartYear,
    setGradYear,
    addMinor,
    removeMinor,
    addMajorToPlan,
    removeMajorFromPlan,
  } = usePlannerState(majorId);

  const everSawPlan = useRef(false);
  useEffect(() => {
    if (!hydrated) return;
    if (plans[majorId]) {
      everSawPlan.current = true;
      return;
    }
    if (!everSawPlan.current) router.replace('/');
  }, [hydrated, majorId, plans, router]);

  const trackedMajors = useMemo(
    () =>
      (profile.majorIds ?? [profile.majorId])
        .map((id) => loadBundledMajor(id))
        .filter((m): m is Major => !!m),
    [profile.majorIds, profile.majorId],
  );

  const trackedMinors = useMemo(
    () =>
      (profile.minorIds ?? [])
        .map((id) => minorLibrary.find((m) => m.id === id))
        .filter((m): m is Minor => !!m),
    [profile.minorIds],
  );

  const majorAudits = useMemo(
    () =>
      trackedMajors.map((m) => ({
        major: m,
        audit: auditDegree(profile, m, courseCatalog),
      })),
    [profile, trackedMajors],
  );

  const primary = majorAudits[0];
  const projection = useMemo(
    () =>
      primary ? projectGraduation(profile, primary.major, courseCatalog) : null,
    [primary, profile],
  );

  const minorProgress = useMemo(
    () => checkMinors(profile, trackedMinors, courseCatalog),
    [profile, trackedMinors],
  );

  const trackedMajorIds = useMemo(
    () => new Set(profile.majorIds ?? [profile.majorId]),
    [profile.majorIds, profile.majorId],
  );
  const trackedMinorIds = useMemo(
    () => new Set(profile.minorIds ?? []),
    [profile.minorIds],
  );

  const majorPickerItems: PickerItem[] = useMemo(
    () =>
      listBundledMajors()
        .map((m) => {
          const full = loadBundledMajor(m.id)!;
          return { id: m.id, name: m.name, schoolText: full.school };
        }),
    [],
  );

  const minorPickerItems: PickerItem[] = useMemo(
    () => minorLibrary.map((m) => ({ id: m.id, name: m.name, schoolText: m.school })),
    [],
  );

  const [pickerKind, setPickerKind] = useState<'major' | 'minor' | null>(null);
  const [tab, setTab] = useState<Tab>('terms');

  const handleRemoveMajor = (major: Major) => {
    if (major.id !== majorId) {
      removeMajorFromPlan(major.id);
      return;
    }
    let nextPlanId: string | null = null;
    let didAnything = false;
    setState((s) => {
      const plan = s.majorPlans[majorId];
      if (!plan) return s;
      didAnything = true;
      const additional = plan.additionalMajorIds ?? [];
      if (additional.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [majorId]: _dropped, ...rest } = s.majorPlans;
        return {
          ...s,
          majorPlans: rest,
          starredPlanIds: s.starredPlanIds.filter((id) => id !== majorId),
        };
      }
      const newPrimary = additional[0];
      nextPlanId = newPrimary;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [majorId]: _dropped, ...rest } = s.majorPlans;
      return {
        ...s,
        majorPlans: {
          ...rest,
          [newPrimary]: {
            ...plan,
            additionalMajorIds: additional.filter((id) => id !== newPrimary),
          },
        },
        starredPlanIds: s.starredPlanIds.map((id) =>
          id === majorId ? newPrimary : id,
        ),
      };
    });
    if (!didAnything) return;
    if (nextPlanId) {
      router.replace(`/plan/${nextPlanId}`);
    } else {
      router.push('/');
    }
  };

  if (!primary) {
    return (
      <div className="min-h-screen bg-paper text-ink">
        <main className="mx-auto max-w-2xl space-y-4 px-6 py-16 text-center">
          <div className="display text-[22px] font-bold text-ink">
            Unknown major
          </div>
          <div className="mono text-[13px] text-ink-3">{majorId}</div>
          <Link href="/" className="btn-primary text-[13px]">
            Back home
          </Link>
        </main>
      </div>
    );
  }

  const { takenCredits, plannedCredits, goalCredits, remainingCredits } =
    primary.audit.credits;
  const totalCredits = takenCredits + plannedCredits;
  const takenPct = Math.min(100, (takenCredits / goalCredits) * 100);
  const plannedPct = Math.min(100 - takenPct, (plannedCredits / goalCredits) * 100);

  const countableReqs = countableProgress(primary.audit.requirements);
  const reqsMet = countableReqs.filter((r) => r.met).length;
  const reqsTotal = countableReqs.length;

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Top bar (same voice as home) */}
      <header className="sticky top-0 z-30 border-b-2 border-ink bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-md border-[1.5px] border-ink bg-blue text-maize display text-[18px] font-bold leading-none brand-shadow">
              M
            </div>
            <div className="flex flex-col leading-tight">
              <div className="display text-[15px] font-bold text-ink">Grad Planner</div>
              <div className="text-[11px] font-medium text-ink-3">← All plans</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPickerKind(pickerKind === 'major' ? null : 'major')}
              className={`rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold transition ${
                pickerKind === 'major'
                  ? 'bg-ink text-maize'
                  : 'text-ink hover:bg-ink hover:text-maize'
              }`}
            >
              + Major
            </button>
            <button
              onClick={() => setPickerKind(pickerKind === 'minor' ? null : 'minor')}
              className={`rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold transition ${
                pickerKind === 'minor'
                  ? 'bg-ink text-maize'
                  : 'text-ink hover:bg-ink hover:text-maize'
              }`}
            >
              + Minor
            </button>
            <button
              onClick={() => resetToSeed()}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-ink hover:text-maize"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      {pickerKind && (
        <div className="border-b-2 border-ink bg-surface-2">
          <div className="mx-auto max-w-7xl px-6 py-5">
            <SchoolFirstPicker
              kind={pickerKind}
              items={pickerKind === 'major' ? majorPickerItems : minorPickerItems}
              excludeIds={pickerKind === 'major' ? trackedMajorIds : trackedMinorIds}
              onCancel={() => setPickerKind(null)}
              onPick={(id) => {
                if (pickerKind === 'major') addMajorToPlan(id);
                else addMinor(id);
                setPickerKind(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Plan title bento */}
      <section className="border-b-2 border-ink">
        <div className="mx-auto max-w-7xl px-6 pb-8 pt-10">
          <div className="eyebrow text-[12px] font-semibold uppercase tracking-[0.14em] text-blue">
            Your plan
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            {trackedMajors.map((m, i) => (
              <div key={m.id} className="flex items-baseline gap-2">
                {i > 0 && (
                  <span className="display text-[22px] font-bold text-ink-3">+</span>
                )}
                <h1 className="display text-[38px] font-bold leading-[0.98] tracking-[-0.02em] text-ink sm:text-[46px]">
                  {m.name}
                </h1>
                {i > 0 && (
                  <button
                    onClick={() => removeMajorFromPlan(m.id)}
                    className="text-[11px] text-ink-4 hover:text-danger"
                    title="Remove from this plan"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[13px] text-ink-3">
            {Array.from(new Set(trackedMajors.map((m) => m.school))).join(' · ')}
          </div>
        </div>
      </section>

      {/* Projection bento row */}
      <section className="border-b-2 border-ink">
        <div className="mx-auto grid max-w-7xl gap-0 px-0 md:grid-cols-3">
          {/* Grad term tile (navy signature) */}
          <div className="relative overflow-hidden border-b-2 border-ink bg-blue px-6 py-6 text-white md:border-b-0 md:border-r-2">
            <div className="absolute -right-6 -top-6 h-24 w-24 rotate-12 bg-maize/15" />
            <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-maize">
              Graduation
            </div>
            {projection && projection.status === 'projected' ? (
              <>
                <div className="display mt-1 text-[42px] font-bold leading-[1] text-white">
                  {projection.term.name}
                </div>
                <div className="mt-2 text-[12px] text-white/70">
                  All requirements satisfied on plan.
                </div>
              </>
            ) : (
              <>
                <div className="display mt-1 text-[42px] font-bold leading-[1] text-white">
                  Not yet
                </div>
                <div className="mt-2 text-[12px] text-white/70">
                  {projection?.missingRequirements.length ?? 0} req
                  {(projection?.missingRequirements.length ?? 0) === 1 ? '' : 's'} unmet
                  {projection && projection.missingCredits > 0 && (
                    <> · {projection.missingCredits} cr short of {goalCredits}</>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Credits tile */}
          <div className="border-b-2 border-ink bg-paper px-6 py-6 md:border-b-0 md:border-r-2">
            <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-blue">
              Credits
            </div>
            <div className="display mt-1 flex items-baseline gap-1.5 text-[42px] font-bold leading-[1] text-ink">
              <span className="tabular-nums">{totalCredits}</span>
              <span className="text-[22px] text-ink-3">/ {goalCredits}</span>
            </div>
            <div className="mt-3 h-[7px] w-full overflow-hidden border-[1.5px] border-ink bg-surface">
              <div className="flex h-full">
                <div
                  className="h-full bg-blue"
                  style={{ width: `${takenPct}%` }}
                  title={`${takenCredits} taken`}
                />
                <div
                  className="h-full bg-maize"
                  style={{ width: `${plannedPct}%` }}
                  title={`${plannedCredits} planned`}
                />
              </div>
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-ink-3">
              <span>
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue" />
                {takenCredits} taken
                <span className="mx-1 inline-block h-2 w-2 rounded-full bg-maize" />
                {plannedCredits} planned
              </span>
              <span>{remainingCredits} to go</span>
            </div>
          </div>

          {/* Requirements tile */}
          <div className="bg-paper px-6 py-6">
            <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-blue">
              Requirements
            </div>
            <div className="display mt-1 flex items-baseline gap-1.5 text-[42px] font-bold leading-[1] text-ink">
              <span className="tabular-nums">{reqsMet}</span>
              <span className="text-[22px] text-ink-3">/ {reqsTotal}</span>
              <span className="ml-2 text-[13px] font-semibold uppercase tracking-wider text-ink-3">
                met
              </span>
            </div>
            <div className="mt-3 text-[12px] leading-relaxed text-ink-2">
              {reqsMet === reqsTotal
                ? 'Everything checks out. Nice.'
                : `${reqsTotal - reqsMet} still open across ${majorAudits.length} major${majorAudits.length === 1 ? '' : 's'}${
                    trackedMinors.length > 0
                      ? ` and ${trackedMinors.length} minor${trackedMinors.length === 1 ? '' : 's'}`
                      : ''
                  }.`}
            </div>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <nav className="sticky top-[57px] z-20 border-b-2 border-ink bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-1 px-6">
          <TabButton active={tab === 'terms'} onClick={() => setTab('terms')}>
            Terms
          </TabButton>
          <TabButton
            active={tab === 'requirements'}
            onClick={() => setTab('requirements')}
          >
            Requirements
            <span
              className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                tab === 'requirements'
                  ? 'bg-maize text-blue'
                  : 'bg-surface-2 text-ink-3'
              }`}
            >
              {reqsMet}/{reqsTotal}
            </span>
          </TabButton>
          <TabButton active={tab === 'library'} onClick={() => setTab('library')}>
            Course library
          </TabButton>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {tab === 'terms' && (
          <TermPlanner
            profile={profile}
            courseCatalog={courseCatalog}
            onAddCourse={addCourseToTerm}
            onRemoveCourse={removeCourseFromTerm}
            onAddExtraTerm={addExtraTerm}
            onRemoveTerm={removeTerm}
            onSetStartYear={setStartYear}
            onSetGradYear={setGradYear}
          />
        )}

        {tab === 'requirements' && (
          <div className="space-y-6">
            {majorAudits.map(({ major, audit }) => (
              <DegreeLedger
                key={major.id}
                major={major}
                audit={audit}
                onRemove={() => handleRemoveMajor(major)}
                canRemove
              />
            ))}
            {minorProgress.map((p) => (
              <MinorCard
                key={p.minor.id}
                progress={p}
                onRemove={() => removeMinor(p.minor.id)}
              />
            ))}
          </div>
        )}

        {tab === 'library' && (
          <CourseLibrary
            courseCatalog={courseCatalog}
            takenCourses={profile.takenCourses}
            plannedTerms={profile.plannedTerms}
          />
        )}

        <footer className="mt-12 border-t-2 border-ink pt-4 text-center text-[11px] text-ink-3">
          Local data. Lives in your browser.
        </footer>
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative -mb-[2px] flex items-center border-b-[3px] px-4 py-3 text-[13px] font-semibold transition ${
        active
          ? 'border-blue text-ink'
          : 'border-transparent text-ink-3 hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
