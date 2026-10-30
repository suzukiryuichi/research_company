export const STATUSES = ['気になる', '研究中', 'エントリー済', '選考中', '内定', '見送り'];
export const NOTE_FIELDS = [['business', '事業・サービス'], ['strength', '強み・競合との違い'], ['culture', '社風・働き方'], ['motivation', '志望動機・自分との接点'], ['questions', '面接で聞きたいこと']];
export const STORAGE_KEY = 'company-note:v1';
export const AI_FIELDS = [['industry', '業界'], ['location', '所在地'], ['url', '公式サイト'], ['business', '事業・サービス'], ['strength', '強み・競合との違い'], ['culture', '社風・働き方'], ['questions', '面接で聞きたいこと（提案）']];
export const RESEARCH_CATEGORIES = { company: '会社・理念', business: '事業・製品', careers: '採用・働き方', ir: 'IR・経営', sustainability: 'サステナビリティ', news: 'ニュース', general: 'その他' };

export function validateCoverage(value) {
  if (!value || typeof value !== 'object') throw new Error('収集範囲の形式を確認してください。');
  const result = {};
  for (const key of ['attempted', 'fetched', 'maxPages', 'maxDepth', 'discovered', 'pending', 'sitemapsRead', 'modelCalls', 'batches', 'truncatedDocuments', 'pdfDocuments']) {
    const number = value[key] ?? 0;
    if (!Number.isInteger(number) || number < 0 || number > 100000) throw new Error('収集範囲の件数を確認してください。');
    result[key] = number;
  }
  result.limitReached = value.limitReached === true;
  result.categories = {};
  for (const key of Object.keys(RESEARCH_CATEGORIES)) {
    const number = value.categories?.[key] ?? 0;
    if (!Number.isInteger(number) || number < 0 || number > 1000) throw new Error('収集分野の件数を確認してください。');
    result.categories[key] = number;
  }
  for (const key of ['failures', 'documents']) {
    const rows = value[key] ?? [];
    if (!Array.isArray(rows) || rows.length > 100) throw new Error('収集ページの一覧を確認してください。');
    result[key] = rows.map(item => {
      if (!item || !safeUrl(item.url)) throw new Error('収集ページのURLを確認してください。');
      return key === 'failures' ? { url: safeUrl(item.url), reason: String(item.reason || '').slice(0, 300) } : { url: safeUrl(item.url), title: String(item.title || '').slice(0, 300), category: Object.hasOwn(RESEARCH_CATEGORIES, item.category) ? item.category : 'general' };
    });
  }
  return result;
}

export function validateResearch(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.sources) || value.sources.length > 100) throw new Error('AI調査の出典形式を確認してください。');
  if (typeof value.researchedAt !== 'string' || Number.isNaN(Date.parse(value.researchedAt))) throw new Error('調査日時の形式を確認してください。');
  const ids = new Set();
  const sources = value.sources.map(s => {
    if (!s || !Number.isInteger(s.id) || s.id < 1 || ids.has(s.id) || typeof s.url !== 'string' || !safeUrl(s.url) || typeof s.title !== 'string') throw new Error('AI調査の出典を確認してください。');
    ids.add(s.id);
    return { id: s.id, title: s.title.slice(0, 300), url: safeUrl(s.url) };
  });
  const citations = {};
  for (const [key] of AI_FIELDS) {
    const refs = value.citations?.[key] || [];
    if (!Array.isArray(refs) || refs.some(id => !ids.has(id))) throw new Error('AI調査の引用を確認してください。');
    citations[key] = [...new Set(refs)];
  }
  if (value.provider !== undefined && !['OpenAI', 'Qwen'].includes(value.provider)) throw new Error('AI調査のプロバイダーを確認してください。');
  return { sources, citations, researchedAt: new Date(value.researchedAt).toISOString(), provider: value.provider || 'OpenAI', ...(typeof value.model === 'string' ? { model: value.model.slice(0, 200) } : {}), ...(value.coverage ? { coverage: validateCoverage(value.coverage) } : {}), caveats: typeof value.caveats === 'string' ? value.caveats.slice(0, 6000) : '' };
}

export function applyResearchDraft(base, result, keys) {
  const incoming = validateResearch(result.research);
  const previous = base.research ? validateResearch(base.research) : null;
  const sources = previous ? [...previous.sources] : [];
  const map = new Map();
  for (const source of incoming.sources) {
    let found = sources.find(s => s.url === source.url);
    if (!found) { found = { ...source, id: Math.max(0, ...sources.map(s => s.id)) + 1 }; sources.push(found); }
    map.set(source.id, found.id);
  }
  const company = { ...base, name: base.name?.trim() || result.name };
  const citations = { ...(previous?.citations || {}) };
  for (const [key] of AI_FIELDS) {
    if (!keys.includes(key) || typeof result.fields[key] !== 'string') continue;
    company[key] = result.fields[key];
    citations[key] = incoming.citations[key].map(id => map.get(id));
  }
  const used = new Set(Object.values(citations).flat());
  company.research = validateResearch({ ...incoming, sources: sources.filter(s => used.has(s.id)), citations, caveats: [previous?.caveats, incoming.caveats].filter(Boolean).join('\n').slice(0, 6000) });
  return company;
}

export function validateCompanies(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('企業データは1,000件以内の配列にしてください。');
  const ids = new Set();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('企業IDが不正、または重複しています。');
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100) throw new Error('企業名を確認してください。');
    if (!STATUSES.includes(item.status)) throw new Error('選考ステータスを確認してください。');
    const result = { id: item.id, name: item.name.trim(), status: item.status, favorite: item.favorite === true };
    for (const key of ['industry', 'location', 'role', 'url', 'deadline', 'business', 'strength', 'culture', 'motivation', 'questions']) {
      if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error('テキスト項目の形式が不正です。');
      result[key] = (item[key] || '').slice(0, 10000);
    }
    if (result.url && !safeUrl(result.url)) throw new Error('企業URLは http または https で入力してください。');
    if (result.deadline && !validDate(result.deadline)) throw new Error('締切日は実在する日付で入力してください。');
    if (item.research !== undefined) result.research = validateResearch(item.research);
    return result;
  });
}

export function safeUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
export function progress(company) {
  return Math.round(NOTE_FIELDS.filter(([key]) => company[key]?.trim()).length / NOTE_FIELDS.length * 100);
}
export function filterCompanies(companies, { search = '', industry = '', status = '', favorites = false } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return companies.filter(c => (!query || [c.name, c.industry, c.role, c.location].join(' ').toLocaleLowerCase().includes(query)) && (!industry || c.industry === industry) && (!status || c.status === status) && (!favorites || c.favorite));
}
export function daysUntil(value, now = new Date()) {
  if (!value) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(`${value}T00:00:00Z`) - today) / 86400000);
}
export function createSamples() {
  return validateCompanies([
    { id: 'sample-1', name: '株式会社ミドリデザイン', industry: 'IT・通信', location: '東京都', role: 'プロダクト企画', status: '研究中', favorite: true, business: '【サンプル】暮らしを支えるデジタルサービスを企画・開発。', strength: 'ユーザーへの継続的なインタビューを大切にしている。', culture: '職種を越えたチームで課題に向き合う。' },
    { id: 'sample-2', name: 'ソラノ食品株式会社', industry: 'メーカー', location: '大阪府', role: '商品企画', status: '気になる', favorite: false, business: '【サンプル】日々の食事を豊かにする食品メーカー。', questions: '新卒社員が商品開発に関わる機会は？' },
    { id: 'sample-3', name: '株式会社灯コンサルティング', industry: 'コンサルティング', location: '東京都', role: 'コンサルタント', status: '選考中', favorite: true, business: '【サンプル】地域企業の事業づくりを支援。', strength: '戦略から実行まで伴走する。', motivation: '地域の課題解決に取り組んだゼミでの経験を活かしたい。', questions: '入社後の研修と配属の決め方について伺いたい。' },
  ]);
}
