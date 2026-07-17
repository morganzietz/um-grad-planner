'use client';

import { useState } from 'react';
import type { Major, Minor } from '@/lib/types';

function describeMinor(m: Minor): string {
  if (m.requirements && m.requirements.length > 0) {
    return `${m.requirements.length} requirement${m.requirements.length === 1 ? '' : 's'}`;
  }
  const n = m.requiredCodes?.length ?? 0;
  return `${n} required course${n === 1 ? '' : 's'}`;
}

interface CredentialAdderProps {
  availableMajors: Major[];
  availableMinors: Minor[];
  onAddMajor: (id: string) => void;
  onAddMinor: (id: string) => void;
}

export function CredentialAdder({
  availableMajors,
  availableMinors,
  onAddMajor,
  onAddMinor,
}: CredentialAdderProps) {
  const [open, setOpen] = useState(false);
  const isEmpty =
    availableMajors.length === 0 && availableMinors.length === 0;

  return (
    <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-md py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        {open ? 'Hide options' : '+ Add a major or minor'}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {isEmpty ? (
            <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
              No more bundled majors or minors available to add. (Drop another
              bundled snapshot into <code>/data/majors/</code> or extend the
              minor library in <code>/lib/data.ts</code> to add more.)
            </div>
          ) : (
            <>
              {availableMajors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Majors
                  </h3>
                  <ul className="space-y-1.5">
                    {availableMajors.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">
                            {m.name}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {m.school}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            onAddMajor(m.id);
                            setOpen(false);
                          }}
                          className="shrink-0 rounded-md bg-[#00274C] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0a3a6e]"
                        >
                          + Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {availableMinors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Minors
                  </h3>
                  <ul className="space-y-1.5">
                    {availableMinors.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">
                            {m.name}
                          </div>
                          <div className="truncate text-xs text-slate-500">
                            {describeMinor(m)}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            onAddMinor(m.id);
                            setOpen(false);
                          }}
                          className="shrink-0 rounded-md bg-[#00274C] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0a3a6e]"
                        >
                          + Add
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
