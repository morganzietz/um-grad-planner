'use client';

import { useMemo, useState } from 'react';
import type { Course, PlannedTerm, TakenCourse } from '@/lib/types';

interface CourseLibraryProps {
  courseCatalog: Course[];
  takenCourses: TakenCourse[];
  plannedTerms: PlannedTerm[];
}

const QUICK_TAGS: { key: string; label: string; description: string }[] = [
  { key: 'lsa-humanities', label: 'HU', description: 'Humanities' },
  { key: 'lsa-social-sciences', label: 'SS', description: 'Social Sciences' },
  { key: 'lsa-natural-sciences', label: 'NS', description: 'Natural Sciences' },
  { key: 'lsa-math-symbolic', label: 'MSA', description: 'Math & Symbolic Analysis' },
  { key: 'lsa-creative-expression', label: 'CE', description: 'Creative Expression' },
  { key: 'lsa-interdisciplinary', label: 'ID', description: 'Interdisciplinary' },
  { key: 'lsa-race-ethnicity', label: 'R&E', description: 'Race & Ethnicity' },
  { key: 'lsa-fywr', label: 'FYWR', description: 'First-Year Writing' },
  { key: 'lsa-ulwr', label: 'ULWR', description: 'Upper-Level Writing' },
  { key: 'lsa-qr', label: 'QR', description: 'Quantitative Reasoning' },
  { key: 'lsa-language', label: 'LANG', description: 'Language Requirement' },
  { key: 'lsa-bs', label: 'BS', description: 'Counts toward BS credit' },
  { key: 'lsa-experiential', label: 'EXP', description: 'Experiential' },
  { key: 'upper-level', label: '300+', description: 'Upper-level (300+)' },
];

const SEASON_LABEL: Record<string, string> = {
  fall: 'Fall',
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
};

export function CourseLibrary({
  courseCatalog,
  takenCourses,
  plannedTerms,
}: CourseLibraryProps) {
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const status = useMemo(() => {
    const takenCodes = new Set(takenCourses.map((c) => c.code));
    const plannedByCode = new Map<string, string>();
    for (const t of plannedTerms) {
      for (const code of t.courseCodes) plannedByCode.set(code, t.name);
    }
    return { takenCodes, plannedByCode };
  }, [takenCourses, plannedTerms]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    let matches = courseCatalog;
    if (q) {
      matches = matches.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q),
      );
    }
    if (activeTags.size > 0) {
      matches = matches.filter((c) => {
        for (const t of activeTags) if (!c.tags.includes(t)) return false;
        return true;
      });
    }
    return matches.slice(0, 60);
  }, [query, courseCatalog, activeTags]);

  const toggleTag = (key: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalMatching = useMemo(() => {
    const q = query.trim().toLowerCase();
    let matches = courseCatalog;
    if (q) {
      matches = matches.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q),
      );
    }
    if (activeTags.size > 0) {
      matches = matches.filter((c) => {
        for (const t of activeTags) if (!c.tags.includes(t)) return false;
        return true;
      });
    }
    return matches.length;
  }, [query, courseCatalog, activeTags]);

  return (
    <section className="overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-surface">
      <header className="flex items-end justify-between gap-3 border-b-[1.5px] border-ink bg-paper px-5 py-4">
        <div>
          <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-blue">
            Explore
          </div>
          <h2 className="display mt-1 text-[22px] font-bold leading-tight text-ink">
            Course library
          </h2>
        </div>
        <div className="text-right">
          <div className="display text-[24px] font-bold leading-none tabular-nums text-ink">
            {courseCatalog.length.toLocaleString()}
          </div>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Courses total
          </div>
        </div>
      </header>

      <div className="px-5 py-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by code or title"
          className="mb-3 w-full rounded-md border-[1.5px] border-ink bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:bg-surface focus:outline-none"
        />

        <div className="mb-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Filter by distribution / tag
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_TAGS.map((t) => {
              const on = activeTags.has(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => toggleTag(t.key)}
                  title={t.description}
                  className={`rounded-md border-[1.5px] px-2.5 py-1 text-[11px] font-bold transition ${
                    on
                      ? 'border-ink bg-maize text-blue shadow-[2px_2px_0_0_var(--blue)]'
                      : 'border-ink bg-surface text-ink hover:bg-maize-tint'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
            {activeTags.size > 0 && (
              <button
                onClick={() => setActiveTags(new Set())}
                className="rounded-md px-2.5 py-1 text-[11px] font-semibold text-ink-3 hover:bg-paper hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mb-2 text-[12px] text-ink-3">
          Showing {results.length} of {totalMatching}
          {totalMatching > results.length ? ` (refine to see more)` : ''}.
        </div>

        <ul className="max-h-[600px] space-y-1.5 overflow-y-auto pr-1">
          {results.map((c) => {
            const isTaken = status.takenCodes.has(c.code);
            const plannedIn = status.plannedByCode.get(c.code);
            const offered = c.offeredTerms ?? [];

            return (
              <li
                key={c.code}
                className={`flex items-start justify-between gap-2 rounded-md border-[1.5px] px-3 py-2 ${
                  isTaken
                    ? 'border-ink bg-success-tint'
                    : plannedIn
                      ? 'border-ink bg-maize-tint'
                      : 'border-line bg-paper'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="mono text-[13px] font-bold text-ink">
                      {c.code}
                    </span>
                    <span className="mono text-[11px] tabular-nums text-ink-3">
                      {c.credits} cr
                    </span>
                    {isTaken && <StatusPill kind="taken">Taken</StatusPill>}
                    {plannedIn && (
                      <StatusPill kind="planned">In {plannedIn}</StatusPill>
                    )}
                    {offered.length > 0 && offered.length < 4 && (
                      <span className="rounded border border-ink bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-blue">
                        {offered.map((k) => SEASON_LABEL[k] ?? k).join(' / ')}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-ink-2">{c.title}</div>
                  {c.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded border border-line bg-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-3"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  {c.prereqs && c.prereqs.length > 0 && (
                    <div className="mt-1 text-[11px] text-ink-3">
                      <span className="font-semibold text-ink-2">Prereqs:</span>{' '}
                      {c.prereqs
                        .map((g) => (g.length === 1 ? g[0] : g.join(' or ')))
                        .join(' · ')}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {results.length === 0 && (
          <div className="py-6 text-center text-[13px] text-ink-3">
            No courses match your filters.
          </div>
        )}
      </div>
    </section>
  );
}

function StatusPill({
  kind,
  children,
}: {
  kind: 'taken' | 'planned';
  children: React.ReactNode;
}) {
  const cls =
    kind === 'taken'
      ? 'border-ink bg-success text-white'
      : 'border-ink bg-maize text-blue';
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${cls}`}
    >
      {children}
    </span>
  );
}
