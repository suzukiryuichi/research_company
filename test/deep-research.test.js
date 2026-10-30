import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlCompanySites, allowedSite } from '../deep-research.mjs';
import { parseCompanyPage } from '../company-site.mjs';
import { researchQwen } from '../qwen-research.mjs';
import { RESEARCH_FIELDS } from '../research.mjs';
import { validateCompanies, applyResearchDraft } from '../src/model.js';
import { extractPdf } from '../pdf-text.mjs';

const root = 'https://example.com/';
const makePage = (url, links = [], text = '公開されている企業情報の本文。'.repeat(30)) => ({ url, title: new URL(url).pathname, text, links });
test('deep crawl reaches grandchildren across company, business, careers and IR and keeps unknown domains out', async () => {
  const graph = {
    [root]: ['/company/', '/business/', '/careers/', '/ir/', 'https://evil.example/ir/'],
    [root + 'company/']: ['/company/profile/'],
    [root + 'careers/']: ['/careers/people/'],
    [root + 'ir/']: ['/ir/management/'],
    [root + 'business/']: ['/business/service/'],
  };
  const calls = [];
  const result = await crawlCompanySites(root, { useSitemaps: false, fetchPage: async url => { calls.push(url); return makePage(url, (graph[url] || []).map(p => new URL(p, root).href)); } });
  assert.ok(result.pages.length > 4);
  assert.ok(calls.includes(root + 'careers/people/'));
  assert.ok(calls.includes(root + 'ir/management/'));
  assert.equal(calls.some(url => url.includes('evil.example')), false);
  for (const category of ['company', 'business', 'careers', 'ir']) assert.ok(result.coverage.categories[category] > 0);
});
test('explicit careers and IR seeds allow their domains and related subdomains without allowing lookalike domains', async () => {
  const sites = [root, 'https://example-careers.jp/', 'https://example-ir.jp/'];
  assert.equal(allowedSite('https://recruit.example.com/', sites), true);
  assert.equal(allowedSite('https://example.com.evil.example/', sites), false);
  const result = await crawlCompanySites(root, { useSitemaps: false, additionalUrls: sites.slice(1), fetchPage: async url => makePage(url) });
  assert.deepEqual(new Set(result.pages.map(p => p.url)), new Set(sites));
});
test('category scheduling gives careers and IR a turn before many company pages exhaust the request budget', async () => {
  const calls = [];
  const links = [...Array.from({ length: 30 }, (_, i) => `${root}company/${i}`), root + 'careers/', root + 'ir/'];
  const result = await crawlCompanySites(root, { maxPages: 12, useSitemaps: false, fetchPage: async url => { calls.push(url); return makePage(url, url === root ? links : []); } });
  assert.equal(calls.length, 12);
  assert.ok(calls.includes(root + 'careers/')); assert.ok(calls.includes(root + 'ir/'));
  assert.ok(result.coverage.pending > 0); assert.equal(result.coverage.limitReached, true);
});
test('sitemap indexes discover unlinked IR PDFs; failed page URLs remain in coverage', async () => {
  const result = await crawlCompanySites(root, { fetchPage: async url => {
    if (url.endsWith('/sitemap.xml')) return parseCompanyPage(`<sitemapindex><sitemap><loc>${root}map.xml</loc></sitemap></sitemapindex>`, url);
    if (url.endsWith('/map.xml')) return parseCompanyPage(`<urlset><url><loc>${root}ir/report.pdf</loc></url><url><loc>${root}broken</loc></url></urlset>`, url);
    if (url.endsWith('/broken')) throw new Error('Unavailable');
    return { ...makePage(url), ...(url.endsWith('.pdf') ? { pdf: { totalPages: 2, pagesRead: 2 } } : {}) };
  } });
  assert.ok(result.pages.some(p => p.url.endsWith('.pdf')));
  assert.equal(result.coverage.sitemapsRead, 2);
  assert.equal(result.coverage.failures[0].url, root + 'broken');
});
test('depth limit and cancellation stop further crawl work', async () => {
  const calls = [];
  const result = await crawlCompanySites(root, { maxDepth: 1, useSitemaps: false, fetchPage: async url => { calls.push(url); return makePage(url, [new URL('next/', url).href]); } });
  assert.equal(calls.length, 2);
  assert.ok(result.coverage.excluded.depth > 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(crawlCompanySites(root, { signal: controller.signal, useSitemaps: false, fetchPage: async () => { throw new Error('should not run'); } }), error => error.name === 'AbortError');
});
test('Qwen reads every batch including the final pages and then synthesizes bounded evidence', async () => {
  const pages = Array.from({ length: 9 }, (_, i) => makePage(`${root}company/${i}`));
  const payloads = [];
  const result = await researchQwen({ name: '企業A', url: root, additionalUrls: ['https://example-ir.jp/'], maxPages: 24 }, {
    apiKey: 'test', baseUrl: 'https://lab.example/v1',
    collectPages: async (_url, options) => { assert.deepEqual(options.additionalUrls, ['https://example-ir.jp/']); return { pages, skipped: 0, coverage: { attempted: 9, fetched: 9, maxPages: 24, maxDepth: 3, discovered: 9, pending: 0, categories: { company: 9 }, failures: [], sitemapsRead: 0, documents: pages.map(p => ({ ...p, category: 'company' })) } }; },
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).messages[1].content); payloads.push(input);
      const id = input.pages ? input.pages.at(-1).source_id : 9;
      const summary = Object.fromEntries([...RESEARCH_FIELDS.map(key => [key, { text: key === 'url' ? root : `出典${id}の重要な事実`, source_ids: [id] }]), ['caveats', '']]);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(summary) } }] });
    },
  });
  assert.equal(payloads.length, 4);
  assert.deepEqual(payloads.slice(0, 3).flatMap(p => p.pages.map(d => d.source_id)), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(payloads.at(-1).findings[2].fields.business.source_ids.includes(9));
  assert.deepEqual(result.research.citations.business, [9]);
  assert.equal(result.research.coverage.modelCalls, 4);
  const merged = applyResearchDraft({ id: 'one', name: '企業A', status: '研究中' }, result, ['business']);
  const [saved] = validateCompanies([merged]);
  assert.equal(saved.research.coverage.fetched, 9);
  assert.equal(saved.research.coverage.documents.length, 9);
  assert.deepEqual(validateCompanies(JSON.parse(JSON.stringify([saved]))), [saved]);
});
test('real PDF parser extracts report text and page counts', async () => {
  const stream = 'BT /F1 12 Tf 50 700 Td (IR Revenue 1000) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const result = await extractPdf(Buffer.from(pdf), root + 'ir/report.pdf');
  assert.ok(result.text.includes('IR Revenue 1000'));
  assert.deepEqual(result.pdf, { totalPages: 1, pagesRead: 1 });
});
