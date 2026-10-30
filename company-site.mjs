import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { ResearchError } from './research.mjs';

export function isPublicIPv4(address) {
  if (typeof address !== 'string' || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const a = address.split('.').map(Number);
  if (a.length !== 4 || a.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [x, y, z] = a;
  if ([0, 10, 127].includes(x) || x >= 224) return false;
  if (x === 100 && y >= 64 && y <= 127) return false;
  if (x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31) return false;
  if (x === 192 && (y === 168 || y === 0 && [0, 2].includes(z) || y === 88 && z === 99)) return false;
  if (x === 198 && ([18, 19].includes(y) || y === 51 && z === 100)) return false;
  if (x === 203 && y === 0 && z === 113) return false;
  return true;
}
export function publicSiteUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new ResearchError('公式サイトのURLを確認してください。', 400); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hostname.startsWith('[')) throw new ResearchError('公式サイトには通常の公開HTTP/HTTPSページを指定してください。', 400);
  url.hash = '';
  return url;
}
function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (!code.startsWith('#')) return named[code.toLowerCase()];
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
}
export function parseCompanyPage(html, url) {
  if (/<(?:urlset|sitemapindex)\b/i.test(html)) {
    const links = [];
    for (const match of html.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
      try { links.push(publicSiteUrl(decodeEntities(match[1].trim())).href); } catch { /* Ignore invalid map links. */ }
      if (links.length >= 1200) break;
    }
    return { url, title: 'サイトマップ', text: '', links: [...new Set(links)], sitemap: true };
  }
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const title = decodeEntities((clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(url).hostname).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 300);
  const body = clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || clean.replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const fullText = decodeEntities(body.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const text = fullText.slice(0, 12000);
  const links = [], linkLabels = {};
  for (const match of clean.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    try {
      const href = new URL(decodeEntities(match[1] ?? match[2] ?? match[3]), url);
      href.hash = '';
      if (!['http:', 'https:'].includes(href.protocol) || /\.(zip|png|jpe?g|gif|svg|mp4)$/i.test(href.pathname)) continue;
      const label = decodeEntities(match[4].replace(/<[^>]*>/g, ' '));
      links.push(href.href);
      linkLabels[href.href] = label.slice(0, 200);
    } catch { /* Ignore malformed or non-HTTP links. */ }
  }
  return { url, title, text, truncated: fullText.length > 12000, links: [...new Set(links)].filter(link => link !== url).slice(0, 200), linkLabels };
}

export async function fetchPublicPage(value, { signal, lookupImpl = lookup, requestImpl = (url, options, callback) => (url.protocol === 'https:' ? https : http).request(url, options, callback) } = {}) {
  const timed = AbortSignal.timeout(15000);
  const combined = signal ? AbortSignal.any([signal, timed]) : timed;
  let url = publicSiteUrl(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    combined.throwIfAborted();
    // Pin the checked IPv4 address to the actual socket. Never forward the model API key.
    const addresses = await new Promise((resolve, reject) => {
      const abort = () => reject(combined.reason);
      combined.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => lookupImpl(url.hostname, { family: 4, all: true })).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort));
    });
    combined.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isPublicIPv4(a.address))) throw new ResearchError('学内・ローカルネットワークのページは取得できません。企業の公開公式サイトを指定してください。', 400);
    const address = addresses[0].address;
    const page = await new Promise((resolve, reject) => {
      const req = requestImpl(url, {
        method: 'GET', signal: combined,
        headers: { 'User-Agent': 'CompanyNote/1.3 (user-requested company research)', Accept: 'text/html,application/xhtml+xml,application/pdf,application/xml,text/plain', 'Accept-Encoding': 'identity' },
        lookup: (_hostname, options, done) => options.all ? done(null, [{ address, family: 4 }]) : done(null, address, 4),
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.destroy(); resolve({ isRedirect: true, redirect: res.headers.location }); return; }
        if (res.statusCode !== 200) { res.destroy(); reject(new ResearchError(`公式サイトを取得できませんでした（HTTP ${res.statusCode}）。別の公開ページを指定してください。`, 422)); return; }
        const type = res.headers['content-type'] || '';
        const pdfType = /application\/pdf/i.test(type) || /\.pdf$/i.test(url.pathname) && /application\/octet-stream/i.test(type);
        if (!(pdfType || /text\/(html|plain|xml)|application\/(xhtml\+xml|xml)/i.test(type)) || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); reject(new ResearchError('このページ形式は未対応です。HTML形式の会社概要・事業ページを指定してください。', 422)); return; }
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > (pdfType ? 12 : 2) * 1024 * 1024) { req.destroy(new ResearchError('公式ページのデータ量が大きすぎます。別のページを指定してください。', 422)); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', async () => {
          const bytes = Buffer.concat(chunks);
          if (pdfType) {
            try { const { extractPdf } = await import('./pdf-text.mjs'); resolve({ parsed: await extractPdf(bytes, url.href) }); } catch { reject(new ResearchError('PDFを読み取れませんでした（暗号化・画像のみ・非対応形式など）。', 422)); }
            return;
          }
          const head = bytes.subarray(0, 4096).toString('ascii');
          const encoding = (type.match(/charset=["']?([^\s;"']+)/i) || head.match(/charset=["']?([^\s;"'/>]+)/i))?.[1] || 'utf-8';
          try { resolve({ html: new TextDecoder(encoding).decode(bytes) }); } catch { resolve({ html: bytes.toString('utf8') }); }
        });
      });
      req.on('error', reject); req.end();
    });
    if (page.isRedirect) {
      if (!page.redirect || redirects === 4) throw new ResearchError('公式サイトの転送先を確認できませんでした。', 422);
      url = publicSiteUrl(new URL(page.redirect, url).href);
      continue;
    }
    return page.parsed || parseCompanyPage(page.html, url.href);
  }
}

export async function collectCompanyPages(url, options = {}) {
  const { crawlCompanySites } = await import('./deep-research.mjs');
  return crawlCompanySites(url, options);
}
