import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import { researchCompany, ResearchError } from './research.mjs';
import { researchQwen } from './qwen-research.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
try { loadEnvFile(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
export function createServer({
  provider = process.env.RESEARCH_PROVIDER || 'openai',
  apiKey = process.env.RESEARCH_API_KEY || (provider === 'openai' ? process.env.OPENAI_API_KEY : undefined),
  model = process.env.RESEARCH_MODEL || (provider === 'qwen' ? 'qwen3.8-27b' : 'gpt-4.1'),
  baseUrl = process.env.RESEARCH_BASE_URL || (provider === 'qwen' ? 'https://haisoft.comp.ae.keio.ac.jp/v1' : undefined),
  research,
} = {}) {
const runResearch = research || (provider === 'qwen' ? researchQwen : researchCompany);
let researching = false;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
return http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || '')) { json(res, 403, { error: 'この機能はローカルPCから利用してください。' }); return; }
      if (url.pathname === '/api/config' && req.method === 'GET') { json(res, 200, { researchConfigured: Boolean(apiKey) && ['openai', 'qwen'].includes(provider), model, provider, requiresOfficialUrl: provider === 'qwen' }); return; }
      if (url.pathname !== '/api/research') { json(res, 404, { error: 'Not found' }); return; }
      if (req.method !== 'POST') { json(res, 405, { error: 'POSTリクエストが必要です。' }); return; }
      if (req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: 'アプリの画面から調査を実行してください。' }); return; }
      if (!(req.headers['content-type'] || '').startsWith('application/json')) { json(res, 415, { error: 'JSON形式で送信してください。' }); return; }
      if (researching) { json(res, 429, { error: '別の調査を実行中です。完了後にお試しください。' }); return; }
      researching = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), provider === 'qwen' ? 900000 : 120000);
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', disconnected);
      try {
        const chunks = []; let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 16384) throw new ResearchError('入力が長すぎます。', 413);
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ResearchError('入力の形式を確認してください。', 400); }
        if (!['openai', 'qwen'].includes(provider)) throw new ResearchError('RESEARCH_PROVIDER は qwen または openai を指定してください。', 503);
        const result = await runResearch(input, { apiKey, model, baseUrl, signal: controller.signal });
        if (!res.destroyed) json(res, 200, result);
      } catch (error) {
        if (!res.destroyed) json(res, error instanceof ResearchError ? error.status : 500, { error: error instanceof ResearchError ? error.message : '調査中にエラーが発生しました。もう一度お試しください。' });
      } finally { clearTimeout(timer); res.off('close', disconnected); researching = false; }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end('Method not allowed'); return; }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const allowed = relative === 'index.html' || /^src\/[a-zA-Z0-9._-]+\.(js|css|svg)$/.test(relative);
    if (!allowed) { res.writeHead(404).end('Not found'); return; }
    const content = await readFile(path.join(root, relative));
    res.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch { res.writeHead(404).end('Not found'); }
});
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createServer();
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Company Note listening on port ${server.address().port}`));
}
