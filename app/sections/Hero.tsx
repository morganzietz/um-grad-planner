'use client';

import type { DegreeAudit, GraduationProjection } from '@/lib/audit';

interface HeroProps {
  audit: DegreeAudit;
  projection: GraduationProjection;
}

export function Hero({ audit, projection }: HeroProps) {
  const { takenCredits, plannedCredits, goalCredits, remainingCredits } = audit.credits;
  const total = takenCredits + plannedCredits;
  const takenPct = Math.min(100, (takenCredits / goalCredits) * 100);
  const plannedPct = Math.min(100 - takenPct, (plannedCredits / goalCredits) * 100);

  return (
    <section className="rounded-2xl bg-gradient-to-br from-[#00274C] to-[#0a3a6e] p-8 text-white shadow-lg">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-[#FFCB05]/80">
            Projected graduation
          </div>
          {projection.status === 'projected' ? (
            <div className="mt-2">
              <div className="text-4xl font-semibold tracking-tight">
                {projection.term.name}
              </div>
              <div className="mt-1 text-sm text-white/70">
                All degree requirements satisfied with your current plan.
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <div className="text-4xl font-semibold tracking-tight">
                Not yet
              </div>
              <div className="mt-1 text-sm text-white/70">
                {projection.missingRequirements.length} requirement
                {projection.missingRequirements.length === 1 ? '' : 's'} unmet
                {projection.missingCredits > 0 && (
                  <> · {projection.missingCredits} credits short of {goalCredits}</>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="md:min-w-[300px]">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-white/70">Total credits</span>
            <span>
              <span className="text-2xl font-semibold tabular-nums">
                {total}
              </span>
              <span className="text-white/50"> / {goalCredits}</span>
            </span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/10">
            <div className="flex h-full">
              <div
                className="bg-[#FFCB05]"
                style={{ width: `${takenPct}%` }}
                title={`${takenCredits} taken`}
              />
              <div
                className="bg-[#FFCB05]/40"
                style={{ width: `${plannedPct}%` }}
                title={`${plannedCredits} planned`}
              />
            </div>
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/60">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#FFCB05]" />
              {takenCredits} taken
              <span className="mx-1 inline-block h-2 w-2 rounded-full bg-[#FFCB05]/40" />
              {plannedCredits} planned
            </span>
            <span>{remainingCredits} to go</span>
          </div>
        </div>
      </div>
    </section>
  );
}
