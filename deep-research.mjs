import { fetchPublicPage, publicSiteUrl } from './company-site.mjs';
import { ResearchError } from './research.mjs';
import { RESEARCH_CATEGORIES } from './src/model.js';

export const CATEGORIES = RESEARCH_CATEGORIES;
export function categoryOf(url, label = '') {
  const value = `${new URL(url).pathname} ${label}`;
  if (/recruit|career|採用|働|社員|人材|福利|intern/i.test(value)) return 'careers';
  if (/investor|financial|finance|annual|integrated|決算|統合報告|有価証券|経営|株主|中期|(?:^|\/)ir(?:[\/._-]|$)/i.test(value)) return 'ir';
  if (/sustainab|esg|csr|環境|サステナ/i.test(value)) return 'sustainability';
  if (/business|service|product|solution|事業|製品|商品|サービス|強み/i.test(value)) return 'business';
  if (/company|about|profile|vision|philosophy|corporate|会社|企業|理念/i.test(value)) return 'company';
  if (/news|press|release|ニュース|発表/i.test(value)) return 'news';
  return 'general';
}
export function normalizeCrawlUrl(value, base) {
  const url = publicSiteUrl(new URL(value, base).href);
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.href;
}
export function allowedSite(value, roots) {
  const host = new URL(value).hostname;
  return roots.some(root => { const base = new URL(root).hostname.replace(/^www\./, ''); return host === base || host.endsWith(`.${base}`); });
}
export async function crawlCompanySites(url, { signal, fetchPage = fetchPublicPage, additionalUrls = [], maxPages = 24, maxDepth = 3, useSitemaps = true } = {}) {
  if (![12, 24, 40].includes(maxPages) && maxPages !== 4) throw new ResearchError('調査ページ数を確認してください。', 400);
  const seeds = [...new Set([url, ...additionalUrls].map(value => normalizeCrawlUrl(value)))];
  const roots = [...seeds];
  const queue = [], seen = new Set(), pages = [], pageUrls = new Set(), failures = [], excluded = { outside: 0, unsupported: 0, depth: 0 };
  const counts = Object.fromEntries(Object.keys(CATEGORIES).map(key => [key, 0]));
  const scheduled = { ...counts };
  let attempted = 0, mapsRead = 0;
  const enqueue = (value, depth, label = '', priority = false) => {
    let next;
    try { next = normalizeCrawlUrl(value); } catch { return; }
    if (seen.has(next) || seen.size >= 2000) return;
    seen.add(next);
    if (!allowedSite(next, roots)) { excluded.outside++; return; }
    const path = new URL(next).pathname;
    if (/\.(zip|png|jpe?g|gif|svg|mp4|xlsx?|docx?)$/i.test(path) || /\/(login|logout|cart|search|contact|privacy|terms)(\/|$)/i.test(path)) { excluded.unsupported++; return; }
    if (depth > maxDepth) { excluded.depth++; return; }
    queue.push({ url: next, depth, category: categoryOf(next, label), priority });
  };
  for (const seed of seeds) enqueue(seed, 0, '', true);
  for (const seed of seeds) enqueue(new URL('/', seed).href, 0);
  // Site maps add discovery links; they are not counted as evidence pages.
  if (useSitemaps) {
    const mapUrls = [...new Set(seeds.map(seed => new URL('/sitemap.xml', seed).href))];
    for (const mapUrl of mapUrls.slice(0, 5)) {
      signal?.throwIfAborted();
      try {
        const map = await fetchPage(mapUrl, { signal });
        if (!map.sitemap) continue;
        mapsRead++;
        const nested = [];
        for (const link of map.links) {
          if (!allowedSite(link, roots)) continue;
          if (/\.xml(?:\?|$)/i.test(link)) { if (nested.length < 2) nested.push(link); }
          else enqueue(link, 1);
        }
        for (const link of nested) {
          try { const child = await fetchPage(link, { signal }); if (child.sitemap) { mapsRead++; for (const item of child.links) if (!/\.xml(?:\?|$)/i.test(item)) enqueue(item, 1); } }
          catch { /* Optional map discovery must not hide usable site pages. */ }
        }
      } catch { /* Missing site maps are common. */ }
    }
  }
  while (queue.length && attempted < maxPages) {
    signal?.throwIfAborted();
    const batch = [];
    while (batch.length < 3 && queue.length && attempted + batch.length < maxPages) {
      queue.sort((a, b) => Number(b.priority) - Number(a.priority) || scheduled[a.category] - scheduled[b.category] || a.depth - b.depth);
      const next = queue.shift(); batch.push(next); scheduled[next.category]++;
    }
    attempted += batch.length;
    const results = await Promise.allSettled(batch.map(item => fetchPage(item.url, { signal })));
    signal?.throwIfAborted();
    results.forEach((result, i) => {
      const item = batch[i];
      if (result.status === 'rejected') { failures.push({ url: item.url, reason: result.reason instanceof ResearchError ? result.reason.message.slice(0, 250) : '接続・読取に失敗しました。' }); return; }
      const page = result.value;
      if (!allowedSite(page.url, roots)) { failures.push({ url: item.url, reason: '指定した公式サイトの範囲外へ転送されたため除外しました。' }); return; }
      for (const link of page.links || []) enqueue(link, item.depth + 1, page.linkLabels?.[link]);
      if (page.sitemap || pageUrls.has(page.url)) return;
      if (page.text.length < 80) { failures.push({ url: page.url, reason: '読める本文が不足しています（動的表示・画像など）。' }); return; }
      const detected = categoryOf(page.url, page.title);
      const category = detected === 'general' ? item.category : detected;
      pageUrls.add(page.url); pages.push({ ...page, category }); counts[category]++;
    });
  }
  if (!pages.length) throw new ResearchError('公開ページの本文を取得できませんでした。会社概要・採用・IRなどのURLを追加して再実行してください。', 422);
  return { pages, skipped: failures.length, coverage: {
    attempted, fetched: pages.length, maxPages, maxDepth, discovered: seen.size, pending: queue.length, limitReached: queue.length > 0,
    categories: counts, failures, sitemapsRead: mapsRead, excluded, documents: pages.map(page => ({ url: page.url, title: page.title, category: page.category })),
  } };
}
