/**
 * Odczyt tekstu z wyciągu PDF (pdf.js wczytywany dopiero przy imporcie PDF).
 * Elementy tekstu grupujemy w linie po współrzędnej Y, a w linii sortujemy po X.
 */
export const pdfLines = async (data: ArrayBuffer): Promise<string[]> => {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...itemsToLines(content.items as { str: string; transform: number[] }[]));
  }
  return lines;
};

export const itemsToLines = (items: { str: string; transform: number[] }[]): string[] => {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join('  '));
};
