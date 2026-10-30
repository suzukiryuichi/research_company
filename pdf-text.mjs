import { createRequire } from 'node:module';
import path from 'node:path';

export async function extractPdf(bytes, url) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const assets = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true, isEvalSupported: false,
    cMapUrl: path.join(assets, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(assets, 'standard_fonts') + path.sep, wasmUrl: path.join(assets, 'wasm') + path.sep,
  });
  let doc;
  try {
    doc = await task.promise;
    const parts = [];
    const pagesRead = Math.min(doc.numPages, 20);
    for (let i = 1; i <= pagesRead; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(`【PDF ${i}ページ】 ${content.items.map(item => item.str || '').join(' ')}`);
      page.cleanup();
    }
    return { url, title: decodeURIComponent(new URL(url).pathname.split('/').pop()), text: parts.join('\n').slice(0, 24000), links: [], pdf: { totalPages: doc.numPages, pagesRead }, truncated: parts.join('\n').length > 24000 || doc.numPages > pagesRead };
  } finally { await task.destroy(); }
}
