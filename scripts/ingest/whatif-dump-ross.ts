/**
 * Dump every What-If PDF in data/whatif-pdfs/ to a .txt file (one line per
 * visual text row) in the scratchpad whatif-text/ dir, for careful manual
 * re-extraction of major requirements.
 *
 * Run from repo root: npx tsx <scratchpad>/dump-whatif-text.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const PDF_DIR = join(process.cwd(), 'data', 'whatif-pdfs', 'ross');
const OUT_DIR = '/Users/morganzietz/.claude/jobs/1326d47b/tmp/ross-text';

async function extractPdfText(path: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = readFileSync(path);
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let line = '';
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        if (line.trim()) lines.push(line.trim());
        line = '';
      }
      line += (line ? ' ' : '') + item.str;
      lastY = y;
    }
    if (line.trim()) lines.push(line.trim());
    lines.push(`--- page ${n} end ---`);
  }
  return lines;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const pdfs = readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf'));
  for (const f of pdfs) {
    const slug = basename(f, '.pdf');
    const lines = await extractPdfText(join(PDF_DIR, f));
    writeFileSync(join(OUT_DIR, `${slug}.txt`), lines.join('\n') + '\n', 'utf-8');
    console.log(`${slug}: ${lines.length} lines`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
