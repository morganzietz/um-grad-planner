'use client';

import type { MinorProgress } from '@/lib/audit';

interface MinorsPanelProps {
  progress: MinorProgress[];
}

export function MinorsPanel({ progress }: MinorsPanelProps) {
  if (progress.length === 0) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          Minors you&apos;re close to
        </h2>
        <span className="text-xs text-slate-500">
          {progress.filter((m) => m.isDiscovery).length} discovery
          {progress.filter((m) => m.isDiscovery).length === 1 ? '' : 'ies'}
        </span>
      </header>

      <ul className="space-y-3">
        {progress.map((m) => {
          const total = m.done.length + m.remaining.length;
          return (
            <li
              key={m.minor.id}
              className={
                'rounded-xl border p-4 transition-colors ' +
                (m.isDiscovery
                  ? 'border-[#FFCB05] bg-amber-50/60'
                  : m.complete
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200 bg-slate-50/40')
              }
            >
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <h3 className="font-medium text-slate-900">{m.minor.name}</h3>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {m.done.length} of {total} required courses done
                  </div>
                </div>
                {m.isDiscovery && (
                  <span className="rounded-full bg-[#FFCB05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#00274C]">
                    {m.remaining.length === 1 ? '1 away' : `${m.remaining.length} away`}
                  </span>
                )}
                {m.complete && (
                  <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Complete
                  </span>
                )}
              </div>

              {m.done.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Done
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.done.map((code) => (
                      <span
                        key={code}
                        className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800"
                      >
                        ✓ {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {m.remaining.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Still needed
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.remaining.map((code) => (
                      <span
                        key={code}
                        className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
