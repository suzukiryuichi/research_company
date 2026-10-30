import { STATUSES, NOTE_FIELDS, STORAGE_KEY, validateCompanies, safeUrl, progress, filterCompanies, daysUntil, createSamples, AI_FIELDS } from './model.js';
import { openResearch, researchSources, researchReferences } from './research-ui.js';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  compare: '<path d="M8 3v18M16 3v18M3 8h5M16 16h5M3 16h5M16 8h5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a5 5 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a5 5 0 0 0-4 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-12 5h1m4 0h1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H4v17h17v-6"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14v6Z"/>',
};
const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let companies = [], storageBlocked = false, loadFailed = false;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  companies = saved === null ? createSamples() : validateCompanies(JSON.parse(saved));
} catch { loadFailed = true; }
let state = { view: 'all', search: '', industry: '', status: '', sort: 'default', selected: new Set(), layout: 'cards' };
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let toastTimer;
let editorResearch, editorSnapshot;
function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 4000);
}
function persist(next) {
  if (loadFailed) { toast('保存済みデータを読み込めませんでした。再読み込みするか、バックアップを読み込んでください。'); return false; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); storageBlocked = false; }
  catch { storageBlocked = true; toast('保存できませんでした。ブラウザの保存設定・空き容量を確認してください。'); return false; }
  companies = next; return true;
}
function option(value, current, label = value) { return `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`; }
function navButton(view, name, symbol, count = '') {
  return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-view="${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${name}</span>${count !== '' ? `<span class="nav-count">${count}</span>` : ''}</button>`;
}
function stats() {
  return `<section class="stats" aria-label="企業研究の状況">
    <div class="stat"><div class="stat-icon">${icon('book')}</div><div><span>登録企業</span><p>${companies.length}<small>社</small></p></div></div>
    <div class="stat"><div class="stat-icon sage">${icon('edit')}</div><div><span>研究中</span><p>${companies.filter(c => c.status === '研究中').length}<small>社</small></p></div></div>
    <div class="stat"><div class="stat-icon peach">${icon('heart')}</div><div><span>気になる企業</span><p>${companies.filter(c => c.favorite).length}<small>社</small></p></div></div>
    <div class="stat"><div class="stat-icon lavender">${icon('check')}</div><div><span>研究メモの充実度</span><p>${companies.length ? Math.round(companies.reduce((s, c) => s + progress(c), 0) / companies.length) : 0}<small>%</small></p></div></div>
  </section>`;
}
function shell() {
  if (state.industry && !companies.some(c => c.industry === state.industry)) state.industry = '';
  app.innerHTML = `<aside class="sidebar">
    <a class="brand" href="/" aria-label="Company Note ホーム"><img src="/src/icon.svg" alt=""/><div>Company<span>Note</span><small>自分らしい、一社に出会う。</small></div></a>
    <div class="workspace-label">MY WORKSPACE</div>
    <nav aria-label="メインメニュー">${navButton('all', '企業ノート', 'grid', companies.length)}${navButton('favorites', '気になる企業', 'heart', companies.filter(c => c.favorite).length)}${navButton('compare', '企業を比較', 'compare')}</nav>
    <div class="sidebar-tip"><div class="tip-drawing">✳</div><strong>「知る」が、自信になる。</strong><p>企業の魅力と自分の価値観を、<br/>少しずつ言葉にしてみよう。</p><span>YOUR NEXT CHAPTER ↗</span></div>
    <div class="sidebar-footer"><button data-action="export">${icon('download')}データを書き出す</button><button data-action="import">${icon('upload')}データを読み込む</button><p>このブラウザに自動保存されます</p></div>
  </aside>
  <main>
    <header class="topbar"><div><span class="breadcrumb">マイワークスペース</span><span class="slash">/</span><span>${state.view === 'compare' ? '企業を比較' : state.view === 'favorites' ? '気になる企業' : '企業ノート'}</span></div><span class="private-badge"><span></span> PERSONAL WORKSPACE</span></header>
    <div class="main-content">
      ${(loadFailed || storageBlocked) ? '<div class="warning" role="alert">ブラウザへの保存を利用できません。既存データの読み込みに失敗した場合は、バックアップの読み込みで復元できます。</div>' : ''}
      <section class="page-heading"><div><div class="eyebrow">RESEARCH YOUR FUTURE</div><h1>${state.view === 'compare' ? '比べると、見えてくる。' : state.view === 'favorites' ? '気になる、その先へ。' : '一社ずつ、未来をひらく。'}</h1><p>${state.view === 'compare' ? '同じ視点で企業を並べて、自分にとっての魅力を見つけよう。' : '企業を知る。自分を知る。あなたのための企業研究ノート。'}</p></div><div class="heading-actions"><button class="secondary ai-button" data-action="research">✧ AIで企業研究</button><button class="primary" data-action="add">${icon('plus')}企業を追加</button></div></section>
      ${stats()}
      <div id="view-content"></div>
      <footer class="main-footer"><span>Company Note</span><span>小さな気づきが、納得のいく選択につながる。</span></footer>
    </div>
  </main><input type="file" id="import-file" accept=".json,application/json" hidden/>`;
  renderView();
}
function renderView() {
  const target = document.querySelector('#view-content');
  if (state.view === 'compare') { target.innerHTML = comparison(); return; }
  const industries = [...new Set(companies.map(c => c.industry).filter(Boolean))].sort();
  target.innerHTML = `<section class="notebook"><div class="section-heading"><div><h2>${state.view === 'favorites' ? '気になる企業' : '企業ノート'} <span id="result-count"></span></h2></div><div class="section-caption">あなたの可能性を、ここに集めよう。</div></div>
    <div class="filterbar"><label class="search">${icon('search')}<input id="search" type="search" placeholder="企業名・業界・職種で検索" aria-label="企業を検索" value="${esc(state.search)}"/></label><select id="industry" aria-label="業界で絞り込み">${option('', state.industry, 'すべての業界')}${industries.map(i => option(i, state.industry)).join('')}</select><select id="status" aria-label="ステータスで絞り込み">${option('', state.status, 'すべてのステータス')}${STATUSES.map(s => option(s, state.status)).join('')}</select><select id="sort" aria-label="並び順">${option('default', state.sort, '登録順')}${option('name', state.sort, '企業名順')}${option('progress', state.sort, '研究の充実度順')}${option('deadline', state.sort, '締切が近い順')}</select></div>
    <div id="company-list" class="company-grid"></div><div id="selection-bar"></div></section>
    <section class="research-tip"><div class="research-tip-icon">${icon('book')}</div><div><span>RESEARCH TIP</span><h3>企業の「特徴」を、自分の「やりたい」に結びつけよう。</h3><p>事業内容だけでなく、共感したことや気になったことも残すと、あなたらしい志望動機のヒントに。</p></div><div class="tip-decoration" aria-hidden="true">↗</div></section>`;
  renderCards();
}
function renderCards() {
  const filtered = filterCompanies(companies, { ...state, favorites: state.view === 'favorites' });
  if (state.sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  if (state.sort === 'progress') filtered.sort((a, b) => progress(b) - progress(a));
  if (state.sort === 'deadline') filtered.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  document.querySelector('#result-count').textContent = `${filtered.length}社`;
  document.querySelector('#company-list').innerHTML = filtered.map(card).join('') + ((!state.search && !state.industry && !state.status && state.view === 'all') ? `<button class="add-card" data-action="add"><span>${icon('plus')}</span><strong>新しい企業を見つけたら</strong><p>気になる一社を、ノートに追加しよう</p></button>` : '') + (!filtered.length ? `<div class="empty">${icon('search')}<h3>${companies.length ? '条件に合う企業がありません' : '最初の一社を、ここから。'}</h3><p>${companies.length ? '検索や絞り込み条件を変えてみてください。' : '企業名と気づいたことから、気軽に記録できます。'}</p>${companies.length ? '<button class="secondary" data-action="reset">絞り込みをリセット</button>' : ''}</div>` : '');
  document.querySelector('#selection-bar').innerHTML = state.selected.size ? `<div class="selection-bar"><span><strong>${state.selected.size}社</strong> を選択中 <small>最大3社</small></span><button class="text-button" data-action="clear-selection">選択解除</button><button class="primary" data-view="compare">${icon('compare')}比較する</button></div>` : '';
}
function card(c, index) {
  const p = progress(c), days = daysUntil(c.deadline);
  return `<article class="company-card" style="--card-index:${index}"><div class="card-top"><span class="company-mark mark-${index % 4}">${esc(c.name.replace(/株式会社/g, '').trim().slice(0, 1))}</span><button class="favorite ${c.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${esc(c.id)}" aria-label="${esc(c.name)}を${c.favorite ? 'お気に入りから削除' : 'お気に入りに追加'}" aria-pressed="${c.favorite}">${icon('heart')}</button></div><div class="card-labels"><span>${esc(c.industry || '業界未設定')}</span>${c.id.startsWith('sample-') ? '<span class="sample-label">サンプル</span>' : ''}</div><h3><button data-action="detail" data-id="${esc(c.id)}">${esc(c.name)}</button></h3><p class="card-role">${esc(c.role || '職種未設定')}</p><div class="card-meta"><span>${icon('pin')}${esc(c.location || '所在地未設定')}</span><span class="status status-${STATUSES.indexOf(c.status)}"><i></i>${esc(c.status)}</span></div><div class="progress-heading"><span>研究メモ</span><strong>${p}<small>%</small></strong></div><div class="progress-track"><span style="width:${p}%"></span></div>${c.deadline ? `<p class="deadline ${days < 0 ? 'overdue' : ''}">${icon('calendar')}${esc(c.deadline.replaceAll('-', '/'))} 締切${days < 0 ? '（終了）' : days === 0 ? '（今日）' : days <= 7 ? `（あと${days}日）` : ''}</p>` : '<p class="deadline muted">自分のペースで、研究を進めよう</p>'}<div class="card-bottom"><label class="compare-checkbox"><input type="checkbox" data-compare="${esc(c.id)}" ${state.selected.has(c.id) ? 'checked' : ''}/>比較に追加</label><button class="card-open" data-action="detail" data-id="${esc(c.id)}" aria-label="${esc(c.name)}のノートを開く">${icon('arrow')}</button></div></article>`;
}
function comparison() {
  const selected = companies.filter(c => state.selected.has(c.id));
  const rows = [['industry', '業界'], ['role', '志望職種'], ['location', '所在地'], ['status', 'ステータス'], ['deadline', '応募締切'], ...NOTE_FIELDS];
  return `<section class="notebook"><div class="section-heading"><h2>企業比較 <span>${selected.length} / 3社</span></h2><button class="secondary" data-view="all">企業を選ぶ ${icon('plus')}</button></div>${selected.length ? `<p class="comparison-help">${selected.length < 2 ? 'もう1社追加すると、違いや共通点を比較できます。' : '気づいた違いは各社のノートへ。「自分が大切にしたいこと」を探してみましょう。'}</p><div class="table-scroll"><table><caption class="sr-only">選択した企業の研究内容の比較</caption><thead><tr><th scope="col">比較する項目</th>${selected.map(c => `<th scope="col"><span class="table-company">${esc(c.name)}</span><button class="text-button" data-action="detail" data-id="${esc(c.id)}">ノートを編集 ${icon('edit')}</button><button class="remove-compare" data-action="remove-compare" data-id="${esc(c.id)}" aria-label="${esc(c.name)}を比較から外す">${icon('close')}</button></th>`).join('')}</tr></thead><tbody>${rows.map(([key, label]) => `<tr><th scope="row">${label}</th>${selected.map(c => `<td>${c[key] ? esc(c[key]) : '<span class="not-entered">まだ記入されていません</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('compare')}<h3>気になる企業を、同じ視点で。</h3><p>企業ノートの「比較に追加」から、最大3社を選んでください。</p><button class="primary" data-view="all">企業ノートへ ${icon('arrow')}</button></div>`}</section>`;
}
function showModal(content) { modal.innerHTML = content; if (!modal.open) modal.showModal(); }
const closeButton = `<button type="button" class="modal-close" data-action="close" aria-label="閉じる">${icon('close')}</button>`;
function researchForFields(values) {
  if (!editorResearch) return undefined;
  const citations = { ...editorResearch.citations };
  for (const [key] of AI_FIELDS) if (values[key] !== (editorSnapshot[key] || '')) citations[key] = [];
  const used = new Set(Object.values(citations).flat());
  return { ...editorResearch, citations, sources: editorResearch.sources.filter(s => used.has(s.id)) };
}
function editCompany(id, draft) {
  const existing = companies.find(c => c.id === id);
  const c = draft || existing || { status: '気になる' };
  editorResearch = c.research;
  editorSnapshot = { ...c };
  showModal(`<form id="company-form" data-id="${esc(id || '')}"><div class="modal-header"><div><div class="eyebrow">COMPANY NOTE</div><h2 id="modal-title">${existing ? '企業ノートを編集' : '新しい企業を追加'}</h2></div>${closeButton}</div><p class="form-intro">気になることから、少しずつ。研究メモはあとから追記できます。</p><div class="form-grid"><label class="wide">企業名 <span class="required">必須</span><input name="name" required maxlength="100" placeholder="例：株式会社〇〇" value="${esc(c.name)}"/></label><label>業界<input name="industry" maxlength="100" placeholder="例：IT・通信" list="industries" value="${esc(c.industry)}"/><datalist id="industries">${['IT・通信', 'メーカー', '商社', '金融', 'コンサルティング', 'サービス', '広告・メディア', 'インフラ', '小売', '不動産'].map(i => option(i, '')).join('')}</datalist></label><label>志望職種<input name="role" maxlength="100" placeholder="例：企画・マーケティング" value="${esc(c.role)}"/></label><label>所在地<input name="location" maxlength="100" placeholder="例：東京都" value="${esc(c.location)}"/></label><label>ステータス<select name="status">${STATUSES.map(s => option(s, c.status)).join('')}</select></label><label>企業・採用サイト<input type="url" name="url" placeholder="https://" value="${esc(c.url)}"/></label><label>応募締切<input type="date" name="deadline" min="1900-01-01" max="9999-12-31" value="${esc(c.deadline)}"/></label></div><div class="editor-ai"><span>公開情報の収集をAIに手伝ってもらう</span><button type="button" class="secondary" data-action="research-editor">✧ AIで調べる</button></div><div class="notes-heading"><h3>${icon('book')}研究メモ</h3><span>5つの視点で企業を知ろう</span></div>${NOTE_FIELDS.map(([key, label], i) => `<label class="note-field"><span><small>0${i + 1}</small>${label}</span><textarea name="${key}" rows="3" maxlength="10000" placeholder="${['どんな価値を、誰に届けている？', '他社との違いや、その企業ならではの魅力は？', '大切にしている価値観や、働く環境は？', '自分の経験・価値観と、どこがつながる？', '説明会や面接で、もっと知りたいことは？'][i]}">${esc(c[key])}</textarea></label>`).join('')}${researchSources(c.research, esc)}<p id="form-error" class="form-error" role="alert"></p><div class="modal-footer">${existing ? `<button type="button" class="danger text-button" data-action="delete" data-id="${esc(id)}">この企業を削除</button>` : '<span class="muted">入力内容はこのブラウザに保存されます</span>'}<div><button type="button" class="secondary" data-action="close">キャンセル</button><button type="submit" class="primary">${icon('check')}ノートを保存</button></div></div></form>`);
}
function details(id) {
  const c = companies.find(c => c.id === id); if (!c) return;
  showModal(`<div class="modal-header"><div><div class="eyebrow">${esc(c.industry || 'COMPANY NOTE')}</div><h2 id="modal-title">${esc(c.name)}</h2></div>${closeButton}</div><div class="detail-tags"><span class="status status-${STATUSES.indexOf(c.status)}"><i></i>${esc(c.status)}</span><span>${esc(c.role || '職種未設定')}</span><span>${esc(c.location || '所在地未設定')}</span></div>${c.id.startsWith('sample-') ? '<p class="sample-notice">これは架空の企業のサンプルデータです。実在する企業の情報ではありません。</p>' : ''}<div class="detail-links">${safeUrl(c.url) ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">企業・採用サイト ${icon('external')}</a>` : ''}${c.deadline ? `<span>${icon('calendar')}締切：${esc(c.deadline)}</span>` : ''}</div><div class="detail-progress"><span>研究メモの充実度</span><strong>${progress(c)}%</strong><div class="progress-track"><span style="width:${progress(c)}%"></span></div></div>${NOTE_FIELDS.map(([key, label], i) => `<section class="detail-note"><h3><small>0${i + 1}</small>${label}</h3><p class="${c[key] ? '' : 'not-entered'}">${c[key] ? esc(c[key]) : 'まだ記入されていません。気づいたことを書き留めてみましょう。'}</p>${researchReferences(c.research, key, esc)}</section>`).join('')}${researchSources(c.research, esc)}<div class="modal-footer"><button class="secondary" data-action="close">閉じる</button><button class="primary" data-action="edit" data-id="${esc(c.id)}">${icon('edit')}ノートを編集</button></div>`);
}
function exportData() {
  if (loadFailed) { toast('既存データを読み込めないため、書き出しを中止しました。'); return; }
  const data = JSON.stringify({ version: 1, companies }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `company-note-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('企業ノートを書き出しました');
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action], [data-view]'); if (!button) return;
  const { action, id, view } = button.dataset;
  if (view) { state.view = view; shell(); return; }
  if (action === 'add') editCompany();
  if (action === 'research' || action === 'research-editor') {
    const form = action === 'research-editor' ? document.querySelector('#company-form') : null;
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    const draft = form ? { ...editorSnapshot, ...values, research: researchForFields(values) } : { status: '気になる' };
    const id = form?.dataset.id || undefined;
    openResearch({ modal, base: draft, showModal, esc, icon,
      onApply: company => editCompany(id, { ...company, name: company.name || '' }),
      onCancel: () => form ? editCompany(id, draft) : modal.close(),
    });
  }
  if (action === 'detail') details(id);
  if (action === 'edit') editCompany(id);
  if (action === 'close') modal.close();
  if (action === 'favorite') {
    if (persist(companies.map(c => c.id === id ? { ...c, favorite: !c.favorite } : c))) shell();
  }
  if (action === 'delete') {
    const company = companies.find(c => c.id === id);
    showModal(`<div class="modal-header"><h2 id="modal-title">企業ノートを削除しますか？</h2>${closeButton}</div><p class="confirm-copy">「${esc(company.name)}」の企業情報と研究メモが削除されます。この操作は取り消せません。</p><div class="modal-footer"><button class="secondary" data-action="edit" data-id="${esc(id)}">編集に戻る</button><button class="primary destructive" data-action="confirm-delete" data-id="${esc(id)}">削除する</button></div>`);
  }
  if (action === 'confirm-delete') {
    if (persist(companies.filter(c => c.id !== id))) { state.selected.delete(id); modal.close(); shell(); toast('企業ノートを削除しました'); }
  }
  if (action === 'clear-selection') { state.selected.clear(); renderView(); }
  if (action === 'remove-compare') { state.selected.delete(id); renderView(); }
  if (action === 'reset') { state.search = ''; state.industry = ''; state.status = ''; renderView(); }
  if (action === 'export') exportData();
  if (action === 'import') document.querySelector('#import-file').click();
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { state.search = event.target.value; renderCards(); }
});
document.addEventListener('change', async event => {
  const element = event.target;
  if (['industry', 'status', 'sort'].includes(element.id)) { state[element.id] = element.value; renderCards(); }
  if (element.dataset.compare) {
    if (element.checked && state.selected.size >= 3) { element.checked = false; toast('比較できる企業は最大3社です'); return; }
    element.checked ? state.selected.add(element.dataset.compare) : state.selected.delete(element.dataset.compare);
    renderCards();
  }
  if (element.id === 'import-file' && element.files[0]) {
    const file = element.files[0]; element.value = '';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('5MB以内のファイルを選んでください。');
      const data = JSON.parse(await file.text());
      if (data.version !== 1) throw new Error('対応していないバックアップ形式です。');
      const imported = validateCompanies(data.companies);
      showModal(`<div class="modal-header"><h2 id="modal-title">バックアップを読み込みますか？</h2>${closeButton}</div><p class="confirm-copy">現在の${companies.length}社のノートを、ファイル内の${imported.length}社で置き換えます。必要に応じて、先に現在のデータを書き出してください。</p><div class="modal-footer"><button class="secondary" data-action="close">キャンセル</button><button id="confirm-import" class="primary">置き換えて読み込む</button></div>`);
      document.querySelector('#confirm-import').addEventListener('click', () => {
        const failedBefore = loadFailed; loadFailed = false;
        if (persist(imported)) { state.selected.clear(); state.search = ''; state.industry = ''; state.status = ''; modal.close(); shell(); toast('バックアップを読み込みました'); }
        else loadFailed = failedBefore;
      });
    } catch (error) { toast(error instanceof SyntaxError ? 'JSON形式のバックアップファイルを選んでください。' : error.message); }
  }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'company-form') return;
  event.preventDefault();
  const form = event.target, data = Object.fromEntries(new FormData(form));
  const old = companies.find(c => c.id === form.dataset.id);
  try {
    const research = researchForFields(data);
    const [company] = validateCompanies([{ ...data, ...(research ? { research } : {}), id: old?.id || crypto.randomUUID(), favorite: old?.favorite || false }]);
    const next = old ? companies.map(c => c.id === old.id ? company : c) : [...companies, company];
    validateCompanies(next);
    if (persist(next)) { modal.close(); shell(); toast(old ? 'ノートを更新しました' : '新しい企業を追加しました'); }
  } catch (error) { document.querySelector('#form-error').textContent = error.message; }
});
window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY && event.newValue !== null) {
    try { companies = validateCompanies(JSON.parse(event.newValue)); loadFailed = false; state.selected = new Set([...state.selected].filter(id => companies.some(c => c.id === id))); shell(); toast('別のタブの変更を反映しました'); }
    catch { toast('別のタブのデータを読み込めませんでした。'); }
  }
});
shell();
