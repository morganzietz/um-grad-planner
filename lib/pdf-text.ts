'use client';

/**
 * Client-side PDF → text extraction using pdfjs-dist. Feeds into the same
 * transcript parser we use for text paste, so PDF path shares all the
 * parsing logic and warnings.
 *
 * Kept out of the pure /lib layer (which is Vitest-testable Node code) —
 * pdfjs needs the browser worker infra.
 */

export async function extractTextFromPdf(file: File): Promise<string> {
  // Lazy import — keeps pdfjs out of the initial bundle. Only loaded when
  // the user actually clicks the PDF-upload path.
  const pdfjs = await import('pdfjs-dist');
  // Point the worker at the CDN copy — avoids Next.js build gymnastics
  // around bundling the .mjs worker file.
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    // Wolverine PDFs put each cell as a separate TextItem. Preserve line
    // structure by inserting a newline when the y-position changes.
    let lastY: number | null = null;
    let line = '';
    const out: string[] = [];
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        out.push(line.trim());
        line = '';
      }
      line += (line ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line) out.push(line.trim());
    pageTexts.push(out.filter((l) => l.length > 0).join('\n'));
  }

  return pageTexts.join('\n\n');
}
