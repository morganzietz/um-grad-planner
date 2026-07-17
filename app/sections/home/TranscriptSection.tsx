'use client';

import { useMemo, useRef, useState } from 'react';
import { parseTranscriptText } from '@/lib/transcript-parser';
import { inferStartYear, resolveTranscript, useTranscript } from '@/lib/state';

export function TranscriptSection() {
  const { transcript, setTakenCourses, setStartYear } = useTranscript();
  const [mode, setMode] = useState<'idle' | 'paste' | 'pdf'>('idle');
  const [rawText, setRawText] = useState('');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const takenCount = transcript.takenCourses.length;
  const creditsCount = transcript.takenCourses.reduce((s, c) => s + c.credits, 0);
  const termsSeen = useMemo(() => {
    const set = new Set<string>();
    for (const c of transcript.takenCourses) set.add(c.term);
    return set.size;
  }, [transcript.takenCourses]);
  const hasTranscript = takenCount > 0;

  function processText(text: string) {
    const parsed = parseTranscriptText(text);
    const { taken } = resolveTranscript(parsed.courses);
    setTakenCourses(taken);
    const inferred = inferStartYear(parsed.courses);
    if (inferred !== undefined) setStartYear(inferred);
    setRawText('');
    setMode('idle');
  }

  async function handlePdfUpload(file: File) {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const { extractTextFromPdf } = await import('@/lib/pdf-text');
      const text = await extractTextFromPdf(file);
      setRawText(text);
      processText(text);
    } catch (e) {
      setPdfError((e as Error).message);
      setMode('pdf');
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="display text-[28px] font-bold leading-none tracking-[-0.01em] text-ink">
            Transcript
          </h2>
          <div className="mt-1.5 text-[13px] text-ink-3">
            {hasTranscript
              ? 'Loaded and matched against every plan.'
              : 'Optional. Great for transfers and anyone with credits already.'}
          </div>
        </div>
        {mode === 'idle' && hasTranscript && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('paste')}
              className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-ink hover:text-maize"
            >
              Re-paste
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border-[1.5px] border-ink px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-ink hover:text-maize"
            >
              Re-upload PDF
            </button>
          </div>
        )}
      </div>

      {mode === 'idle' && hasTranscript && (
        <>
          <div className="grid grid-cols-3 gap-0 overflow-hidden rounded-[10px] border-[1.5px] border-ink bg-surface">
            <TranscriptStat value={takenCount} label="courses" />
            <TranscriptStat value={creditsCount} label="credits" divider />
            <TranscriptStat value={termsSeen} label="terms" divider />
          </div>
          <details className="mt-4 rounded-[10px] border-[1.5px] border-ink bg-surface">
            <summary className="cursor-pointer list-none px-4 py-2.5 text-[12px] font-semibold text-ink-2 hover:text-ink">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
              Show all parsed courses
            </summary>
            <div className="border-t-[1.5px] border-ink px-4 py-3">
              <div className="max-h-72 overflow-y-auto">
                <table className="mono w-full text-left text-[11px]">
                  <thead className="border-b border-line text-ink-3">
                    <tr>
                      <th className="pb-1.5 pr-3 font-semibold">Term</th>
                      <th className="pb-1.5 pr-3 font-semibold">Code</th>
                      <th className="pb-1.5 pr-3 font-semibold">Grade</th>
                      <th className="pb-1.5 text-right font-semibold">Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transcript.takenCourses.map((c, i) => (
                      <tr key={i} className="border-b border-line-soft last:border-b-0">
                        <td className="py-1 pr-3 text-ink-3">{c.term}</td>
                        <td className="py-1 pr-3 font-semibold text-ink">{c.code}</td>
                        <td className="py-1 pr-3 text-ink-3">{c.grade}</td>
                        <td className="py-1 text-right tabular-nums text-ink">{c.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </>
      )}

      {mode === 'idle' && !hasTranscript && (
        <div className="rounded-[10px] border-[1.5px] border-ink bg-surface p-6">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="display text-[20px] font-bold text-ink">
                Import once, everything auto-fills.
              </div>
              <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-ink-2">
                Grab your unofficial transcript from Wolverine Access. Paste the text
                or drop the PDF. We&apos;ll match every course against every degree.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                onClick={() => setMode('paste')}
                className="btn-primary display text-[13px]"
              >
                Paste text
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-ghost text-[13px]"
              >
                Upload PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'paste' && (
        <div className="rounded-[10px] border-[1.5px] border-ink bg-surface p-5">
          <p className="text-[12px] font-medium text-ink-3">
            Paste your unofficial transcript. Include the &ldquo;FALL 2024&rdquo;-style term headers.
          </p>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={10}
            placeholder="FALL 2024&#10;EECS 183  Elementary Programming Concepts  A  4.00&#10;..."
            className="mono mt-3 w-full rounded-md border-[1.5px] border-ink bg-paper p-3 text-[12px] text-ink focus:bg-surface focus:outline-none"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setRawText('');
                setMode('idle');
              }}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-ink-3 hover:bg-paper hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={() => processText(rawText)}
              disabled={rawText.trim().length === 0}
              className="btn-primary text-[12px] disabled:cursor-not-allowed disabled:bg-ink-4 disabled:text-white disabled:shadow-none"
            >
              Parse transcript
            </button>
          </div>
        </div>
      )}

      {mode === 'pdf' && pdfError && (
        <div className="rounded-[10px] border-[1.5px] border-danger bg-danger-tint p-4 text-[12px] text-danger">
          <div className="display font-bold text-[14px]">Couldn&apos;t read that PDF</div>
          <div className="mt-1 text-ink-2">{pdfError}</div>
          <button
            onClick={() => {
              setPdfError(null);
              setMode('idle');
            }}
            className="mt-2 font-semibold text-blue underline underline-offset-2 hover:no-underline"
          >
            Try text paste instead
          </button>
        </div>
      )}

      {pdfLoading && (
        <div className="flex items-center gap-2 text-[12px] text-ink-3">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-maize" />
          Reading PDF…
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePdfUpload(file);
          e.target.value = '';
        }}
      />
    </section>
  );
}

function TranscriptStat({
  value,
  label,
  divider,
}: {
  value: number;
  label: string;
  divider?: boolean;
}) {
  return (
    <div className={`px-5 py-5 ${divider ? 'border-l-[1.5px] border-ink' : ''}`}>
      <div className="display text-[38px] font-bold leading-none tabular-nums text-ink">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
    </div>
  );
}
