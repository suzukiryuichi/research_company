import { AI_FIELDS, applyResearchDraft, validateResearch, safeUrl, RESEARCH_CATEGORIES } from './model.js';

export function researchReferences(research, key, esc) {
  return (research?.citations?.[key] || []).map(id => {
    const source = research.sources.find(s => s.id === id);
    return source ? `<a class="citation" href="${esc(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer" title="${esc(source.title)}">[${id}]</a>` : '';
  }).join('');
}

export function researchCoverage(coverage, esc) {
  if (!coverage) return '';
  return `<section class="research-coverage"><h3>最終調査の収集範囲</h3><p><strong>${coverage.fetched}件</strong>の本文を取得 / ${coverage.attempted}件を試行・上限${coverage.maxPages}件</p><div class="coverage-categories">${Object.entries(RESEARCH_CATEGORIES).map(([key, label]) => `<span class="${coverage.categories[key] ? 'covered' : 'uncovered'}">${label} <strong>${coverage.categories[key] || '未確認'}</strong></span>`).join('')}</div><p class="coverage-note">サイトマップ ${coverage.sitemapsRead}件・PDF ${coverage.pdfDocuments}件・AI処理 ${coverage.modelCalls}回。${coverage.limitReached ? `上限により未取得の候補が${coverage.pending}件あります。` : '発見した候補の巡回を終了しました。'}取得件数は情報の網羅性を保証しません。</p>${coverage.documents.length ? `<details><summary>取得済みページ（${coverage.documents.length}件）</summary><ul>${coverage.documents.map(d => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a></li>`).join('')}</ul></details>` : ''}${coverage.failures.length ? `<details><summary>取得できなかったページ（${coverage.failures.length}件）</summary><ul>${coverage.failures.map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url)}</a><small>${esc(f.reason)}</small></li>`).join('')}</ul></details>` : ''}${coverage.truncatedDocuments ? `<p class="coverage-note">${coverage.truncatedDocuments}件の長い資料は本文の一部のみ読んでいます。原文も確認してください。</p>` : ''}</section>`;
}

export function researchSources(research, esc) {
  if (!research) return '';
  return `${researchCoverage(research.coverage, esc)}<section class="research-sources"><h3>調査の出典</h3><p class="research-date">最終AI調査：${esc(new Date(research.researchedAt).toLocaleString('ja-JP'))} · ${research.provider === 'Qwen' ? `Qwen / ${esc(research.model || '')} · 公式サイト取得` : 'OpenAI Web検索'}</p><ol>${research.sources.map(s => `<li value="${s.id}"><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><small>${esc(new URL(s.url).hostname)}</small></li>`).join('')}</ol>${research.caveats ? `<p class="research-caveats">${esc(research.caveats)}</p>` : ''}<p class="research-disclaimer">AIによる下書きです。重要な情報や最新の募集条件は、出典の公式ページで確認してください。</p></section>`;
}

export function openResearch({ modal, base, showModal, onApply, onCancel, esc, icon }) {
  let active = true, request, configured = false, provider = 'openai';
  let input = { name: base.name || '', url: base.url || '', additionalUrls: [], maxPages: 24 }, result;
  const dispose = () => {
    active = false; request?.abort();
    modal.removeEventListener('click', click);
    modal.removeEventListener('submit', submit);
    modal.removeEventListener('cancel', cancel);
    modal.removeEventListener('close', dispose);
  };
  const cancel = event => { event?.preventDefault(); dispose(); onCancel(); };
  const header = title => `<div class="modal-header"><div><div class="eyebrow">AI COMPANY RESEARCH</div><h2 id="modal-title">${title}</h2></div><button type="button" class="modal-close" data-ai="cancel" aria-label="閉じる">${icon('close')}</button></div>`;
  const form = (message = '', busy = false) => {
    showModal(`${header('AIで企業を調べる')}<p class="form-intro" id="research-intro">企業名からWeb検索し、出典付きの下書きを作ります。公式サイトを指定すると、同名企業を区別しやすくなります。</p><form id="research-form"><div class="form-grid"><label class="wide">調べたい企業名 <span class="required">必須</span><input name="research-name" required maxlength="100" value="${esc(input.name)}" placeholder="例：トヨタ自動車株式会社" ${busy ? 'disabled' : ''}/></label><label class="wide"><span id="research-url-label">公式サイト（任意）</span><input name="research-url" type="url" maxlength="2048" value="${esc(input.url)}" placeholder="https://" ${busy ? 'disabled' : ''}/></label></div><div id="deep-options" class="deep-options" ${provider === 'qwen' ? '' : 'hidden'}><label>追加の公式・採用・IRサイトURL（任意・1行1件、最大4件）<textarea name="additional-urls" rows="3" placeholder="https://recruit.example.com/&#10;https://example-ir.com/" ${busy ? 'disabled' : ''}>${esc(input.additionalUrls.join('\n'))}</textarea></label><label>収集するページ数<select name="max-pages" ${busy ? 'disabled' : ''}>${[12,24,40].map(n => `<option value="${n}" ${input.maxPages === n ? 'selected' : ''}>最大${n}件${n === 24 ? '（標準）' : ''}</option>`).join('')}</select></label><p>3階層まで分野を分けて巡回し、サイトマップとPDFも確認します。追加URLは対象企業の公式サイトであることを確認してください。</p></div><div class="ai-explainer"><strong>調べること</strong><p>業界・所在地・事業・強み・社風を整理し、面接の質問を提案します。あなたの志望動機や選考状況は変更しません。</p><p id="research-data-note">検索の実行時に企業名・指定URLをOpenAIへ送信します。既存の研究メモは送信しません。APIの従量料金が発生します。</p></div>${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}<div id="research-configuration" class="research-configuration">API設定を確認しています…</div><div class="ai-progress" role="status" ${busy ? '' : 'hidden'}><span class="spinner"></span><div><strong>Webで情報を調べています…</strong><p>${provider === 'qwen' ? 'ページ取得と段階的な整理に数分～最大15分かかることがあります。' : '検索と整理に1〜2分かかることがあります。'}</p></div></div><div class="modal-footer"><button type="button" class="secondary" data-ai="cancel">${busy ? '調査を中断' : '戻る'}</button><button type="submit" class="primary" id="research-submit" ${busy || !configured ? 'disabled' : ''}>${icon('search')}${busy ? '調査中…' : 'Webで調べる'}</button></div></form>`);
    configuration();
  };
  function configuration() {
    const target = modal.querySelector('#research-configuration'); if (!target) return;
    const qwen = provider === 'qwen';
    const intro = modal.querySelector('#research-intro');
    if (intro && qwen) intro.textContent = '公式・採用・IRページを複数階層で調べ、研究室のQwenが分割して読み、結果を統合します。公式サイトURLを入力してください。';
    const deep = modal.querySelector('#deep-options'); if (deep) deep.hidden = !qwen;
    const urlLabel = modal.querySelector('#research-url-label');
    if (urlLabel) urlLabel.textContent = qwen ? '公式サイト（必須）' : '公式サイト（任意）';
    const urlInput = modal.querySelector('[name="research-url"]');
    if (urlInput) urlInput.required = qwen;
    const note = modal.querySelector('#research-data-note');
    if (note && qwen) note.textContent = '公開ページをアプリで取得し、企業名・URL・取得した本文を研究室のQwen APIへ送信します。既存の研究メモは送信しません。Web全体の検索は行いません。';
    if (configured) { target.innerHTML = `<span class="configured-indicator">● ${qwen ? 'Qwen（研究室API）' : 'OpenAI'} / APIキー設定済み（接続は調査時に確認）</span>`; return; }
    if (qwen) {
      target.innerHTML = '<details open><summary>研究室のAPIキーの設定が必要です</summary><p>アプリの .env に RESEARCH_PROVIDER=qwen、RESEARCH_BASE_URL、RESEARCH_MODEL と RESEARCH_API_KEY を設定し、サーバーを再起動してください。APIキーは研究室の管理者から取得し、このPCだけで設定してください。</p></details>';
      return;
    }
    target.innerHTML = `<details open><summary>OpenAI APIキーの設定が必要です</summary><p>アプリのフォルダで <code>.env.example</code> をコピーして <code>.env</code> に変更し、<code>RESEARCH_API_KEY=</code> の後ろにAPIキーを入力してください。保存したらPowerShellでサーバーを再起動してください。</p><p>APIキーは <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAIのAPI管理画面</a> で作成できます。ChatGPTの有料プランとは別のAPI料金がかかります。キーをチャットに貼り付ける必要はありません。</p></details>`;
  }
  function preview() {
    showModal(`${header('調査結果を確認')}<p class="form-intro">${esc(input.name)} の下書きです。取り込む項目を選んでください。記入済みの項目は初期選択していません。</p><form id="research-preview">${AI_FIELDS.map(([key, label]) => `<section class="ai-preview-field"><label><input type="checkbox" name="take" value="${key}" ${!base[key]?.trim() && result.fields[key] ? 'checked' : ''} ${!result.fields[key] ? 'disabled' : ''}/><strong>${label}</strong>${base[key]?.trim() ? '<span class="existing-label">記入済み・選択すると置き換え</span>' : ''}</label><p>${esc(result.fields[key] || '確認できる情報がありませんでした。')}</p>${(result.research.citations[key] || []).map(id => `<a class="citation" href="${esc(result.research.sources.find(s => s.id === id).url)}" target="_blank" rel="noopener noreferrer">[${id}]</a>`).join('')}</section>`).join('')}${researchSources(result.research, esc)}<p id="research-apply-error" class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="secondary" data-ai="back">検索に戻る</button><button type="submit" class="primary">${icon('check')}選んだ項目を編集画面へ</button></div></form>`);
  }
  function click(event) {
    const button = event.target.closest('[data-ai]'); if (!button) return;
    event.stopPropagation();
    if (button.dataset.ai === 'cancel') cancel();
    if (button.dataset.ai === 'back') form();
  }
  async function submit(event) {
    if (!['research-form', 'research-preview'].includes(event.target.id)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.target.id === 'research-preview') {
      const keys = new FormData(event.target).getAll('take');
      if (!keys.length) { modal.querySelector('#research-apply-error').textContent = '取り込む項目を1つ以上選んでください。'; return; }
      try {
        const merged = applyResearchDraft(base, result, keys);
        dispose(); onApply(merged);
      } catch (error) { modal.querySelector('#research-apply-error').textContent = error.message; }
      return;
    }
    if (!configured) return;
    const values = new FormData(event.target);
    input = { name: values.get('research-name').trim(), url: values.get('research-url').trim(), ...(provider === 'qwen' ? { additionalUrls: String(values.get('additional-urls') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean), maxPages: Number(values.get('max-pages')) } : { additionalUrls: [], maxPages: 24 }) };
    if (provider === 'qwen' && (input.additionalUrls.length > 4 || input.additionalUrls.some(value => !safeUrl(value)))) { form('追加URLは有効なHTTP/HTTPSのURLを最大4件まで入力してください。'); return; }
    form('', true);
    request = new AbortController();
    try {
      const response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(provider === 'qwen' ? input : { name: input.name, url: input.url }), signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '調査に失敗しました。');
      if (!active) return;
      if (!data.fields || AI_FIELDS.some(([key]) => typeof data.fields[key] !== 'string')) throw new Error('調査結果の形式が不正です。');
      data.research = validateResearch(data.research);
      result = data;
      preview();
    } catch (error) {
      if (active) form(error.name === 'AbortError' ? '調査を中断しました。' : error instanceof TypeError ? 'サーバーと通信できませんでした。起動状態を確認してください。' : error.message);
    }
  }
  modal.addEventListener('click', click);
  modal.addEventListener('submit', submit);
  modal.addEventListener('cancel', cancel);
  modal.addEventListener('close', dispose);
  form();
  fetch('/api/config').then(async response => {
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!active) return;
    configured = data.researchConfigured === true;
    provider = data.provider || 'openai';
    configuration();
    const button = modal.querySelector('#research-submit'); if (button) button.disabled = !configured;
  }).catch(() => {
    if (active) modal.querySelector('#research-configuration').textContent = 'API設定を確認できません。新しいバージョンのサーバーを起動し直してください。';
  });
}
