'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Course, Profile, TermKind } from '@/lib/types';
import {
  buildTimeline,
  formatTermName,
  groupSlotsByAcademicYear,
  type TimelineSlot,
} from '@/lib/scheduling';
import { blockForAdd, formatBlock } from '@/lib/prereqs';

const DEFAULT_START_YEAR = 2024;
const DEFAULT_GRAD_YEAR = 2028;

function compareCourseCodes(a: string, b: string): number {
  const re = /^([A-Z]+)\s*(\d+)(.*)$/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (!ma || !mb) return a.localeCompare(b);
  if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
  const na = parseInt(ma[2], 10);
  const nb = parseInt(mb[2], 10);
  if (na !== nb) return na - nb;
  return ma[3].localeCompare(mb[3]);
}

interface TermPlannerProps {
  profile: Profile;
  courseCatalog: Course[];
  onAddCourse: (termId: string, code: string) => void;
  onRemoveCourse: (termId: string, code: string) => void;
  onAddExtraTerm: (kind: TermKind, year: number) => string;
  onRemoveTerm: (termId: string) => void;
  onSetStartYear: (year: number) => void;
  onSetGradYear: (year: number) => void;
}

export function TermPlanner({
  profile,
  courseCatalog,
  onAddCourse,
  onRemoveCourse,
  onAddExtraTerm,
  onRemoveTerm,
  onSetStartYear,
  onSetGradYear,
}: TermPlannerProps) {
  const startYear = profile.startYear ?? DEFAULT_START_YEAR;
  const gradYear = profile.gradYear ?? DEFAULT_GRAD_YEAR;

  const timeline = useMemo(
    () => buildTimeline(startYear, gradYear, profile.plannedTerms, profile.takenCourses),
    [startYear, gradYear, profile.plannedTerms, profile.takenCourses],
  );
  const grouped = useMemo(() => groupSlotsByAcademicYear(timeline), [timeline]);

  const catalogByCode = useMemo(
    () => new Map(courseCatalog.map((c) => [c.code, c])),
    [courseCatalog],
  );

  const plannedTermNamesById = useMemo(
    () =>
      new Map(
        profile.plannedTerms.map((t) => [t.id, t.name || formatTermName(t.id)]),
      ),
    [profile.plannedTerms],
  );

  const [showExtraTermForm, setShowExtraTermForm] = useState(false);

  return (
    <section className="overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-surface">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b-[1.5px] border-ink bg-paper px-5 py-4">
        <div>
          <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-blue">
            Timeline
          </div>
          <h2 className="display mt-1 text-[22px] font-bold leading-tight text-ink">
            Term planner
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Every term from your first Fall to your expected Winter graduation.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <YearField
            label="Start (Fall)"
            value={startYear}
            min={2010}
            max={gradYear - 1}
            onChange={onSetStartYear}
          />
          <YearField
            label="Graduate (Winter)"
            value={gradYear}
            min={startYear + 1}
            max={startYear + 10}
            onChange={onSetGradYear}
          />
          <button
            onClick={() => setShowExtraTermForm((v) => !v)}
            className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-ink hover:text-maize"
          >
            {showExtraTermForm ? 'Cancel' : '+ Extra term'}
          </button>
        </div>
      </header>

      {showExtraTermForm && (
        <div className="border-b-[1.5px] border-ink bg-maize-tint px-5 py-4">
          <ExtraTermForm
            startYear={startYear}
            gradYear={gradYear}
            onSubmit={(kind, year) => {
              onAddExtraTerm(kind, year);
              setShowExtraTermForm(false);
            }}
          />
        </div>
      )}

      <div className="space-y-8 px-5 py-6">
        {grouped.map(({ academicYear, slots }) => (
          <div key={academicYear}>
            <div className="mb-3 flex items-baseline gap-2">
              <div className="display text-[15px] font-bold uppercase tracking-[0.05em] text-blue">
                {academicYear}–{academicYear + 1}
              </div>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {slots.map((slot) => (
                <TermCard
                  key={slot.id}
                  slot={slot}
                  profile={profile}
                  catalogByCode={catalogByCode}
                  courseCatalog={courseCatalog}
                  plannedTermNamesById={plannedTermNamesById}
                  gradYear={gradYear}
                  timeline={timeline}
                  onAddCourse={onAddCourse}
                  onRemoveCourse={onRemoveCourse}
                  onRemoveTerm={onRemoveTerm}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function YearField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="mono w-24 rounded-md border-[1.5px] border-ink bg-surface px-2 py-1 text-[13px] text-ink focus:bg-paper focus:outline-none"
      />
    </label>
  );
}

function ExtraTermForm({
  startYear,
  gradYear,
  onSubmit,
}: {
  startYear: number;
  gradYear: number;
  onSubmit: (kind: TermKind, year: number) => void;
}) {
  const [kind, setKind] = useState<TermKind>('summer');
  const [year, setYear] = useState<number>(startYear);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Kind
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as TermKind)}
          className="rounded-md border-[1.5px] border-ink bg-surface px-2 py-1 text-[13px] text-ink focus:outline-none"
        >
          <option value="summer">Summer</option>
          <option value="spring">Spring</option>
          <option value="fall">Fall (extra)</option>
          <option value="winter">Winter (extra)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Year
        </span>
        <input
          type="number"
          value={year}
          min={startYear}
          max={gradYear}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setYear(n);
          }}
          className="mono w-24 rounded-md border-[1.5px] border-ink bg-surface px-2 py-1 text-[13px] text-ink focus:outline-none"
        />
      </label>
      <button onClick={() => onSubmit(kind, year)} className="btn-primary text-[12px]">
        Add term
      </button>
    </div>
  );
}

interface TermCardProps {
  slot: TimelineSlot;
  profile: Profile;
  catalogByCode: Map<string, Course>;
  courseCatalog: Course[];
  plannedTermNamesById: Map<string, string>;
  gradYear: number;
  timeline: TimelineSlot[];
  onAddCourse: (termId: string, code: string) => void;
  onRemoveCourse: (termId: string, code: string) => void;
  onRemoveTerm: (termId: string) => void;
}

function TermCard({
  slot,
  profile,
  catalogByCode,
  courseCatalog,
  plannedTermNamesById,
  gradYear,
  timeline,
  onAddCourse,
  onRemoveCourse,
  onRemoveTerm,
}: TermCardProps) {
  const handlePick = (code: string) => {
    onAddCourse(slot.id, code);
    const picked = catalogByCode.get(code);
    if (!picked?.sequenceNext) return;
    const successor = catalogByCode.get(picked.sequenceNext);
    if (!successor) return;

    const idx = timeline.findIndex((s) => s.id === slot.id);
    const nextSlot = timeline
      .slice(idx + 1)
      .find((s) => s.status !== 'taken');
    if (!nextSlot) return;

    const block = blockForAdd(
      successor,
      nextSlot.id,
      profile,
      plannedTermNamesById,
      { skipPrereqs: true },
    );
    if (block) return;
    onAddCourse(nextSlot.id, successor.code);
  };
  const isTaken = slot.status === 'taken';
  const isExtra = slot.status === 'extra';
  const isGradTerm = slot.kind === 'winter' && slot.year === gradYear;

  const totalCredits = isTaken
    ? slot.takenCourses.reduce((s, c) => s + c.credits, 0)
    : slot.plannedCodes.reduce(
        (s, code) => s + (catalogByCode.get(code)?.credits ?? 0),
        0,
      );

  const shellStyle = isTaken
    ? 'border-ink bg-success-tint'
    : isGradTerm
      ? 'border-ink bg-maize-tint'
      : isExtra
        ? 'border-ink bg-warn-tint'
        : 'border-ink bg-surface';

  return (
    <div className={`flex flex-col rounded-[10px] border-[1.5px] p-3.5 ${shellStyle}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h4 className="display text-[15px] font-bold text-ink">{slot.name}</h4>
          {isTaken && (
            <span className="rounded border border-ink bg-success px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
              Taken
            </span>
          )}
          {isGradTerm && (
            <span className="rounded border border-ink bg-maize px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-blue">
              Graduation
            </span>
          )}
          {isExtra && (
            <span className="rounded border border-ink bg-warn px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white">
              Extra
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="display text-[13px] font-bold tabular-nums text-ink-2">
            {totalCredits} cr
          </span>
          {isExtra && (
            <button
              onClick={() => onRemoveTerm(slot.id)}
              aria-label={`Remove ${slot.name}`}
              className="rounded p-1 text-ink-4 hover:bg-danger/10 hover:text-danger"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {isTaken ? (
        <ul className="space-y-1">
          {slot.takenCourses.map((c) => (
            <li key={c.code} className="flex items-baseline justify-between text-[13px]">
              <span className="mono truncate text-ink">
                <span className="font-bold">{c.code}</span>
                <span className="text-ink-3"> · {c.title}</span>
              </span>
              <span className="mono ml-2 shrink-0 text-[11px] tabular-nums text-ink-3">
                {c.grade} · {c.credits}cr
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {slot.plannedCodes.length > 0 ? (
            <ul className="space-y-1">
              {slot.plannedCodes.map((code) => {
                const c = catalogByCode.get(code);
                if (!c) return null;
                return (
                  <li
                    key={code}
                    className="flex items-baseline justify-between gap-2 text-[13px]"
                  >
                    <span className="mono truncate text-ink">
                      <span className="font-bold">{c.code}</span>
                      <span className="text-ink-3"> · {c.title}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="mono text-[11px] tabular-nums text-ink-3">
                        {c.credits}cr
                      </span>
                      <button
                        onClick={() => onRemoveCourse(slot.id, code)}
                        aria-label={`Remove ${code}`}
                        className="rounded p-0.5 text-ink-4 hover:bg-danger/10 hover:text-danger"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mb-1 text-[12px] italic text-ink-4">No courses planned.</div>
          )}
          <div className="mt-2">
            <CoursePicker
              termId={slot.id}
              courseCatalog={courseCatalog}
              profile={profile}
              plannedTermNamesById={plannedTermNamesById}
              onPick={handlePick}
            />
          </div>
        </>
      )}
    </div>
  );
}

interface CoursePickerProps {
  termId: string;
  courseCatalog: Course[];
  profile: Profile;
  plannedTermNamesById: Map<string, string>;
  onPick: (code: string) => void;
}

function CoursePicker({
  termId,
  courseCatalog,
  profile,
  plannedTermNamesById,
  onPick,
}: CoursePickerProps) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dropCoords, setDropCoords] = useState<{
    top: number;
    left: number;
    width: number;
    placement: 'below' | 'above';
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const DROPDOWN_HEIGHT = 300;

  useEffect(() => {
    if (!focused) {
      setDropCoords(null);
      return;
    }
    const el = inputRef.current;
    if (!el) return;
    function update() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placement =
        spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow ? 'above' : 'below';
      setDropCoords({
        top: placement === 'below' ? rect.bottom + 4 : rect.top - 4,
        left: rect.left,
        width: rect.width,
        placement,
      });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [focused, query]);

  const trimmedQuery = query.trim();
  const queryReady = trimmedQuery.length >= 2;

  const results = useMemo(() => {
    if (!queryReady) return [];
    const q = trimmedQuery.toLowerCase();
    return courseCatalog
      .filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q),
      )
      .map((c) => ({
        course: c,
        block: blockForAdd(c, termId, profile, plannedTermNamesById),
      }))
      .filter(
        ({ block }) =>
          block?.reason !== 'already-taken' &&
          block?.reason !== 'already-planned',
      )
      .sort((a, b) => compareCourseCodes(a.course.code, b.course.code))
      .slice(0, 12);
  }, [queryReady, trimmedQuery, courseCatalog, profile, termId, plannedTermNamesById]);

  // Portal-rendered dropdown positioned via fixed coords so it escapes any
  // ancestor's `overflow-hidden` clipping (e.g. the TermPlanner section box).
  const dropdownStyle = dropCoords
    ? {
        position: 'fixed' as const,
        left: dropCoords.left,
        width: dropCoords.width,
        ...(dropCoords.placement === 'below'
          ? { top: dropCoords.top }
          : { bottom: window.innerHeight - dropCoords.top }),
      }
    : { display: 'none' };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="+ Add course"
        className="w-full rounded-md border-[1.5px] border-ink bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-4 focus:bg-paper focus:outline-none"
      />
      {typeof window !== 'undefined' &&
        focused &&
        queryReady &&
        dropCoords &&
        createPortal(
          results.length === 0 ? (
            <div
              style={dropdownStyle}
              className="z-50 rounded-md border-[1.5px] border-ink bg-surface px-3 py-2 text-[12px] text-ink-3 shadow-[3px_3px_0_0_var(--blue)]"
            >
              No matching courses.
            </div>
          ) : (
            <ul
              style={dropdownStyle}
              className="z-50 max-h-72 overflow-x-hidden overflow-y-auto rounded-md border-[1.5px] border-ink bg-surface pb-1 shadow-[3px_3px_0_0_var(--blue)]"
            >
          {results.map(({ course, block }) => {
            const disabled = block !== null;
            return (
              <li
                key={course.code}
                onMouseDown={(e) => {
                  if (disabled) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  onPick(course.code);
                  setQuery('');
                }}
                className={`block w-full overflow-hidden border-b border-line-soft px-2.5 py-1.5 last:border-b-0 ${
                  disabled
                    ? 'cursor-not-allowed bg-paper text-ink-4'
                    : 'cursor-pointer hover:bg-maize-tint'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="mono min-w-0 flex-1 truncate">
                    <span className="font-bold">{course.code}</span>
                    <span className="text-ink-3"> · {course.title}</span>
                  </span>
                  <span className="mono shrink-0 text-[11px] text-ink-3">
                    {course.credits}cr
                  </span>
                </div>
                {disabled && (
                  <div className="mt-0.5 break-words text-[11px] font-semibold leading-snug text-danger">
                    {formatBlock(block)}
                  </div>
                )}
              </li>
            );
          })}
            </ul>
          ),
          document.body,
        )}
    </div>
  );
}
