'use client';

import type { MinorProgress } from '@/lib/audit';
import { RequirementRow, type OverrideUi } from './DegreeLedger';

interface MinorCardProps {
  progress: MinorProgress;
  onRemove?: () => void;
  overrideUi?: OverrideUi;
}

export function MinorCard({ progress, onRemove, overrideUi }: MinorCardProps) {
  if (progress.requirements && progress.requirements.length > 0) {
    return (
      <RequirementMinorCard progress={progress} onRemove={onRemove} overrideUi={overrideUi} />
    );
  }
  return <LegacyMinorCard progress={progress} onRemove={onRemove} />;
}

function CardShell({
  progress,
  onRemove,
  subtitle,
  children,
}: {
  progress: MinorProgress;
  onRemove?: () => void;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-surface">
      <header className="flex items-start justify-between gap-3 border-b-[1.5px] border-ink bg-paper px-5 py-4">
        <div>
          <div className="eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-blue">
            Minor
          </div>
          <h2 className="display mt-1 text-[20px] font-bold leading-tight text-ink">
            {progress.minor.name}
          </h2>
          {progress.minor.school && (
            <div className="mt-0.5 text-[12px] text-ink-3">
              {progress.minor.school}
            </div>
          )}
          <div className="mt-1 text-[12px] text-ink-2">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {progress.isDiscovery && (
            <span className="rounded border-[1.5px] border-ink bg-maize px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-blue">
              {progress.remaining.length === 1
                ? '1 away'
                : `${progress.remaining.length} away`}
            </span>
          )}
          {progress.complete && (
            <span className="rounded border-[1.5px] border-ink bg-success px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
              Complete
            </span>
          )}
          {onRemove && (
            <button
              onClick={() => onRemove()}
              className="rounded-md border-[1.5px] border-ink px-2 py-1 text-[11px] font-semibold text-ink hover:bg-danger hover:text-white"
            >
              Remove
            </button>
          )}
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function RequirementMinorCard({ progress, onRemove, overrideUi }: MinorCardProps) {
  const reqs = progress.requirements!;
  const metCount = reqs.filter((r) => r.met).length;
  return (
    <CardShell
      progress={progress}
      onRemove={onRemove}
      subtitle={`${metCount} of ${reqs.length} requirements met`}
    >
      <ul className="space-y-2">
        {reqs.map((r) => (
          <li key={r.requirement.id}>
            <RequirementRow progress={r} overrideUi={overrideUi} />
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

function LegacyMinorCard({ progress, onRemove }: MinorCardProps) {
  const total = progress.done.length + progress.remaining.length;
  return (
    <CardShell
      progress={progress}
      onRemove={onRemove}
      subtitle={`${progress.done.length} of ${total} required courses done`}
    >
      {progress.done.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue">
            Done
          </div>
          <div className="mono mt-1.5 flex flex-wrap gap-1">
            {progress.done.map((code) => (
              <span
                key={code}
                className="rounded border-[1.5px] border-ink bg-success-tint px-1.5 py-0.5 text-[11px] font-bold text-ink"
              >
                ✓ {code}
              </span>
            ))}
          </div>
        </div>
      )}

      {progress.remaining.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue">
            Still needed
          </div>
          <div className="mono mt-1.5 flex flex-wrap gap-1">
            {progress.remaining.map((code) => (
              <span
                key={code}
                className="rounded border-[1.5px] border-line bg-paper px-1.5 py-0.5 text-[11px] font-bold text-ink-2"
              >
                {code}
              </span>
            ))}
          </div>
        </div>
      )}
    </CardShell>
  );
}
