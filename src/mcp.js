// アプリ自身を、エージェント（Claude など）が操作するための MCP サーバー（127.0.0.1 のみ・トークン必須）。
// 登録：claude mcp add --transport http --scope user buildersloop-hub http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
const http = require('http');
const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: String(e && e.message ? e.message : e) }] });

function buildServer(hub, ctx) {
  const server = new McpServer({ name: 'buildersloop-hub', version: '0.1.0' });
  const tool = (name, description, shape, fn) => server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try { hub.audit('MCP', name, JSON.stringify(args || {})); return await fn(args || {}); } catch (e) { return fail(e); }
  });
  const B = () => ctx.browser();

  // ---- 全体
  tool('hub_overview', '事業・セッション（状態つき）・画面の状態の一覧。最初にこれを呼ぶ。', {}, async () => text(hub.overview()));

  // ---- セッション（並列の Claude Code／シェル）
  // エージェントが作れるのは、Claude Code のセッションだけ（シェル・任意のコマンドは、人の画面だけ）。作業フォルダは、事業に登録されたフォルダの中だけ。
  tool('session_create', '事業の中に、新しい Claude Code のセッションを作って起動する（シェル・コマンドのセッションは、人が画面で作る）。cwd は、事業に登録されたフォルダの中だけ（省略すると、事業の作業フォルダ）。prompt を渡すと、起動後に最初の指示として入力され、先頭に「【送信元：…】」が付く（from に自分のセッション ID）。外部への送信・公開は、その指示の中でも、人の承認が要る。',
    { business: z.string().describe('事業の id（hub_overview で確認）'), name: z.string().optional(), role: z.string().optional().describe('役割（例：セキュリティ）。名簿に出る'), cwd: z.string().optional(), prompt: z.string().optional(), from: z.string().optional().describe('自分のセッション ID（環境変数 BL_HUB_SESSION）') },
    async (a) => text(hub.createSession({ businessId: a.business, name: a.name, role: a.role, kind: 'claude', cwd: a.cwd, prompt: a.prompt, by: 'agent', from: a.from })));
  tool('session_adopt', '既存の Claude Code の会話を、Hub のセッションとして取り込む（起動はしない）。claude_session_id＝会話の ID（環境変数 CLAUDE_CODE_SESSION_ID）、cwd＝その会話を開始したフォルダ。取り込み後、人が「▶ 続きから再開」で、同じ会話を Hub の中で続けられる（元の会話を終了してから）。',
    { business: z.string(), claude_session_id: z.string(), name: z.string().optional(), cwd: z.string().optional(), note: z.string().optional() },
    async (a) => text(hub.adoptSession({ businessId: a.business, claudeSessionId: a.claude_session_id, name: a.name, cwd: a.cwd, note: a.note }, 'agent')));
  tool('session_list','セッションの一覧（状態：running／stopped、working＝出力中）。', { business: z.string().optional(), include_archived: z.boolean().optional() },
    async (a) => text(hub.d.sessions.filter((s) => (!a.business || s.businessId === a.business) && (a.include_archived || !s.archived)).map((s) => hub.publicSession(s))));
  tool('session_read', 'セッションの様子を読む：Claude Code は、会話の記録（人と Claude の発言・使ったツール）と、画面の末尾。再描画で崩れる画面より、記録のほうが確実。', { id: z.string(), max_chars: z.number().int().min(200).max(20000).optional() },
    async (a) => text(hub.readSession(hub.resolveRef(a.id).id, a.max_chars || 6000)));
  tool('session_send', '仲間（Claude Code のセッション）に、文章を入力して Enter を押す（複数行は貼り付けとして送る）。仲間への連絡は、これを使う（Claude Code の SendMessage は、Hub の仲間に届かない）。**相手が停止中なら、Hub が預かり、相手が起動したときに渡す。** text を空にすると、Enter だけを送る（入力済みの文章の送信用）。シェル・コマンドのセッションには送れない。**承認の語（y・はい・1・OK 等）は常に拒否。画面に権限の確認が出ているときは、Enter・文字の入力を拒否**：権限の承認は、人が画面で行う。',
    { id: z.string().describe('相手：ID・名前・役割のどれか（同じ事業の中を先に探す。複数あれば、候補を返して拒否）'), text: z.string(), enter: z.boolean().optional(), from: z.string().optional().describe('自分のセッション ID（環境変数 BL_HUB_SESSION）。指定すると、先頭に「【送信元：…】」が付く') },
    async (a) => {
      const to = hub.resolveRef(a.id, a.from);
      const body = String(a.text == null ? '' : a.text);
      const r = hub.sendFromAgent(to.id, body.trim() === '' ? body : hub.senderTag(a.from) + body, a.enter !== false, body);
      if (r && r.queued) return text(r.why === 'stopped'
        ? `「${to.name}」は停止中です。送信を預かりました（${r.count} 件目）。相手が起動したときに、自動で渡します。急ぐときは、人に「${to.name}」の再開を頼んでください。`
        : `「${to.name}」は起動の途中です（または、先に預かった送信があります）。送信を預かりました（${r.count} 件目）。入力を受けられるようになったら、順に渡します。`);
      return text(`送信しました（宛先：${to.name}）`);
    });
  tool('whoami', '自分が誰か（名前・役割・ID・事業）と、同じ事業の仲間の一覧。id には、自分のセッション ID（環境変数 BL_HUB_SESSION）を渡す。', { id: z.string() },
    async (a) => { const s = hub.resolveRef(a.id); return text({ you: { id: s.id, name: s.name, role: hub.roleOf(s), business: hub.business(s.businessId)?.name }, peers: hub.directory(s.id).filter((x) => !x.self) }); });
  tool('directory', '名簿：セッションの名前・役割・ID・事業・状態の一覧（会話の内容は含まない）。me に自分の ID を渡すと、同じ事業だけを返す。all=true で全事業。', { me: z.string().optional(), all: z.boolean().optional() },
    async (a) => text(hub.directory(a.me ? hub.resolveRef(a.me).id : undefined, { all: !!a.all })));
  tool('session_key', 'キーを押す：enter・escape・tab・up・down・left・right・ctrl-c。**権限の確認が出ているときの Enter・矢印・Tab は拒否**（escape・ctrl-c の中断は可）。shift-tab（権限モードの切り替え）は、送れない。',
    { id: z.string(), key: z.enum(['enter', 'escape', 'tab', 'up', 'down', 'left', 'right', 'ctrl-c']), times: z.number().int().min(1).max(10).optional() },
    async (a) => { hub.sendKey(hub.resolveRef(a.id).id, a.key, a.times || 1, 'agent'); return text(`${a.key} を送りました`); });
  tool('work_board', '【共同作業】全セッションが、いま何をしているか（直近の指示・編集中のファイル・実行したコマンド・宣言）と、**競合**（同じファイル／同じフォルダを別のセッションが触っている）。作業を始める前に必ず見る。', {},
    async () => text(hub.board()));
  tool('work_claim', '【共同作業】これから編集する場所（ファイル・フォルダ）を宣言する。重なる宣言や、他のセッションの最近の編集があれば、警告が返る（その場合は手を止めて、人に知らせる）。owner には、環境変数 BL_HUB_SESSION の値（Hub のセッション ID）か、自分の名前。',
    { owner: z.string(), areas: z.array(z.string()).min(1), summary: z.string().optional() }, async (a) => text(hub.claim(a)));
  tool('work_release', '【共同作業】宣言を解除する（作業が終わったとき）。owner を指定すると、その所有者の全宣言を、claim_id を指定すると、その 1 件を解除する。',
    { owner: z.string().optional(), claim_id: z.string().optional() }, async (a) => text(hub.release(a)));
  tool('session_interrupt', '実行中の処理を止める（Esc または Ctrl+C）。承認の代わりにはならない。', { id: z.string(), how: z.enum(['esc', 'ctrl-c']).optional() },
    async (a) => { hub.interrupt(hub.resolveRef(a.id).id, a.how || 'esc'); return text('送信しました'); });
  tool('session_resume', '停止中の Claude Code のセッションを、続きから再開する（claude --resume）。シェル・コマンドのセッションは、人が画面で再開する。', { id: z.string() }, async (a) => text(hub.startSession(hub.resolveRef(a.id).id, 'agent')));
  tool('session_stop', 'セッションを停止する（会話は保存され、再開できる）。', { id: z.string() }, async (a) => { hub.stopSession(a.id); return text('停止しました'); });
  tool('session_rename', 'セッションの名前を変える。', { id: z.string(), name: z.string() }, async (a) => { hub.renameSession(a.id, a.name); return text('変更しました'); });
  tool('session_note', 'セッションのメモを書く（人にも見える）。', { id: z.string(), note: z.string() }, async (a) => { hub.setSessionNote(a.id, a.note); return text('保存しました'); });
  tool('session_archive', 'セッションを片付ける（停止して、一覧から隠す）。', { id: z.string() }, async (a) => { hub.archiveSession(a.id); return text('片付けました'); });
  tool('session_focus', '画面で、そのセッションを開く・前面にする。', { id: z.string() }, async (a) => { if (!hub.session(a.id)) throw new Error('セッションがありません'); hub.openPane(a.id); return text('開きました'); });
  tool('business_note', '事業のメモ（申し送り）を書き換える。', { business: z.string(), note: z.string() }, async (a) => { hub.setBusinessNote(a.business, a.note); return text('保存しました'); });
  tool('ui_layout', '画面の列数（1〜4）を変える。', { cols: z.number().int().min(1).max(4) }, async (a) => { hub.setUi({ cols: a.cols }); return text('変更しました'); });

  // ---- 設定（セットアップ担当が使う）。安全に関わる設定は、ここでは変えられない。
  tool('business_upsert', '【設定】事業を追加・更新する。id は英小文字・数字・_・-（2〜30 文字）。新規は name が必要。cwd は、実在するフォルダ。', { id: z.string(), name: z.string().optional(), color: z.string().optional(), cwd: z.string().optional(), note: z.string().optional() },
    async (a) => text(hub.businessUpsert(a, 'agent')));
  tool('preset_upsert', '【設定】事業の定型の指示（プリセット）を追加・更新する。画面では 🤖 が付き、人が内容を確認できる。外部への送信・公開を勝手に行う内容は入れない。', { business: z.string(), name: z.string(), prompt: z.string() },
    async (a) => text(hub.presetUpsert(a, 'agent')));
  tool('preset_delete', '【設定】プリセットを削除する。', { business: z.string(), name: z.string() }, async (a) => text(hub.presetDelete(a)));
  tool('link_upsert', '【設定】事業のリンクを追加・更新する（http／https）。', { business: z.string(), name: z.string(), url: z.string() }, async (a) => text(hub.linkUpsert(a)));
  tool('link_delete', '【設定】リンクを削除する。', { business: z.string(), name: z.string() }, async (a) => text(hub.linkDelete(a)));
  tool('profile_list', '【設定】プロファイル（＝初期ターミナルの構成：開くセッションの一式）の一覧。', {}, async () => text(hub.overview(true).profiles));
  tool('profile_upsert', '【設定】プロファイルを追加・更新する。sessions は、[{business, name, kind: claude|shell, prompt?}]。', {
    name: z.string(), description: z.string().optional(), sessions: z.array(z.object({ business: z.string(), name: z.string().optional(), kind: z.enum(['claude', 'shell']).optional(), prompt: z.string().optional() })).min(1) },
    async (a) => text(hub.profileUpsert(a, 'agent')));
  tool('profile_delete', '【設定】プロファイルを削除する。', { name: z.string() }, async (a) => text(hub.profileDelete(a)));
  tool('profile_run', '【設定】プロファイルを実行して、セッションを一斉に起動する（動作中のものは、そのまま。停止中の同名は、続きから再開）。実行前に、人の了解を得る。', { name: z.string() },
    async (a) => text(hub.profileRun({ name: a.name }, 'agent')));
  tool('settings_get', '【設定】設定の確認（安全に関わるものは、読み取りのみ）。', {}, async () => text(hub.settingsGet()));
  tool('settings_set', '【設定】変えてよい設定だけ変える（coordination：共同作業の約束の自動付与）。agentKeys・claudeArgs・トークン・ポートは、人だけ。', { coordination: z.boolean().optional() },
    async (a) => text(hub.settingsSet(a)));
  tool('business_archive', '【設定】事業を片付ける（一覧から隠す。消えない。archived=false で戻す）。セッションと会話は残る。', { id: z.string(), archived: z.boolean().optional() }, async (a) => text(hub.businessArchive(a)));
  tool('dir_upsert', '【フォルダ】事業のフォルダを登録・更新する（実在するフォルダのみ）。Hub のフォルダの道具（dir_tree・CLAUDE.md の確認と変更案）が扱えるのは、登録されたフォルダの中だけ（Claude Code 自身のファイルの読み書きは、Claude Code の権限の設定で決まる）。', { business: z.string(), label: z.string(), path: z.string() }, async (a) => text(hub.dirUpsert(a)));
  tool('dir_delete', '【フォルダ】登録したフォルダを外す（フォルダ自体は消えない）。', { business: z.string(), label: z.string() }, async (a) => text(hub.dirDelete(a)));
  tool('dir_tree', '【フォルダ】登録フォルダの中の一覧（読み取り専用・深さ 2・最大 150 件・node_modules 等は除く）。', { business: z.string(), dir: z.string().optional(), depth: z.number().int().min(0).max(4).optional() }, async (a) => text(hub.dirTree(a)));
  tool('claudemd_list', '【CLAUDE.md】事業の各フォルダの CLAUDE.md の有無・サイズ・更新日時と、親フォルダの CLAUDE.md、提出済みの変更案。', { business: z.string() }, async (a) => text(hub.claudeMdList(a)));
  tool('claudemd_get', '【CLAUDE.md】CLAUDE.md の中身を読む（dir を省くと作業フォルダ）。', { business: z.string(), dir: z.string().optional() }, async (a) => text(hub.claudeMdGet(a)));
  tool('claudemd_template', '【CLAUDE.md】事業の情報（フォルダ・メモ）と共通のルールから、雛形を作る（ファイルは書かない）。', { business: z.string() }, async (a) => text(hub.claudeMdTemplate(a)));
  tool('claudemd_propose', '【CLAUDE.md】変更案を提出する。**ファイルは書き換わらない**。人が画面（事業の管理）で、差分を見て反映する。reason に、変えたい理由を書く。', { business: z.string(), dir: z.string().optional(), content: z.string(), reason: z.string().optional() },
    async (a) => text(hub.claudeMdPropose(a, 'agent')));
  tool('claudemd_pending', '【CLAUDE.md】提出済みで、まだ反映されていない変更案の一覧。', { business: z.string().optional() }, async (a) => text(hub.claudePendingList(a)));
  tool('setup_agent_start','【設定】「セットアップ担当」（初期設定を行う Claude Code）を、新しいセッションとして起動する。task に、最初に頼むことを書ける（先頭に「【送信元：…】」が付く。from に自分のセッション ID）。', { task: z.string().optional(), from: z.string().optional() },
    async (a) => text(hub.startSetupAgent({ task: a.task, from: a.from }, 'agent')));

  // ---- アプリ内ブラウザ（事業ごとにログインを分離。http／https のみ）
  tool('browser_open', 'アプリ内ブラウザで、新しいタブを開く。business を指定すると、その事業のログイン領域（Cookie）を使う。', { url: z.string(), business: z.string().optional() },
    async (a) => { const id = B().openTab(a.url, a.business || hub.d.ui.currentBusiness || 'default'); return text({ tab: id }); });
  tool('browser_tabs', '開いているタブの一覧。', {}, async () => text(B().info()));
  tool('browser_navigate', '現在（または指定）のタブを、URL へ移動する。', { url: z.string(), tab: z.string().optional() }, async (a) => text(await B().navigate(a.url, a.tab)));
  tool('browser_snapshot', 'ページの内容を取る：タイトル・本文・操作できる要素の一覧（[番号]）。click・type は、この番号で指定する。', { tab: z.string().optional() },
    async (a) => { const s = await B().snapshot(a.tab); return text(`URL: ${s.url}\nタイトル: ${s.title}\n\n--- 操作できる要素 ---\n${s.items.join('\n')}\n\n--- 本文 ---\n${s.text}`); });
  tool('browser_click', '番号の要素をクリックする。', { ref: z.number().int(), tab: z.string().optional() }, async (a) => text(await B().click(a.ref, a.tab)));
  tool('browser_type', '番号の入力欄に文字を入れる（submit=true で Enter）。', { ref: z.number().int(), text: z.string(), submit: z.boolean().optional(), clear: z.boolean().optional(), tab: z.string().optional() },
    async (a) => text(await B().type(a.ref, a.text, { submit: !!a.submit, clear: a.clear !== false }, a.tab)));
  tool('browser_press', 'キーを押す（Enter・Escape・Tab・ArrowDown など）。', { key: z.string(), tab: z.string().optional() }, async (a) => text(await B().press(a.key, a.tab)));
  tool('browser_eval', 'ページ内で JavaScript を実行して、結果を返す。', { code: z.string(), tab: z.string().optional() }, async (a) => text(String(JSON.stringify(await B().evaluate(a.code, a.tab)) ?? 'undefined')));
  tool('browser_screenshot', 'ブラウザの画面を撮る（画像）。', { tab: z.string().optional(), width: z.number().int().min(300).max(1600).optional() },
    async (a) => ({ content: [{ type: 'image', data: await B().screenshot(a.tab, a.width || 900), mimeType: 'image/png' }] }));
  tool('browser_close_tab', 'タブを閉じる。', { tab: z.string() }, async (a) => { B().closeTab(a.tab); return text('閉じました'); });
  tool('browser_mode', 'ブラウザの表示：dock（右に大きく）／mini（右下に小さく）／hidden（隠す）。', { mode: z.enum(['dock', 'mini', 'hidden']) }, async (a) => { hub.setUi({ dock: a.mode }); B().setMode(a.mode); return text('変更しました'); });

  // ---- アプリ全体の画面
  tool('ui_screenshot', 'アプリのウィンドウ全体の画面を撮る（画像）。ターミナル・ブラウザの見た目の確認用。', {},
    async () => { const win = ctx.window(); const img = await win.webContents.capturePage(); const s = img.getSize(); const r = s.width > 1400 ? img.resize({ width: 1400 }) : img; return { content: [{ type: 'image', data: r.toPNG().toString('base64'), mimeType: 'image/png' }] }; });
  return server;
}

function startMcp(hub, ctx, { port, token }) {
  const okHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const srv = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (!okHosts.has(req.headers.host || '')) return send(403, { error: 'host' });           // DNS リバインディング対策
    if (req.headers.origin) return send(403, { error: 'origin' });                            // ブラウザからの呼び出しは拒否
    const auth = req.headers.authorization || '';
    const a = Buffer.from(auth), b = Buffer.from(`Bearer ${token}`);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(401, { error: 'unauthorized' });
    if (!req.url.startsWith('/mcp')) return send(404, { error: 'not found' });
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    let body = '';
    for await (const c of req) { body += c; if (body.length > 2_000_000) return send(413, { error: 'too large' }); }
    let json;
    try { json = JSON.parse(body); } catch { return send(400, { error: 'bad json' }); }
    const server = buildServer(hub, ctx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, json); } catch (e) { if (!res.headersSent) send(500, { error: String(e.message || e) }); }
  });
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}
module.exports = { startMcp };
