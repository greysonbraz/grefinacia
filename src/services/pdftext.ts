import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * Texto de um PDF (extrato ou fatura), lido no próprio aparelho com o pdf.js (Mozilla, Apache-2.0).
 * Junta os pedaços de texto de cada página em linhas, pela altura na página, da esquerda para a direita.
 * Sem internet: o leitor vem dentro do app (o worker é um arquivo do próprio app, permitido pela CSP).
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function pdfLines(bytes: Uint8Array, maxPages = 40): Promise<string[]> {
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  const out: string[] = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map<number, { x: number; s: string }[]>();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 3) * 3; // tolera pequenas diferenças de altura na mesma linha
        rows.set(y, [...(rows.get(y) ?? []), { x: it.transform[4], s: it.str }]);
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) out.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  } finally {
    void task.destroy();
  }
  return out;
}
