import test from 'node:test';
import assert from 'node:assert/strict';
import { researchQwen, chatEndpoint } from '../qwen-research.mjs';
import { RESEARCH_FIELDS } from '../research.mjs';
import { isPublicIPv4, publicSiteUrl, parseCompanyPage, collectCompanyPages, fetchPublicPage } from '../company-site.mjs';
import { validateCompanies, applyResearchDraft } from '../src/model.js';
import { createServer } from '../server.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const page = { url: 'https://example.com/about', title: '企業A 会社概要', text: '企業Aはソフトウェアを開発しています。'.repeat(20), links: [] };
const summary = () => Object.fromEntries([...RESEARCH_FIELDS.map(key => [key, { text: key === 'url' ? 'https://example.com/' : `${key}の確認内容`, source_ids: [1] }]), ['caveats', '企業自身の説明に基づきます。']]);
const completion = content => ({ choices: [{ finish_reason: 'stop', message: { content } }] });

test('Qwen calls exactly the configured Chat Completions endpoint with retrieved text, not OpenAI Web search', async () => {
  const calls = [];
  const result = await researchQwen({ name: '企業A', url: page.url, motivation: '送信しない個人メモ' }, {
    apiKey: 'lab-test-key', baseUrl: 'https://haisoft.comp.ae.keio.ac.jp/v1/', model: 'qwen3.8-27b',
    collectPages: async () => ({ pages: [page], skipped: 0 }),
    fetchImpl: async (url, options) => { calls.push({ url, options }); return Response.json(completion(JSON.stringify(summary()))); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://haisoft.comp.ae.keio.ac.jp/v1/chat/completions');
  assert.equal(calls[0].options.redirect, 'error');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'qwen3.8-27b');
  assert.equal(body.tools, undefined);
  assert.equal(body.stream, false);
  assert.equal(calls[0].options.body.includes('送信しない個人メモ'), false);
  assert.equal(calls[0].options.body.includes('lab-test-key'), false);
  assert.equal(JSON.parse(body.messages[1].content).pages[0].text, page.text);
  assert.equal(result.research.provider, 'Qwen');
  assert.equal(result.research.model, 'qwen3.8-27b');
  assert.deepEqual(result.research.sources, [{ id: 1, title: page.title, url: page.url }]);
  const merged = applyResearchDraft({ id: 'q', status: '研究中', motivation: '自分の志望動機' }, result, ['business', 'culture']);
  const [saved] = validateCompanies([merged]);
  assert.equal(saved.research.provider, 'Qwen');
  assert.equal(saved.motivation, '自分の志望動機');
  assert.deepEqual(validateCompanies(JSON.parse(JSON.stringify([saved]))), [saved]);
});
test('Qwen requires a lab key and official URL, and rejects insecure or credential-bearing API URLs', async () => {
  assert.throws(() => chatEndpoint('http://example.com/v1'), /HTTPS/);
  assert.throws(() => chatEndpoint('https://user:password@example.com/v1'), /HTTPS/);
  assert.throws(() => chatEndpoint('https://example.com/v1?key=secret'), /HTTPS/);
  await assert.rejects(researchQwen({ name: 'A', url: page.url }, { baseUrl: 'https://example.com/v1' }), error => error.status === 503);
  await assert.rejects(researchQwen({ name: 'A' }, { apiKey: 'test', baseUrl: 'https://example.com/v1' }), error => error.status === 400);
});
test('Qwen accepts fenced JSON after a closed thinking block but rejects truncated and malformed responses', async () => {
  const config = { apiKey: 'test', baseUrl: 'https://example.com/v1', collectPages: async () => ({ pages: [page], skipped: 0 }) };
  const output = `<think>内部の推論</think>\n\`\`\`json\n${JSON.stringify(summary())}\n\`\`\``;
  assert.equal((await researchQwen({ name: 'A', url: page.url }, { ...config, fetchImpl: async () => Response.json(completion(output)) })).fields.business, 'businessの確認内容');
  for (const response of [completion('not json'), { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }]) {
    await assert.rejects(researchQwen({ name: 'A', url: page.url }, { ...config, fetchImpl: async () => Response.json(response) }));
  }
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(researchQwen({ name: 'A', url: page.url }, { ...config, fetchImpl: async () => new Response('private upstream response', { status }) }), error => !error.message.includes('private upstream response'));
  }
});
test('public site collection blocks local, private, reserved and IPv6 destinations before HTTP', async () => {
  for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '192.0.2.1', '198.51.100.2', '203.0.113.1', '224.0.0.1', '255.255.255.255']) assert.equal(isPublicIPv4(ip), false, ip);
  assert.equal(isPublicIPv4('93.184.216.34'), true);
  for (const url of ['file:///etc/passwd', 'https://user:password@example.com', 'https://example.com:3000', 'http://[::1]']) assert.throws(() => publicSiteUrl(url));
  await assert.rejects(fetchPublicPage('https://example.com/', { lookupImpl: async () => [{ address: '127.0.0.1' }] }), error => error.status === 400);
});
test('page parser discovers HTML and PDF links; crawler applies domain restrictions', () => {
  const parsed = parseCompanyPage('<html><title>企業 &amp; 研究</title><script>秘密の指示</script><style>.x{}</style><h1>公開&#x4F01;業情報</h1><a href="/about">会社概要</a><a href="/recruit">採用</a><a href="https://evil.example/about">会社概要</a><a href="/company.pdf">会社概要</a><a href="/about">重複</a></html>', 'https://example.com/');
  assert.equal(parsed.title, '企業 & 研究');
  assert.equal(parsed.text.includes('秘密の指示'), false);
  assert.ok(parsed.text.includes('公開企業情報'));
  assert.deepEqual(parsed.links, ['https://example.com/about', 'https://example.com/recruit', 'https://evil.example/about', 'https://example.com/company.pdf']);
});
test('site collection caps attempts, deduplicates redirects, and continues when secondary pages fail', async () => {
  const calls = [], root = 'https://example.com/';
  const collected = await collectCompanyPages(root, { maxPages: 4, useSitemaps: false, fetchPage: async url => {
    calls.push(url);
    if (url === root) return { ...page, url: root, links: ['one', 'two', 'three', 'four'].map(p => root + p) };
    if (url.endsWith('/one')) throw new Error('Unavailable');
    if (url.endsWith('/two')) return { ...page, url: root };
    return { ...page, url: 'https://example.com/recruit' };
  } });
  assert.equal(calls.length, 4);
  assert.equal(collected.pages.length, 2);
  assert.equal(collected.skipped, 1);
  assert.equal(collected.coverage.limitReached, true);
});
test('page fetch pins the checked public DNS address, strips scripts and rejects private redirects', async () => {
  let calls = 0;
  const requestImpl = (url, options, callback) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers['Accept-Encoding'], 'identity');
    options.lookup(url.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); assert.equal(family, 4); });
    const req = new EventEmitter();
    req.end = () => {
      const res = new PassThrough();
      res.statusCode = 200; res.headers = { 'content-type': 'text/html; charset=utf-8' };
      callback(res); res.end('<title>会社概要</title><main>公開事業情報</main><script>ignored()</script>');
    };
    return req;
  };
  const fetched = await fetchPublicPage('https://example.com/about', { lookupImpl: async () => [{ address: '93.184.216.34' }], requestImpl });
  assert.equal(fetched.title, '会社概要'); assert.ok(fetched.text.includes('公開事業情報')); assert.equal(fetched.text.includes('ignored'), false);
  assert.equal(calls, 1);
  await assert.rejects(fetchPublicPage('https://example.com/', {
    lookupImpl: async host => [{ address: host === 'example.com' ? '93.184.216.34' : '127.0.0.1' }],
    requestImpl: (_url, _options, callback) => {
      const req = new EventEmitter(); req.end = () => { const res = new PassThrough(); res.statusCode = 302; res.headers = { location: 'http://localhost/secret' }; callback(res); }; return req;
    },
  }), error => error.status === 400);
});
test('Qwen HTTP configuration requires a lab key and dispatch preserves provider, base URL and model', async t => {
  let received;
  const server = createServer({ provider: 'qwen', apiKey: 'lab-test-key', research: async (input, options) => { received = options; return { name: input.name }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(`${origin}/api/config`)).json();
  assert.equal(config.provider, 'qwen'); assert.equal(config.requiresOfficialUrl, true); assert.equal(config.researchConfigured, true);
  assert.equal(JSON.stringify(config).includes('lab-test-key'), false);
  const response = await fetch(`${origin}/api/research`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', url: page.url }) });
  assert.equal(response.status, 200);
  assert.equal(received.baseUrl, 'https://haisoft.comp.ae.keio.ac.jp/v1');
  assert.equal(received.model, 'qwen3.8-27b');
});
