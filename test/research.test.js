import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCompany, collectSources, normalizeResearch, validateResearchInput, RESEARCH_FIELDS } from '../research.mjs';
import { applyResearchDraft, validateCompanies } from '../src/model.js';
import { createServer } from '../server.mjs';

const sources = [{ id: 1, title: '公式会社概要', url: 'https://example.com/about' }];
const summary = () => Object.fromEntries([...RESEARCH_FIELDS.map(key => [key, { text: key === 'url' ? 'https://example.com/' : `${key}の調査内容`, source_ids: [1] }]), ['caveats', '企業による説明です。']]);
const searchResponse = () => ({ status: 'completed', output: [
  { type: 'web_search_call', status: 'completed' },
  { type: 'message', content: [{ type: 'output_text', text: '出典に基づく企業研究', annotations: [{ type: 'url_citation', title: sources[0].title, url: sources[0].url }] }] },
] });
const summaryResponse = () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(summary()) }] }] });

test('research performs a required Web search, then structured summarization with source context', async () => {
  const calls = [];
  const result = await researchCompany({ name: '企業A' }, {
    apiKey: 'test-only-not-a-key', now: () => new Date('2026-10-30T00:00:00Z'),
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      calls.push(JSON.parse(options.body));
      return Response.json(calls.length === 1 ? searchResponse() : summaryResponse());
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].tools[0].type, 'web_search');
  assert.equal(calls[0].tool_choice, 'required');
  assert.equal(calls[0].store, false);
  assert.equal(calls[1].text.format.type, 'json_schema');
  assert.deepEqual(JSON.parse(calls[1].input).sources, sources);
  assert.equal(result.name, '企業A');
  assert.equal(result.research.researchedAt, '2026-10-30T00:00:00.000Z');
  assert.deepEqual(result.research.citations.business, [1]);
});
test('rejects empty company names, unsafe URLs and absent credentials without provider calls', async () => {
  assert.throws(() => validateResearchInput({ name: ' ' }), /企業名/);
  assert.throws(() => validateResearchInput({ name: 'A', url: 'javascript:alert(1)' }), /URL/);
  await assert.rejects(researchCompany({ name: 'A' }, { apiKey: '' }), error => error.status === 503);
});
test('search must actually complete and return citations before summarization', async () => {
  let count = 0;
  await assert.rejects(researchCompany({ name: 'A' }, { apiKey: 'test', fetchImpl: async () => { count++; return Response.json({ status: 'completed', output: [] }); } }), error => error.status === 422);
  assert.equal(count, 1);
  const response = searchResponse();
  response.output[1].content[0].annotations.push({ type: 'url_citation', url: 'javascript:alert(1)' }, { type: 'url_citation', ...sources[0] });
  assert.equal(collectSources(response).length, 1);
});
test('unsupported factual claims and unknown citations are omitted from draft', () => {
  const data = summary();
  data.culture = { text: '根拠のない評価', source_ids: [999] };
  data.url = { text: 'javascript:alert(1)', source_ids: [1] };
  const result = normalizeResearch(data, sources, 'A', new Date().toISOString());
  assert.equal(result.fields.culture, '');
  assert.equal(result.fields.url, '');
  assert.deepEqual(result.research.citations.culture, []);
});
test('provider authentication, quota, incomplete output and network errors are actionable and do not leak secrets', async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(researchCompany({ name: 'A' }, { apiKey: 'secret-value', fetchImpl: async () => new Response('secret-value', { status }) }), error => !error.message.includes('secret-value') && (status === 429 ? error.status === 429 : error.status === 502));
  }
  await assert.rejects(researchCompany({ name: 'A' }, { apiKey: 'test', fetchImpl: async () => Response.json({ status: 'incomplete' }) }), /完了/);
  await assert.rejects(researchCompany({ name: 'A' }, { apiKey: 'test', fetchImpl: async () => { throw new Error('secret-value'); } }), /接続/);
});
test('selective import preserves manual notes, user motivation and old source attribution', () => {
  const oldResearch = { provider: 'OpenAI', researchedAt: '2026-10-01T00:00:00Z', sources: [{ id: 1, title: '過去の出典', url: 'https://example.org/old' }], citations: { culture: [1] }, caveats: '' };
  const base = { id: 'one', name: '企業A', status: '選考中', favorite: true, business: '自分のメモ', culture: '既存の社風', motivation: '自分の経験', research: oldResearch };
  const incoming = normalizeResearch(summary(), sources, '企業A', new Date().toISOString());
  const merged = applyResearchDraft(base, incoming, ['strength']);
  assert.equal(merged.business, '自分のメモ');
  assert.equal(merged.culture, '既存の社風');
  assert.equal(merged.motivation, '自分の経験');
  assert.equal(merged.status, '選考中');
  assert.equal(merged.strength, 'strengthの調査内容');
  assert.deepEqual(merged.research.citations.culture, [1]);
  assert.deepEqual(merged.research.citations.strength, [2]);
  const [saved] = validateCompanies([merged]);
  assert.deepEqual(validateCompanies(JSON.parse(JSON.stringify([saved]))), [saved]);
  assert.equal(applyResearchDraft({ status: '気になる' }, incoming, ['business']).name, '企業A');
});
test('HTTP routes expose configuration presence only and reject cross-origin paid requests and .env reads', async t => {
  let calls = 0;
  const server = createServer({ apiKey: 'private-test-key', research: async input => { calls++; return { name: input.name }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(`${origin}/api/config`)).json();
  assert.equal(config.researchConfigured, true);
  assert.equal(JSON.stringify(config).includes('private-test-key'), false);
  for (const path of ['/.env', '/.env.example', '/research.mjs']) assert.equal((await fetch(origin + path)).status, 404);
  const post = extra => fetch(`${origin}/api/research`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ name: '企業A' }) });
  assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post({})).status, 403);
  assert.equal(calls, 0);
  assert.equal((await post({ Origin: origin })).status, 200);
  assert.equal(calls, 1);
  assert.equal((await fetch(`${origin}/api/research`)).status, 405);
});
