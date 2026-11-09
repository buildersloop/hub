// BuildersLoop Hub — 画面
const $ = (s, el = document) => el.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.flat().forEach((k) => e.append(k)); return e; };
const S = { businesses: [], sessions: [], ui: {}, tabs: [], settings: {}, audit: [], current: '' };
const terms = new Map();   // sessionId -> { term, fit, pane, body, ro }
let focusId = null;

async function api(ch, ...a) {
  const r = await window.hub.invoke(ch, ...a);
  if (!r.ok) { toast(r.error); throw new Error(r.error); }
  return r.value;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 4500); }
const bizOf = (id) => S.businesses.find((b) => b.id === id) || { name: '?', color: '#888' };
const sessOf = (id) => S.sessions.find((s) => s.id === id);

// ---------------------------------------------------------------- 状態の反映
function apply(ov) {
  if (ov.businesses) S.businesses = ov.businesses;
  if (ov.sessions) S.sessions = ov.sessions;
  if (ov.profiles) S.profiles = ov.profiles;
  if (ov.claudePending !== undefined) S.claudePending = ov.claudePending;
  if (ov.ui) S.ui = ov.ui;
  if (ov.settings) S.settings = ov.settings;
  if (S.ui.currentBusiness) S.current = S.ui.currentBusiness;
  // 現在の事業が見つからない（消した・古いデータ）：片付けていない最初の事業にする
  if (S.businesses.length && !S.businesses.some((b) => b.id === S.current)) S.current = (S.businesses.find((b) => !b.archived) || S.businesses[0]).id;
}
function dotClass(s) { return s.status === 'running' ? (s.working ? 'st-working' : 'st-running') : 'st-stopped'; }

// ---------------------------------------------------------------- サイドバー
function renderSide() {
  const side = $('#side');
  side.replaceChildren(
    el('button', { className: 'newbtn', textContent: '＋ 新規セッション', onclick: () => openNewSession() }),
    el('div', { className: 'row', style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px' },
      el('button', { textContent: '＋ 事業', title: '事業を追加', onclick: openBizEditorNew }),
      el('button', { textContent: '🗂 事業の管理' + (S.claudePending ? `（変更案 ${S.claudePending}）` : ''), title: '事業・フォルダ・CLAUDE.md の管理', style: S.claudePending ? 'border-color:#dcdcaa;color:#dcdcaa' : '', onclick: () => openBizManager() }),
      el('button', { textContent: '⚙ セットアップ担当', title: '初期設定（事業・プリセット・リンク・初期ターミナルの構成）を、対話で行う Claude Code を起動', onclick: () => api('session:setupAgent') }),
      el('button', { textContent: '📜 組織のルール', title: '全セッションに渡す、あなたの組織のルール（例：使うアカウント）', style: (S.settings.orgRules || '') ? '' : 'border-color:#dcdcaa;color:#dcdcaa', onclick: openOrgRules }),
      ...(S.profiles || []).map((p) => el('button', { className: 'preset', textContent: `▶ ${p.by === 'agent' ? '🤖 ' : ''}${p.name}`, title: (p.description ? p.description + '\n' : '') + p.sessions.map((s) => `・${s.name}（${bizOf(s.business).name}）`).join('\n'),
        onclick: () => { if (confirm(`プロファイル「${p.name}」を実行します（${p.sessions.length} 件のセッションを一斉に起動／再開）。よいですか？`)) api('session:profileRun', p.name); } }))),
    ...S.businesses.filter((b) => !b.archived).map((b) => {
      const list = S.sessions.filter((s) => s.businessId === b.id);
      const head = el('div', { className: 'biz' + (S.current === b.id ? ' cur' : ''), onclick: () => { S.current = b.id; api('ui:set', { currentBusiness: b.id }); renderSide(); renderAcct(); } },
        el('span', { className: 'caret', textContent: collapsed.has('biz:' + b.id) ? '▸' : '▾', title: 'セッションの一覧を開閉', style: 'width:12px;color:#888', onclick: (e) => { e.stopPropagation(); toggleCollapsed('biz:' + b.id); } }), el('span', { className: 'dot', style: `background:${b.color}` }), el('span', { textContent: b.name, style: 'flex:1' }),
        el('span', { textContent: list.filter((s) => s.status === 'running').length ? `● ${list.filter((s) => s.status === 'running').length}` : '', style: 'color:#4ec9b0;font-size:11px' }));
      const hide = collapsed.has('biz:' + b.id);
      const rows = hide ? [] : list.map((s) => el('div', { className: 'sess' + (S.ui.open?.includes(s.id) ? ' open' : ''), title: (s.role ? `役割：${s.role}\n` : '') + `ID：${s.id}\n` + (s.note || s.cwd) + (s.inbox ? `\n預かっている連絡：${s.inbox} 件` : ''), onclick: () => api('session:openPane', s.id), ondblclick: () => rename(s) },
        el('span', { className: 'dot ' + dotClass(s) }), el('span', { className: 'nm', textContent: (s.kind === 'shell' ? '⌨ ' : '') + s.name }),
        ...(s.inbox ? [el('span', { className: 'inbox', textContent: '📨' + s.inbox, title: `預かっている連絡：${s.inbox} 件（起動して、入力を受けられるようになると渡します）。押すと中身を見られます`, onclick: (e) => { e.stopPropagation(); openInbox(s); } })] : []),
        el('span', { className: 'acts' },
          ...(s.kind === 'claude' ? [el('button', { textContent: '🔌' + ((s.mcp || []).length ? (s.mcp || []).length : ''), title: 'MCP の接続（このセッションで使うサービスを選ぶ）', onclick: (e) => { e.stopPropagation(); openSessionMcp(s); } })] : []),
          el('button', { textContent: '🏷', title: '役割を設定（名簿に出る。他の AI が、あなたの役割を知るために使う）', onclick: (e) => { e.stopPropagation(); const r = prompt('役割（例：セキュリティ）', s.role || ''); if (r !== null) api('session:role', s.id, r); } }),
          s.status === 'running' ? el('button', { textContent: '■', title: '停止', onclick: (e) => { e.stopPropagation(); api('session:stop', s.id); } })
            : el('button', { textContent: '▶', title: '再開（続きから）', onclick: (e) => { e.stopPropagation(); api('session:start', s.id); } }),
          el('button', { textContent: '✕', title: '片付ける', onclick: (e) => { e.stopPropagation(); if (confirm(`「${s.name}」を片付けますか？（停止して、一覧から隠します。会話は残ります）`)) api('session:archive', s.id); } }))));
      const kids = [head, ...rows];
      if (S.current === b.id && !hide) kids.push(bizPanel(b));
      return el('div', {}, ...kids);
    }));
}
const collapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem('bl-collapsed') || '[]')); } catch { return new Set(); } })();
function toggleCollapsed(id) { collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); try { localStorage.setItem('bl-collapsed', JSON.stringify([...collapsed])); } catch { /* 保存できなくても動く */ } renderSide(); }
function bizPanel(b) {
  const fold = el('div', { className: 'fold', textContent: (collapsed.has(b.id) ? '▸ ' : '▾ ') + 'プリセット・リンク・メモ', title: 'クリックで開閉', onclick: () => toggleCollapsed(b.id) });
  if (collapsed.has(b.id)) return el('div', { className: 'bpanel' }, fold);
  const ta = el('textarea', { value: b.note || '', placeholder: '事業のメモ・申し送り', onblur: () => api('business:note', b.id, ta.value) });
  const kids = [];
  if (b.presets?.length) kids.push(el('div', { className: 'row' }, ...b.presets.map((p) => el('button', { className: 'preset', textContent: '▶ ' + (p.by === 'agent' ? '🤖 ' : '') + p.name, title: (p.by === 'agent' ? '【エージェントが作成：内容を確認してください】\n' : '') + p.prompt, onclick: () => api('session:create', { businessId: b.id, name: p.name, kind: 'claude', prompt: p.prompt, preset: p.name }) }))));
  if (b.links?.length) kids.push(el('div', { className: 'row' }, ...b.links.map((l) => el('button', { textContent: '🌐 ' + l.name, onclick: () => { api('browser:open', l.url, b.id); if (S.ui.dock === 'hidden') api('browser:mode', 'dock'); } }))));
  kids.push(ta);
  return el('div', { className: 'bpanel' }, fold, ...kids);
}
function rename(s) { const n = prompt('セッションの名前', s.name); if (n) api('session:rename', s.id, n); }
// 預かっている連絡（停止中・起動の途中に、ほかのセッションから届いたもの）を見る・消す
async function openInbox(s) {
  const items = await api('session:inbox', s.id);
  modal([el('h3', { textContent: `📨 「${s.name}」宛ての預かり（${items.length} 件）` }),
    el('p', { textContent: '起動して、入力を受けられるようになると、まとめて渡します。確認の画面が出ているあいだは渡しません。' }),
    ...items.map((x) => el('pre', { style: 'white-space:pre-wrap;word-break:break-all;background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:8px;max-height:200px;overflow:auto', textContent: `${new Date(x.at).toLocaleString()}\n${x.text}` })),
    el('div', { className: 'btns' },
      el('button', { textContent: '預かりを消す', onclick: async () => { if (confirm('預かっている連絡を、すべて消します。よいですか？（渡されません）')) { await api('session:inboxClear', s.id); closeModal(); toast('消しました'); } } }),
      el('button', { className: 'on', textContent: '閉じる', onclick: closeModal }))]);
}

// ---------------------------------------------------------------- ターミナルの区画
// 表示の仕方：grid＝並べる（今までどおり）／tabs＝タブ（1つずつ。右・下に、もう1つ並べて分割できる）
const openIds = () => (S.ui.open || []).filter((id) => sessOf(id));
function activeId(open = openIds()) { return open.includes(S.ui.active) ? S.ui.active : open[0]; }
function splitInfo(open = openIds()) { const sp = S.ui.split; return sp && open.includes(sp.id) && sp.id !== activeId(open) ? sp : null; }
function visibleIds(open = openIds()) {
  if (S.ui.view !== 'tabs') return open;
  const a = activeId(open), sp = splitInfo(open);
  return a ? (sp ? [a, sp.id] : [a]) : [];
}
let dragging = false;
function renderTabbar() {
  const bar = $('#tabbar');
  const tabsMode = S.ui.view === 'tabs';
  bar.classList.toggle('hidden', !tabsMode);
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === (tabsMode ? 'tabs' : 'grid')));
  if (!tabsMode || dragging) return;
  const open = openIds(), act = activeId(open), sp = splitInfo(open);
  const move = (from, to) => { const o = open.filter((x) => x !== from); o.splice(o.indexOf(to) + (open.indexOf(from) < open.indexOf(to) ? 1 : 0), 0, from); api('ui:set', { open: o }); };
  const tabs = open.map((id) => {
    const s = sessOf(id);
    const t = el('div', { className: 'ptab' + (id === act ? ' active' : '') + (sp && sp.id === id ? ' second' : ''), draggable: true,
      style: `border-left:3px solid ${bizOf(s.businessId).color}`,   // 事業の色（同じ名前のタブが、どの事業か分かるように）
      title: `${s.name}（${bizOf(s.businessId).name}）\nクリック：開く／Ctrl+クリック：分割の相手にする／ドラッグ：並べ替え`,
      onclick: (e) => { if (e.ctrlKey && id !== act) api('ui:set', { split: { id, dir: (sp && sp.dir) || 'h' } }); else api('ui:set', { active: id, ...(sp && sp.id === id ? { split: null } : {}) }); },
      ondragstart: (e) => { dragging = true; e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; },
      ondragend: () => { dragging = false; renderTabbar(); },
      ondragover: (e) => { e.preventDefault(); t.classList.add('over'); }, ondragleave: () => t.classList.remove('over'),
      ondrop: (e) => { e.preventDefault(); t.classList.remove('over'); dragging = false; const from = e.dataTransfer.getData('text/plain'); if (from && from !== id) move(from, id); else renderTabbar(); } },
      el('span', { className: 'dot ' + dotClass(s) }), el('span', { className: 'tn', textContent: s.name }),
      ...(s.inbox ? [el('span', { className: 'inbox', textContent: '📨' + s.inbox })] : []),
      el('b', { textContent: '✕', title: 'タブを閉じる（会話は動いたまま）', onclick: (e) => { e.stopPropagation(); api('session:closePane', id); } }));
    return t;
  });
  const dirBtn = (label, dir, title) => el('button', { textContent: label, title, className: sp && sp.dir === dir ? 'on' : '', onclick: () => {
    const other = (sp && sp.id) || open.find((x) => x !== act);
    if (!other) return toast('分割するには、もう1つ、開いているセッションが要ります');
    api('ui:set', { split: { id: other, dir } }); } });
  // タブが多いときは、タブの列だけを横に動かす（分割のボタンは、いつも右端に見える）
  const prevLeft = (bar.querySelector('.ptabs') || {}).scrollLeft || 0;
  const strip = el('div', { className: 'ptabs', onwheel: (e) => { if (e.deltaY && !e.shiftKey) { strip.scrollLeft += e.deltaY; e.preventDefault(); } } }, ...tabs);
  bar.replaceChildren(strip, dirBtn('◫ 右に分割', 'h', '開いているタブを、左右に並べる（Ctrl+クリックで、相手を選べます）'), dirBtn('⬓ 下に分割', 'v', '上下に並べる'),
    ...(sp ? [el('button', { textContent: '✕ 分割を解除', onclick: () => api('ui:set', { split: null }) })] : []));
  strip.scrollLeft = prevLeft;
  if (act !== renderTabbar.lastAct) {
    renderTabbar.lastAct = act;
    const actTab = strip.querySelector('.ptab.active');
    if (actTab) actTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
function renderPanes() {
  const open = openIds();
  const vis = visibleIds(open);
  const grid = $('#grid');
  const tabsMode = S.ui.view === 'tabs';
  const sp = tabsMode ? splitInfo(open) : null;
  grid.style.gridTemplateColumns = tabsMode ? (sp && sp.dir === 'h' ? 'repeat(2, minmax(0,1fr))' : 'minmax(0,1fr)') : `repeat(${Math.min(S.ui.cols || 2, Math.max(1, open.length))}, minmax(0,1fr))`;
  grid.style.gridTemplateRows = tabsMode && sp && sp.dir === 'v' ? 'repeat(2, minmax(0,1fr))' : '';
  $('#empty').classList.toggle('hidden', open.length > 0);
  renderTabbar();
  for (const [id, t] of terms) if (!open.includes(id)) { t.ro.disconnect(); t.term.dispose(); t.pane.remove(); terms.delete(id); }
  for (const id of open) {
    const s = sessOf(id);
    let t = terms.get(id);
    if (!t) t = makePane(s);
    t.pane.classList.toggle('focus', focusId === id);
    t.pane.classList.toggle('hidden', !vis.includes(id));   // タブ表示のとき、見えていないタブは隠す（端末は、そのまま動いている）
    $('.pn', t.pane).textContent = `${s.name}　— ${bizOf(s.businessId).name}`;
    $('.dot', t.pane).className = 'dot ' + dotClass(s);
    t.over.classList.toggle('hidden', s.status === 'running');
    const le = s.lastExit;
    $('.ovt', t.over).textContent = s.status === 'running' ? '' : !le ? '停止中'
      : le.reason === 'app-quit' ? '停止中（アプリを閉じたため止まりました。続きから再開できます）'
        : le.reason === 'stopped' ? '停止中（停止しました。続きから再開できます）'
          : `停止中（セッションが終了しました。終了コード ${le.code}）`;
    if (grid.children[open.indexOf(id)] !== t.pane) grid.insertBefore(t.pane, grid.children[open.indexOf(id)] || null);   // 順序が違うときだけ動かす
  }
  fitAll();
}
function makePane(s) {
  const term = new Terminal({ fontFamily: 'Cascadia Mono, Consolas, "Yu Gothic UI", monospace', fontSize: 13, cursorBlink: true, scrollback: 8000, allowProposedApi: true,
    theme: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#4ec9b0', selectionBackground: '#264f78' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const over = el('div', { className: 'pover' }, el('div', { className: 'ovt' }), el('button', { textContent: '▶ 続きから再開', onclick: () => api('session:start', s.id) }));
  const body = el('div', { className: 'pbody' }, over);
  const pane = el('div', { className: 'pane', onmousedown: () => { focusId = s.id; document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('focus', p === pane)); term.focus(); } },
    el('div', { className: 'phead', title: COPY_HELP }, el('span', { className: 'dot' }), el('span', { className: 'pn' }),
      el('button', { textContent: '■', title: '停止', onclick: () => api('session:stop', s.id) }),
      el('button', { textContent: '✕', title: '区画を閉じる（会話は動いたまま）', onclick: () => api('session:closePane', s.id) })), body);
  $('#grid').append(pane);
  term.open(body);
  const t = { userAt: 0, replaying: false };
  // Ctrl+C：文字を選んでいるときは「コピー」、選んでいないときは、今までどおり中断（Ctrl+Shift+C は、いつでもコピー）
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey || e.code !== 'KeyC') return true;
    if (!term.hasSelection() && !e.shiftKey) return true;
    if (term.hasSelection()) { copyText(term.getSelection()); term.clearSelection(); }
    return false;
  });
  // 端末の中のプログラムが「コピー」を頼んだとき（OSC 52）。Claude Code は、画面全体の表示のとき、自分で選んだ文字を、これでコピーする。
  // 書き込みだけ受け付ける。読み出し（"?"）には答えない（クリップボードの中身を、端末の中のプログラムに渡さない）。
  // 受け付けるのは、Claude Code のセッションで、人がこの区画を直前（5 秒以内）に操作したときだけ。記録の再生中（区画を開き直したとき）は受け付けない。
  // シェルに出た、信頼できない出力（ファイルの表示など）が、クリップボードを書き換えないように。
  term.parser.registerOscHandler(52, (data) => {
    if (s.kind !== 'claude' || t.replaying || Date.now() - t.userAt > 5000) return true;
    const i = String(data).indexOf(';');
    const b64 = i >= 0 ? String(data).slice(i + 1) : '';
    if (!b64 || b64 === '?' || b64.length > 1400000) return true;
    try { const bin = atob(b64); const txt = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); if (txt) copyText(txt); } catch { /* 壊れた値は無視 */ }
    return true;
  });
  // 右クリック：選んだ文字があればコピー、なければ貼り付け（Windows の端末と同じ）。
  // ただし、端末の中のプログラムがマウスを使っているとき（Claude Code の画面全体の表示）は、貼り付けない（そのプログラムが、右クリックを受け取る）。
  // シェルへの複数行の貼り付けは、そのまま実行されるので、確かめる。
  body.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) { copyText(term.getSelection()); term.clearSelection(); return; }
    if (term.modes && term.modes.mouseTrackingMode && term.modes.mouseTrackingMode !== 'none') return;
    try {
      const r = await window.hub.invoke('ui:paste');
      if (!r.ok || !r.value) return;
      if (s.kind !== 'claude' && /[\r\n]/.test(r.value) && !confirm('改行を含む文を貼り付けます。シェルでは、そのまま実行されます。よいですか？\n\n' + r.value.slice(0, 300))) return;
      term.paste(r.value);
    } catch { /* 貼り付けできなくても、何もしない */ }
  });
  // Ctrl+V の貼り付けも、シェルに改行を含む文を貼るときは確かめる（xterm より先に受け取る）
  body.addEventListener('paste', (e) => {
    const v = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (s.kind !== 'claude' && /[\r\n]/.test(v) && !confirm('改行を含む文を貼り付けます。シェルでは、そのまま実行されます。よいですか？\n\n' + v.slice(0, 300))) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // 人がこの区画を操作した時刻（OSC 52 の受け付けに使う）
  const touch = () => { t.userAt = Date.now(); };
  body.addEventListener('mousedown', touch, true);
  body.addEventListener('mouseup', touch, true);
  body.addEventListener('keydown', touch, true);
  term.onData((d) => window.hub.invoke('pty:write', s.id, d));
  term.onResize(({ cols, rows }) => window.hub.invoke('pty:resize', s.id, cols, rows));
  const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* 非表示中 */ } });
  ro.observe(body);
  Object.assign(t, { term, fit, pane, body, over, ro });
  terms.set(s.id, t);
  // これまでの出力を描き直す（そのあいだは、OSC 52 などの「動作」を受け付けない）
  window.hub.invoke('pty:snapshot', s.id).then((r) => {
    if (r.ok && r.value) { t.replaying = true; term.write(r.value, () => { t.replaying = false; }); }
    setTimeout(() => { try { fit.fit(); } catch {} }, 50);
  });
  return t;
}
const COPY_HELP = '文字のコピー：ドラッグで選んで Ctrl+C か右クリック。\nClaude Code の画面でドラッグしても選べないときは、Shift を押しながらドラッグ。\n貼り付け：Ctrl+V か右クリック（何も選んでいないとき）。';
async function copyText(text) {
  try { const r = await window.hub.invoke('ui:copy', text); if (r.ok) { toast('コピーしました'); return; } } catch { /* 下の方法へ */ }
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); return; } catch { /* 下の方法へ */ }
  const ta = el('textarea', { value: text, style: 'position:fixed;left:-9999px' });
  document.body.append(ta); ta.select();
  try { document.execCommand('copy'); toast('コピーしました'); } catch { toast('コピーできませんでした'); }
  ta.remove();
}
function fitAll() { requestAnimationFrame(() => { terms.forEach((t) => { try { t.fit.fit(); } catch {} }); sendBounds(); }); }

// ---------------------------------------------------------------- ブラウザ（右のドック／小さな窓）
function renderDock() {
  const mode = S.ui.dock || 'dock';
  document.body.classList.toggle('dock-hidden', mode === 'hidden');
  document.body.classList.toggle('dock-mini', mode === 'mini');
  document.documentElement.style.setProperty('--dockw', (S.ui.dockWidth || 560) + 'px');
  document.querySelectorAll('[data-dock]').forEach((b) => b.classList.toggle('on', b.dataset.dock === mode));
  document.querySelectorAll('[data-cols]').forEach((b) => b.classList.toggle('on', Number(b.dataset.cols) === (S.ui.cols || 2)));
  const tabs = $('#tabs');
  tabs.replaceChildren(...S.tabs.map((t) => el('div', { className: 'tab' + (t.active ? ' active' : ''), title: t.url, onclick: () => api('browser:activate', t.id) },
    el('span', { textContent: (t.loading ? '⏳ ' : '') + (t.title || t.url || '新しいタブ') }), el('b', { textContent: '✕', onclick: (e) => { e.stopPropagation(); api('browser:close', t.id); } }))));
  const a = S.tabs.find((t) => t.active);
  if (a && document.activeElement !== $('#url')) $('#url').value = a.url === 'about:blank' ? '' : a.url;
  renderAcct();
  requestAnimationFrame(sendBounds);
}
function renderAcct() {
  const first = String(S.settings.orgRules || '').split('\n').map((l) => l.replace(/^[-*・]\s*/, '').trim()).find(Boolean);
  $('#acct').textContent = `ログイン領域：${bizOf(S.current).name}（事業ごとに分離）` + (first ? `　※${first}` : '');
}
function sendBounds() {
  const r = $('#browserHost').getBoundingClientRect();
  window.hub.invoke('browser:bounds', { x: r.left, y: r.top, width: r.width, height: r.height });
}

// ---------------------------------------------------------------- モーダル
function modal(content) {
  const m = $('#modal');
  m.replaceChildren(el('div', { className: 'card' }, content));
  m.classList.remove('hidden');
  window.hub.invoke('browser:visible', false);
}
function closeModal() { $('#modal').classList.add('hidden'); window.hub.invoke('browser:visible', true); setTimeout(sendBounds, 30); }
function openNewSession() {
  const b0 = bizOf(S.current);
  const biz = el('select', {}, ...S.businesses.filter((b) => !b.archived).map((b) => el('option', { value: b.id, textContent: b.name, selected: b.id === S.current })));
  const name = el('input', { placeholder: '例：毎日のループ' });
  const kind = el('select', {}, el('option', { value: 'claude', textContent: 'Claude Code（会話を保存・再開できる）' }), el('option', { value: 'shell', textContent: 'シェル（PowerShell）' }));
  const preset = el('select', {}, el('option', { value: '', textContent: '（なし）' }));
  const prompt = el('textarea', { placeholder: '最初の指示（任意）。外部への送信・公開は、指示の中でも、人の承認が要ります。' });
  const refill = () => { const b = bizOf(biz.value); preset.replaceChildren(el('option', { value: '', textContent: '（なし）' }), ...(b.presets || []).map((p, i) => el('option', { value: i, textContent: p.name }))); };
  refill();
  biz.onchange = refill;
  preset.onchange = () => { const p = (bizOf(biz.value).presets || [])[preset.value]; if (p) { prompt.value = p.prompt; if (!name.value) name.value = p.name; } };
  modal([el('h3', { textContent: '新規セッション' }), el('label', { textContent: '事業' }), biz, el('label', { textContent: '名前' }), name, el('label', { textContent: '種類' }), kind,
    el('label', { textContent: 'プリセット' }), preset, el('label', { textContent: '最初の指示' }), prompt,
    el('div', { className: 'btns' }, el('button', { textContent: 'キャンセル', onclick: closeModal }),
      el('button', { className: 'on', textContent: '作成して起動', onclick: async () => { closeModal(); await api('session:create', { businessId: biz.value, name: name.value || undefined, kind: kind.value, prompt: prompt.value || undefined }); } }))]);
  name.focus();
}
async function openMcp() {
  const info = await api('mcp:info');
  modal([el('h3', { textContent: 'MCP：エージェントがこのアプリを操作する窓口' }),
    el('p', { textContent: `このアプリは、127.0.0.1:${info.port} で、MCP サーバーを開いています（この PC からのみ・トークン必須）。次のコマンドを、ターミナルで 1 回実行すると、Claude Code から、セッションの作成・読み取り・送信、ブラウザの操作、画面の撮影ができます。` }),
    el('code', { textContent: info.cmd.replace(/Bearer [0-9a-f]+/, 'Bearer ●●●●●●（コピーすると、本物が入ります）') }),
    el('p', { textContent: '※ 承認・確認だけの入力（y・はい・Enter のみ等）は、MCP から送れません。Claude Code の権限の承認は、人が、この画面で行います。' }),
    el('div', { className: 'btns' }, el('button', { textContent: 'コマンドをコピー', onclick: async () => { await api('mcp:copyCommand'); toast('コピーしました'); } }), el('button', { className: 'on', textContent: '閉じる', onclick: closeModal }))]);
}

// ---------------------------------------------------------------- 組織のルール（人だけが変える。全セッションの自己紹介・セットアップ担当・CLAUDE.md の雛形に入る）
function openOrgRules() {
  const ta = el('textarea', { value: S.settings.orgRules || '', style: 'height:180px', placeholder: '1 行に 1 つ。例：\n使うアカウントは example-work のみ（個人のアカウントは使わない）。\n外部への投稿・送信は、内容を見せて、名指しの承認のあとだけ。' });
  modal([el('h3', { textContent: '📜 組織のルール' }),
    el('p', { textContent: 'ここに書いたルールは、Hub が起動するすべての Claude Code（自己紹介）・セットアップ担当・CLAUDE.md の雛形に入ります。エージェント（MCP）からは、読めますが、変えられません。' }),
    ta,
    el('p', { style: 'color:#8a8a8a;font-size:12px', textContent: '変えたあとに起動・再開したセッションから効きます（動いているセッションには、届きません）。2000 文字まで。' }),
    el('div', { className: 'btns' }, el('button', { textContent: 'キャンセル', onclick: closeModal }),
      el('button', { className: 'on', textContent: '保存', onclick: async () => {
        const r = await window.hub.invoke('settings:orgRules', ta.value);
        if (!r.ok) return toast(r.error);
        S.settings = r.value; closeModal(); renderSide(); renderAcct(); toast('保存しました'); } }))]);
  ta.focus();
}

// ---------------------------------------------------------------- 事業の管理（事業・フォルダ・CLAUDE.md）
function lineDiff(a, b) {   // 行単位の差分（LCS）。戻り値：[{t:' '|'+'|'-', s}]
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 4_000_000) return [{ t: ' ', s: '（差分が大きすぎるため、全文を比較してください）' }];
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] }); else out.push({ t: '+', s: B[j++] });
  }
  while (i < A.length) out.push({ t: '-', s: A[i++] });
  while (j < B.length) out.push({ t: '+', s: B[j++] });
  return out;
}
const fmtTime = (t) => new Date(t).toLocaleString('ja-JP', { hour12: false });

async function openBizEditorNew() {
  const f = (ph) => el('input', { placeholder: ph });
  const id = f('id（英小文字・数字・-・_ ／ 例：newapp）'), name = f('名前（例：新しいアプリ）'), cwd = f('作業フォルダ（実在するフォルダ。例：C:\\work\\newapp）');
  const color = el('input', { type: 'color', value: '#9cdcfe' }), note = el('textarea', { placeholder: '事業のメモ（任意）' });
  modal([el('h3', { textContent: '＋ 事業を追加' }), el('label', { textContent: 'id' }), id, el('label', { textContent: '名前' }), name, el('label', { textContent: '作業フォルダ' }), cwd,
    el('label', { textContent: '色' }), color, el('label', { textContent: 'メモ' }), note,
    el('p', { textContent: '追加したあと、「事業の管理」で、CLAUDE.md の雛形を入れられます。' }),
    el('div', { className: 'btns' }, el('button', { textContent: 'キャンセル', onclick: closeModal }),
      el('button', { className: 'on', textContent: '追加', onclick: async () => { const r = await window.hub.invoke('business:upsert', { id: id.value.trim(), name: name.value.trim(), cwd: cwd.value.trim() || undefined, color: color.value, note: note.value });
        if (!r.ok) return toast(r.error); closeModal(); S.current = id.value.trim(); await api('ui:set', { currentBusiness: S.current }); openBizManager(S.current); } }))]);
  id.focus();
}

async function openBizManager(bid) {
  const all = S.businesses;
  if (!all.length) return;
  const cur = all.find((b) => b.id === (bid || S.current)) || all[0];
  const sel = el('select', {}, ...all.map((b) => el('option', { value: b.id, textContent: b.name + (b.archived ? '（片付け済み）' : ''), selected: b.id === cur.id })));
  sel.onchange = () => openBizManager(sel.value);
  const name = el('input', { value: cur.name }), cwd = el('input', { value: cur.cwd }), color = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur.color) ? cur.color : '#9cdcfe' });
  const note = el('textarea', { value: cur.note || '' });
  const save = el('button', { className: 'on', textContent: '保存', onclick: async () => {
    const r = await window.hub.invoke('business:upsert', { id: cur.id, name: name.value, cwd: cwd.value, color: color.value, note: note.value });
    if (!r.ok) return toast(r.error); toast('保存しました'); } });
  const arch = el('button', { textContent: cur.archived ? '一覧に戻す' : '片付ける（隠す）', onclick: async () => {
    if (!cur.archived && !confirm(`「${cur.name}」を、一覧から隠しますか？（消えません。セッションと会話は残ります）`)) return;
    await api('business:archive', cur.id, !cur.archived); closeModal(); } });

  // フォルダ
  const dirs = cur.dirs || [{ label: '作業フォルダ', path: cur.cwd }];
  const dirRows = dirs.map((d, i) => el('div', { style: 'display:flex;gap:6px;align-items:center;margin:3px 0;font-size:12px' },
    el('span', { style: 'color:#8a8a8a;width:110px;flex:none', textContent: d.label }), el('code', { style: 'flex:1;margin:0;padding:3px 6px;user-select:text', textContent: d.path }),
    el('button', { textContent: '開く', onclick: () => api('business:dirOpen', d.path) }),
    i === 0 ? '' : el('button', { textContent: '外す', onclick: async () => { await api('business:dirDelete', cur.id, d.label); openBizManager(cur.id); } })));
  const nl = el('input', { placeholder: 'ラベル（例：ソース（正））', style: 'width:160px' }), np = el('input', { placeholder: 'フォルダのパス', style: 'flex:1' });
  const addDir = el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, nl, np, el('button', { textContent: '追加', onclick: async () => {
    const r = await window.hub.invoke('business:dirUpsert', cur.id, nl.value.trim(), np.value.trim()); if (!r.ok) return toast(r.error); openBizManager(cur.id); } }));

  // CLAUDE.md
  const info = (await window.hub.invoke('business:claudeList', cur.id)).value || { files: [], parents: [], pending: [] };
  const dirSel = el('select', {}, ...info.files.map((f) => el('option', { value: f.dir, textContent: `${f.label}　${f.exists ? `（${f.bytes} バイト）` : '（まだない）'}` })));
  const ta = el('textarea', { style: 'height:220px;font:12px Consolas,monospace;white-space:pre' });
  const status = el('div', { style: 'color:#8a8a8a;font-size:12px;margin:4px 0' });
  const load = async () => {
    const r = await window.hub.invoke('business:claudeGet', cur.id, dirSel.value);
    if (!r.ok) { status.textContent = r.error; ta.value = ''; return; }
    ta.value = r.value.content;
    status.textContent = r.value.exists ? `読み込みました：${r.value.file}` : `まだありません：${r.value.file}（雛形を入れて、保存すると作られます）`;
  };
  dirSel.onchange = load;
  const saveMd = el('button', { className: 'on', textContent: 'CLAUDE.md を保存（バックアップつき）', onclick: async () => {
    if (!confirm('CLAUDE.md を、この内容で書き込みます。以後、その場所で起動する Claude Code が、これを読みます。よいですか？（元の内容は、バックアップに残ります）')) return;
    const r = await window.hub.invoke('business:claudeSet', cur.id, dirSel.value, ta.value);
    if (!r.ok) return toast(r.error); toast(r.value.backup ? '保存しました（バックアップ済み）' : '作成しました'); load(); } });
  const tmpl = el('button', { textContent: '雛形を入れる', onclick: async () => { const r = await window.hub.invoke('business:claudeTemplate', cur.id); if (r.ok) { ta.value = r.value; toast('雛形を入れました（保存するまで、書き込まれません）'); } } });
  const hist = el('button', { textContent: 'バックアップ一覧', onclick: async () => { const r = await window.hub.invoke('business:claudeBackups', cur.id); toast(r.ok && r.value.length ? r.value.slice(0, 5).join(' ／ ') : 'バックアップはまだありません'); } });

  // 提出された変更案（エージェント）
  const pend = el('div', {});
  for (const p of info.pending) {
    const box = el('div', { style: 'border:1px solid #dcdcaa;border-radius:6px;padding:8px;margin:6px 0;background:#2b2a1e' });
    const head = el('div', { style: 'font-size:12px' }, `🤖 ${p.by === 'agent' ? 'エージェント' : p.by} の変更案　${fmtTime(p.at)}　`, el('span', { style: 'color:#8a8a8a', textContent: p.reason || '（理由なし）' }));
    const diffBox = el('pre', { style: 'max-height:220px;overflow:auto;background:#141414;padding:6px;font-size:11px;margin:6px 0;white-space:pre-wrap' });
    const show = el('button', { textContent: '差分を見る', onclick: async () => {
      const r = await window.hub.invoke('business:pendingGet', p.id); if (!r.ok) return toast(r.error);
      diffBox.replaceChildren(...lineDiff(r.value.current, r.value.content).map((l) => el('div', { style: l.t === '+' ? 'background:#1f3a2c;color:#8fe3b0' : l.t === '-' ? 'background:#3a2020;color:#f0a0a0' : 'color:#888', textContent: `${l.t} ${l.s}` })));
      diffBox.title = r.value.file; } });
    const ok = el('button', { className: 'on', textContent: '反映する', onclick: async () => {
      if (!confirm('この変更案を、CLAUDE.md に書き込みます。差分を確認しましたか？（元の内容は、バックアップに残ります）')) return;
      const r = await window.hub.invoke('business:pendingApply', p.id); if (!r.ok) return toast(r.error); toast('反映しました'); openBizManager(cur.id); } });
    const no = el('button', { textContent: '却下', onclick: async () => { await api('business:pendingReject', p.id); openBizManager(cur.id); } });
    box.append(head, el('div', { style: 'font-size:11px;color:#8a8a8a', textContent: p.file || p.dir }), diffBox, el('div', { style: 'display:flex;gap:6px' }, show, ok, no));
    pend.append(box);
  }

  modal([el('h3', { textContent: '事業の管理' }),
    el('div', { style: 'display:flex;gap:6px' }, sel, el('button', { textContent: '＋ 事業を追加', onclick: openBizEditorNew })),
    el('label', { textContent: '名前' }), name, el('label', { textContent: '作業フォルダ' }), cwd, el('label', { textContent: '色' }), color, el('label', { textContent: 'メモ（事業の申し送り）' }), note,
    el('div', { className: 'btns', style: 'justify-content:flex-start' }, save, arch),
    el('h4', { textContent: 'フォルダ（エージェントが読めるのは、ここに登録した中だけ）', style: 'margin:14px 0 4px;color:#8a8a8a' }), ...dirRows, addDir,
    el('h4', { textContent: 'CLAUDE.md（その場所で起動した Claude Code が、最初に読む指示書）', style: 'margin:14px 0 4px;color:#8a8a8a' }),
    info.parents.length ? el('div', { style: 'font-size:12px;color:#dcdcaa', textContent: '親フォルダにも、CLAUDE.md があります（これも読まれます）：' + info.parents.join('、') }) : '',
    dirSel, status, ta, el('div', { className: 'btns', style: 'justify-content:flex-start' }, saveMd, tmpl, hist),
    ...(info.pending.length ? [el('h4', { textContent: `エージェントからの変更案（${info.pending.length} 件）`, style: 'margin:14px 0 4px;color:#dcdcaa' }), pend] : []),
    el('div', { className: 'btns' }, el('button', { className: 'on', textContent: '閉じる', onclick: closeModal }))]);
  load();
}

// ---------------------------------------------------------------- 共同作業ボード
let lastBoard = null;
function badge(b) {
  const n = (b.conflicts || []).length;
  const btn = $('#btnBoard');
  btn.textContent = n ? `⚠ 競合 ${n}` : '共同作業';
  btn.style.background = n ? '#7a2e22' : '';
  btn.style.borderColor = n ? '#e0674d' : '';
}
async function refreshBoard() {
  const r = await window.hub.invoke('ui:board');
  if (r.ok) { lastBoard = r.value; badge(r.value); }
  return lastBoard;
}
function minutes(m) { return m == null ? '' : m < 1 ? 'いま' : `${m}分前`; }
async function openBoard() {
  const b = await refreshBoard();
  if (!b) return;
  const rows = b.sessions.filter((s) => s.status === 'running' || s.editing.length || s.claims.length).map((s) => el('div', { style: 'margin:8px 0;padding:8px;border:1px solid #444;border-radius:6px' },
    el('div', { style: 'font-weight:700' }, `${s.working ? '● ' : '○ '}${s.name}　`, el('span', { style: 'color:#8a8a8a;font-weight:400', textContent: `${bizOf(s.business).name} ／ ${s.status === 'running' ? '動作中' : '停止中'}` })),
    s.doing ? el('div', { style: 'color:#8a8a8a;font-size:12px;margin-top:3px', textContent: '指示：' + s.doing.slice(0, 110) }) : '',
    s.editing.length ? el('div', { style: 'font-size:12px;margin-top:4px', textContent: '編集：' + s.editing.slice(0, 6).map((e) => `${e.path.split(/[\\/]/).slice(-2).join('/')}（${minutes(e.minutesAgo)}）`).join('、') }) : '',
    s.claims.length ? el('div', { style: 'font-size:12px;color:#dcdcaa', textContent: '宣言：' + s.claims.map((c) => c.areas.join('、') + (c.summary ? `（${c.summary}）` : '')).join(' ／ ') }) : '',
    s.commands.length ? el('div', { style: 'font-size:11px;color:#8a8a8a', textContent: '実行：' + s.commands.join(' ｜ ') }) : ''));
  const conf = (b.conflicts || []).map((c) => el('div', { style: 'margin:6px 0;padding:8px;border:1px solid #e0674d;border-radius:6px;background:#3a2420' },
    el('div', { style: 'font-weight:700;color:#e0674d', textContent: `⚠ ${c.kind === 'file' ? '同じファイル' : c.kind === 'area' ? '同じフォルダ' : '宣言の重なり'}：${c.a.name} と ${c.b.name}` }),
    el('div', { style: 'font-size:12px', textContent: c.paths.slice(0, 5).join('\n') })));
  modal([el('h3', { textContent: '共同作業ボード' }),
    el('p', { textContent: '各セッションの会話の記録から、いま何をしているかを自動で読み取っています。同じ場所を触っていたら、競合として出ます。' }),
    ...(conf.length ? conf : [el('p', { style: 'color:#4ec9b0', textContent: '✔ いまのところ、競合はありません。' })]),
    ...(rows.length ? rows : [el('p', { textContent: '動いているセッションがありません。' })]),
    el('div', { className: 'btns' }, el('button', { textContent: '更新', onclick: openBoard }), el('button', { className: 'on', textContent: '閉じる', onclick: closeModal }))]);
}

// ---------------------------------------------------------------- MCP の接続（サービスを選んで、セッションごとにつなぐ）
async function openConnManager() {
  const conns = await api('mcp:conns');
  const cat = await api('mcp:catalog');
  const rows = conns.map((c) => el('div', { style: 'display:flex;gap:6px;align-items:center;margin:4px 0;padding:6px 8px;border:1px solid #444;border-radius:6px' },
    el('div', { style: 'flex:1;min-width:0' },
      el('div', { style: 'font-weight:700', textContent: c.name }),
      el('div', { style: 'font-size:12px;color:#8a8a8a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', textContent: c.type === 'http' ? c.url : `${c.command} ${(c.args || []).join(' ')}` }),
      el('div', { style: 'font-size:12px;color:' + (c.ok ? '#4ec9b0' : '#e0674d'), textContent: c.ok ? '✔ 設定済み' : '⚠ 秘密の値が未設定：' + c.secretNames.filter((n) => !c.secretSet.includes(n)).join('、') })),
    el('button', { textContent: '編集', onclick: () => openConnEditor(c, cat.find((x) => x.id === c.catalogId)) }),
    el('button', { textContent: '削除', onclick: async () => { if (!confirm(`接続「${c.name}」を削除します。使っているセッションからも外れます。よいですか？`)) return; await api('mcp:connDelete', c.id); openConnManager(); } })));
  const sel = el('select', {}, ...cat.map((x) => el('option', { value: x.id, textContent: x.label })));
  const note = el('div', { style: 'font-size:12px;color:#8a8a8a;margin-top:4px', textContent: cat[0].note });
  sel.onchange = () => { note.textContent = cat.find((x) => x.id === sel.value).note; };
  modal([el('h3', { textContent: 'MCP の接続' }),
    el('p', { textContent: 'ここで、つなぐサービスを登録します。どのセッションで使うかは、セッションの行の「🔌」で選びます（セッションごとに、別々に）。秘密の値（トークン）は、この PC の暗号化された場所に保存し、画面にも、AI にも、出しません。' }),
    ...(rows.length ? rows : [el('p', { textContent: 'まだ、接続がありません。下から追加します。' })]),
    el('h4', { textContent: '＋ サービスを追加', style: 'margin:14px 0 4px;color:#8a8a8a' }),
    el('div', { style: 'display:flex;gap:6px' }, sel, el('button', { className: 'on', textContent: '追加', onclick: () => openConnEditor(null, cat.find((x) => x.id === sel.value)) })), note,
    el('div', { className: 'btns' }, el('button', { className: 'on', textContent: '閉じる', onclick: closeModal }))]);
}
function openConnEditor(c, tmpl) {
  tmpl = tmpl || {};
  const type = c ? c.type : tmpl.type;
  const name = el('input', { value: c ? c.name : (tmpl.id && !/^(custom|fetch)/.test(tmpl.id) ? tmpl.id : ''), placeholder: '名前（英数字・-・_）。例：github' });
  const url = el('input', { value: c ? c.url : (tmpl.url || ''), placeholder: 'https://…/mcp' });
  const command = el('input', { value: c ? c.command : (tmpl.command || ''), placeholder: 'コマンド（例：cmd）' });
  const args = el('textarea', { value: (c ? c.args : (tmpl.args || [])).join('\n'), placeholder: '引数（1行に1つ）', style: 'height:84px' });
  const pe = c ? { ...(c.plainEnv || {}) } : {};
  for (const k of tmpl.plainEnvNames || []) if (!(k in pe)) pe[k] = '';
  const plain = el('textarea', { value: Object.entries(pe).map(([k, v]) => `${k}=${v}`).join('\n'), placeholder: '秘密でない環境変数（1行に KEY=値）', style: 'height:60px' });
  const names = el('input', { value: (c ? c.secretNames : (tmpl.secretNames || [])).join(', '), placeholder: type === 'http' ? '秘密の値にするヘッダー名（例：Authorization）' : '秘密の値にする環境変数名（例：GITHUB_PERSONAL_ACCESS_TOKEN）' });
  const box = el('div', {});
  const inputs = {};
  const renderSecrets = () => {
    box.replaceChildren();
    for (const n of names.value.split(',').map((x) => x.trim()).filter(Boolean)) {
      const already = c && (c.secretSet || []).includes(n);
      const inp = inputs[n] || (inputs[n] = el('input', { type: 'password', autocomplete: 'off', spellcheck: false }));
      inp.placeholder = already ? '設定済み（空のままなら、変えません）' : (type === 'http' ? '値（例：Bearer xxxx）' : '値（トークンなど）');
      box.append(el('label', { textContent: n }), inp);
    }
  };
  names.oninput = renderSecrets;
  renderSecrets();
  const save = async () => {
    const secrets = {};
    for (const [k, v] of Object.entries(inputs)) if (v.value && names.value.split(',').map((x) => x.trim()).includes(k)) secrets[k] = v.value;
    const plainEnv = {};
    for (const ln of plain.value.split('\n')) { const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/); if (m && m[2] !== '') plainEnv[m[1]] = m[2]; }
    const payload = { id: c ? c.id : undefined, name: name.value.trim(), catalogId: c ? c.catalogId : (tmpl.id || null), type, secretNames: names.value.split(',').map((x) => x.trim()).filter(Boolean), secrets,
      ...(type === 'http' ? { url: url.value.trim() } : { command: command.value.trim(), args: args.value.split('\n').map((x) => x.trim()).filter(Boolean), plainEnv }) };
    const r = await window.hub.invoke('mcp:connUpsert', payload);
    if (!r.ok) return toast(r.error);
    toast('保存しました（秘密の値は、暗号化して保存）');
    openConnManager();
  };
  modal([el('h3', { textContent: (c ? '接続を編集：' : '接続を追加：') + (tmpl.label || '') }),
    tmpl.note ? el('p', { textContent: tmpl.note }) : '',
    el('label', { textContent: '名前' }), name,
    ...(type === 'http' ? [el('label', { textContent: 'URL' }), url] : [el('label', { textContent: 'コマンド' }), command, el('label', { textContent: '引数（1行に1つ）' }), args, el('label', { textContent: '環境変数（秘密でないもの）' }), plain]),
    el('label', { textContent: type === 'http' ? '秘密にするヘッダー名（カンマ区切り）' : '秘密にする環境変数名（カンマ区切り）' }), names, box,
    el('div', { className: 'btns' }, el('button', { textContent: '戻る', onclick: openConnManager }), el('button', { className: 'on', textContent: '保存', onclick: save }))]);
  name.focus();
}
async function openSessionMcp(s) {
  const info = await api('session:mcpGet', s.id);
  const checks = info.conns.map((c) => ({ c, box: el('input', { type: 'checkbox', checked: info.ids.includes(c.id), style: 'width:auto' }) }));
  modal([el('h3', { textContent: `MCP の接続：${s.name}` }),
    el('p', { textContent: 'このセッションで使うサービスを選びます。選んだものだけが、このセッションにつながります（ほかのセッションには、影響しません）。' }),
    ...(checks.length ? checks.map(({ c, box }) => el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0;color:#d4d4d4;font-size:13px' }, box, el('span', { textContent: `${c.name}　${c.ok ? '' : '（⚠ 秘密の値が未設定）'}` })))
      : [el('p', { textContent: 'まだ、接続がありません。先に「接続」で登録してください。' })]),
    s.status === 'running' ? el('p', { style: 'color:#dcdcaa', textContent: '※ 動いているセッションに反映するには、再起動が要ります（会話は、続きから再開されます）。' }) : '',
    el('div', { className: 'btns' }, el('button', { textContent: '接続の管理', onclick: openConnManager }), el('button', { textContent: 'キャンセル', onclick: closeModal }),
      el('button', { className: 'on', textContent: '保存', onclick: async () => {
        await api('session:mcpSet', s.id, checks.filter((x) => x.box.checked).map((x) => x.c.id));
        closeModal();
        if (s.status === 'running' && confirm('いますぐ、このセッションを再起動しますか？（会話は、続きから再開されます）')) { await api('session:stop', s.id); setTimeout(() => api('session:start', s.id).catch(() => {}), 2500); }
        else toast('保存しました');
      } }))]);
}

// ---------------------------------------------------------------- ログ
function addLog(e) {
  const box = $('#log');
  const t = new Date(e.t).toTimeString().slice(0, 8);
  box.append(el('div', {}, `${t} `, el('span', { className: 'src', textContent: `[${e.source}] ${e.tool}` }), ` ${e.summary}`));
  box.scrollTop = box.scrollHeight;
}

// ---------------------------------------------------------------- 起動
async function init() {
  apply(await api('state:get'));
  (await api('state:get')).audit.forEach(addLog);
  S.tabs = await api('browser:tabs');
  if (S.settings.version) { $('.brand').textContent = `◆ BuildersLoop Hub ${S.settings.version}`; $('.brand').title = S.settings.inheritedFrom ? `${S.settings.inheritedFrom} の設定を引き継いで始めた版` : ''; }
  renderSide(); renderPanes(); renderDock();
  // お知らせ（版の引き継ぎ・自己紹介や MCP を渡せなかったこと）：長めに出す
  const notice = (m) => { toast(m); clearTimeout(toast._t); toast._t = setTimeout(() => $('#toast').classList.add('hidden'), 12000); };
  if ((S.settings.notices || []).length) notice(S.settings.notices.join('　'));
  window.hub.on('ui:notice', notice);
  window.hub.on('pty:data', (id, d) => { const t = terms.get(id); if (t) t.term.write(d); });
  window.hub.on('pty:exit', () => {});
  window.hub.on('session:update', (s) => { const i = S.sessions.findIndex((x) => x.id === s.id); if (i >= 0) S.sessions[i] = s; else S.sessions.push(s); renderSide(); renderPanes(); });
  window.hub.on('ui:update', (ov) => { apply(ov); renderSide(); renderPanes(); renderDock(); });
  window.hub.on('ui:focus', (id) => {
    focusId = id;
    if (S.ui.view === 'tabs' && !visibleIds().includes(id)) { S.ui.active = id; api('ui:set', { active: id }); }   // 左のリストから開いたものを、前面にする
    renderPanes(); const t = terms.get(id); if (t) t.term.focus();
  });
  window.hub.on('browser:tabs', (tabs) => { S.tabs = tabs; renderDock(); });
  window.hub.on('audit:entry', addLog);
  document.querySelectorAll('[data-cols]').forEach((b) => b.onclick = () => api('ui:set', { cols: Number(b.dataset.cols) }));
  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => api('ui:set', { view: b.dataset.view }));
  document.querySelectorAll('[data-dock]').forEach((b) => b.onclick = () => api('browser:mode', b.dataset.dock));
  $('#btnMcp').onclick = openMcp;
  $('#btnConn').onclick = openConnManager;
  $('#btnBoard').onclick = openBoard;
  setInterval(refreshBoard, 5000);
  refreshBoard();
  $('#btnLog').onclick = () => { $('#log').classList.toggle('hidden'); fitAll(); };
  // 左の一覧（サイドバー）を、たたむ／開く。この PC の画面だけに覚える。
  const setSide = (hidden) => {
    document.body.classList.toggle('side-hidden', hidden);
    $('#btnSide').title = hidden ? '左の一覧を開く' : '左の一覧をたたむ';
    try { localStorage.setItem('bl-side-hidden', hidden ? '1' : ''); } catch { /* 覚えられなくても動く */ }
    fitAll();
  };
  let sideHidden = false;
  try { sideHidden = localStorage.getItem('bl-side-hidden') === '1'; } catch { /* 既定は開く */ }
  setSide(sideHidden);
  $('#btnSide').onclick = () => setSide(!document.body.classList.contains('side-hidden'));
  $('#bBack').onclick = () => api('browser:back'); $('#bFwd').onclick = () => api('browser:forward'); $('#bReload').onclick = () => api('browser:reload');
  $('#bNew').onclick = () => api('browser:open', 'about:blank', S.current).then(() => $('#url').focus());
  $('#bMini').onclick = () => api('browser:mode', S.ui.dock === 'mini' ? 'dock' : 'mini');
  $('#url').onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    let v = $('#url').value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = /\s/.test(v) || !v.includes('.') ? 'https://www.google.com/search?q=' + encodeURIComponent(v) : 'https://' + v;
    if (!S.tabs.length) await api('browser:open', v, S.current); else await api('browser:navigate', v);
  };
  window.addEventListener('resize', fitAll);
  new ResizeObserver(sendBounds).observe($('#browserHost'));
  setInterval(async () => {   // 「出力中」の表示を更新（入力中は、触らない）
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement && document.activeElement.tagName)) return;
    if (!$('#modal').classList.contains('hidden')) return;
    const r = await window.hub.invoke('state:get');
    if (r.ok) { apply(r.value); renderSide(); renderPanes(); }
  }, 2000);
  fitAll();
}
init();
