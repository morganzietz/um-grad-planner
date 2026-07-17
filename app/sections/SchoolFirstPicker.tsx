'use client';

/**
 * Reusable school-first picker. Shows a grid of U-M schools, then majors or
 * minors inside a school once selected. Search within the school.
 *
 * Used on:
 *   - Home page (`PlansAndPicker`) for creating a new plan.
 *   - Plan page for adding a second major or a minor to the current plan.
 */
import { useMemo, useState } from 'react';
import { SCHOOLS, type School } from '@/lib/schools';

export interface PickerItem {
  id: string;
  name: string;
  /** Full school string as stored on the Major/Minor. Used to bucket by school. */
  schoolText?: string;
}

interface Props {
  kind: 'major' | 'minor';
  /** All bundled majors or minors. The picker filters + buckets internally. */
  items: PickerItem[];
  /** Item ids to exclude from the "pickable" state (already tracked). */
  excludeIds?: Set<string>;
  /** Called when the user picks an item. */
  onPick: (id: string) => void;
  /** Called when the user cancels the flow. Optional; hides the cancel button when omitted. */
  onCancel?: () => void;
}

function schoolIdForItem(schoolText: string | undefined): string {
  if (!schoolText) return 'other';
  const s = SCHOOLS.find((sc) => sc.matcher(schoolText));
  return s?.id ?? 'other';
}

export function SchoolFirstPicker({ kind, items, excludeIds, onPick, onCancel }: Props) {
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const itemsBySchool = useMemo(() => {
    const map = new Map<string, PickerItem[]>();
    for (const it of items) {
      const sid = schoolIdForItem(it.schoolText);
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(it);
    }
    return map;
  }, [items]);

  if (schoolId === null) {
    return (
      <div>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <div className="display text-[20px] font-bold leading-none text-ink">
              Pick a school
            </div>
            <div className="mt-1 text-[12px] text-ink-3">
              Then a {kind === 'major' ? 'major' : 'minor'} inside it.
            </div>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-[12px] font-semibold text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
        <SchoolGrid onPick={setSchoolId} counts={itemsBySchool} />
      </div>
    );
  }

  const schoolItems = itemsBySchool.get(schoolId) ?? [];
  const school = SCHOOLS.find((s) => s.id === schoolId);

  const filtered = schoolItems.filter((it) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return it.name.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="display truncate text-[20px] font-bold leading-none text-ink">
            {school?.full ?? 'Other'}
          </div>
          <div className="mt-1 text-[12px] text-ink-3">
            {kind === 'major' ? 'Majors' : 'Minors'} in this school
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSchoolId(null);
              setSearch('');
            }}
            className="text-[12px] font-semibold text-ink-3 hover:text-ink"
          >
            ← Back
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-[12px] font-semibold text-ink-3 hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={`Search ${school?.short ?? 'this school'} ${
          kind === 'major' ? 'majors' : 'minors'
        }...`}
        className="mb-3 w-full rounded-md border-[1.5px] border-ink bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-ink-4 focus:bg-surface focus:outline-none"
      />

      {schoolItems.length === 0 ? (
        <div className="rounded-md border-[1.5px] border-dashed border-ink-4 bg-paper p-6 text-center text-[12px] text-ink-3">
          No {kind === 'major' ? 'majors' : 'minors'} bundled here yet.
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border-[1.5px] border-ink bg-surface">
          {filtered.length === 0 && (
            <div className="py-6 text-center text-[12px] text-ink-4">
              No matches for &ldquo;{search}&rdquo;.
            </div>
          )}
          {filtered.map((it) => {
            const already = excludeIds?.has(it.id) ?? false;
            return (
              <div
                key={it.id}
                className={`flex items-center justify-between gap-3 border-b-[1.5px] border-line-soft px-4 py-2.5 last:border-b-0 ${
                  already ? 'bg-paper' : 'bg-surface hover:bg-maize-tint'
                }`}
              >
                <div className="min-w-0 truncate text-[13px] font-medium text-ink">
                  {it.name}
                </div>
                {already ? (
                  <span className="shrink-0 rounded border border-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
                    Added
                  </span>
                ) : (
                  <button
                    onClick={() => onPick(it.id)}
                    className="shrink-0 rounded-md border-[1.5px] border-ink bg-maize px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-blue hover:bg-maize-hover hover:shadow-[2px_2px_0_0_var(--blue)]"
                  >
                    Add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SchoolGrid({
  onPick,
  counts,
}: {
  onPick: (schoolId: string) => void;
  counts: Map<string, PickerItem[]>;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {SCHOOLS.map((s: School) => {
        const n = counts.get(s.id)?.length ?? 0;
        const disabled = n === 0;
        return (
          <button
            key={s.id}
            onClick={() => onPick(s.id)}
            disabled={disabled}
            className={`group flex flex-col items-start rounded-[10px] border-[1.5px] border-ink bg-surface p-3.5 text-left transition duration-150 ease-out ${
              disabled
                ? 'cursor-not-allowed opacity-40'
                : 'hover:-translate-x-[2px] hover:-translate-y-[2px] hover:bg-maize-tint hover:shadow-[3px_3px_0_0_var(--blue)]'
            }`}
          >
            <div className="flex w-full items-baseline justify-between gap-2">
              <div className="display text-[14px] font-bold text-ink">{s.short}</div>
              <div className="text-[11px] font-semibold tabular-nums text-ink-3">{n}</div>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3">
              {s.full}
            </div>
          </button>
        );
      })}
    </div>
  );
}
