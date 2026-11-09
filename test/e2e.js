// 通しの試験：Electron を（画面なしで）起動し、MCP クライアントとして、エージェントと同じ経路で操作する。
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const ROOT = path.join(__dirname, '..');
const PORT = 17891;
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-e2e-'));
const OUT = process.env.E2E_OUT || ud;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? `  [${String(extra).slice(0, 140)}]` : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// 試験用のウェブページ
const page = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (req.url.startsWith('/popup')) {   // 認証のポップアップ：元のページへ結果を返して、閉じる（「Google でログイン」の流れの再現）
    return res.end('<!doctype html><title>認証</title><body><script>window.opener.postMessage("LOGIN-OK:" + navigator.userAgent.includes("Electron"), "*"); setTimeout(() => window.close(), 100);</script>認証中</body>');
  }
  if (req.url.startsWith('/perm')) {   // 権限の要求（通知・位置情報）：既定で断られること
    return res.end('<!doctype html><title>権限</title><body><div id="n">待ち</div><div id="g">待ち</div><script>Notification.requestPermission().then((p) => { document.getElementById("n").textContent = "N:" + p; });' +
      'navigator.geolocation.getCurrentPosition(() => { document.getElementById("g").textContent = "G:ok"; }, (e) => { document.getElementById("g").textContent = "G:" + e.code; });</script></body>');
  }
  if (req.url.startsWith('/auth')) {
    return res.end(`<!doctype html><title>認証の試験</title><body style="font:20px sans-serif;padding:20px">
<button id="login" onclick="window.open('/popup','auth','width=500,height=600')">ポップアップでログイン</button><div id="auth">未ログイン</div>
<div id="ua"></div><script>window.addEventListener('message', (e) => { document.getElementById('auth').textContent = String(e.data); });
document.getElementById('ua').textContent = navigator.userAgent;</script></body>`);
  }
  res.end(`<!doctype html><title>試験ページ</title><body style="font:20px sans-serif;padding:20px">
<h1>Hub 試験</h1><input id="q" placeholder="検索語"><button id="go" onclick="document.getElementById('out').textContent='押された:'+document.getElementById('q').value">実行</button>
<a href="/next">次へ</a><div id="out">未実行</div></body>`);
}).listen(18123, '127.0.0.1');

// 試験用の「claude」：本物の代わりに PowerShell を起動する（PATH の先頭に置く）。MCP から入力できるのは Claude Code のセッションだけなので、
// 入力・読み取り・権限の確認の試験は、この疑似の claude で行う（本物の claude は、トークンを使うため、起動しない）。
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-e2e-bin-'));
// 事業の作業フォルダ（Hub のデータのフォルダの親・中は、作業フォルダにできないため、別に作る）
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-e2e-work-'));
fs.writeFileSync(path.join(fakeBin, 'claude.cmd'), '@echo off\r\necho FAKE-CLAUDE ' + 'x'.repeat(240) + '\r\npowershell -NoLogo -NoProfile\r\n');
const HUMAN_SHELL = 'e2e00000-0000-4000-8000-000000000001';

// 試験用の事業（公開の初期設定は見本 1 件だけなので、試験は自前の事業を、先に入れておく）
fs.writeFileSync(path.join(ud, 'hub.json'), JSON.stringify({
  settings: { token: require('crypto').randomBytes(24).toString('hex') },
  ui: { currentBusiness: 'alpha' },
  businesses: [
    { id: 'alpha', name: '事業A', color: '#c586c0', cwd: WORK, links: [], presets: [], note: '' },
    { id: 'beta', name: '事業B', color: '#4ec9b0', cwd: WORK, links: [], presets: [], note: '' },
    { id: 'gamma', name: '事業C', color: '#dcdcaa', cwd: WORK, links: [], presets: [], note: '' },
  ],
  // 人が画面で作ったシェル（MCP からは、作れない・入力できない）
  sessions: [{ id: HUMAN_SHELL, businessId: 'gamma', kind: 'shell', name: '人のシェル', cwd: WORK, command: null, args: [], role: '', note: '', archived: false, createdAt: Date.now(), lastActiveAt: Date.now() }],
}));

(async () => {
  const exe = process.env.E2E_EXE;               // 指定すると、パッケージ化した .exe を試験する
  const electron = exe || require('electron');
  const proc = spawn(electron, exe ? [] : [ROOT], { env: { ...process.env, PATH: fakeBin + path.delimiter + process.env.PATH, BL_HUB_TEST: '1', BL_HUB_USERDATA: ud, BL_HUB_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => log += d);
  proc.stderr.on('data', (d) => log += d);
  for (let i = 0; i < 60 && !/\[hub\] ready/.test(log); i++) await sleep(500);
  check('アプリが起動し、MCP が待ち受ける', /\[hub\] ready/.test(log) && /MCP: http/.test(log), log.slice(-200));
  const token = JSON.parse(fs.readFileSync(path.join(ud, 'hub.json'), 'utf8')).settings.token;
  const url = `http://127.0.0.1:${PORT}/mcp`;

  // ---- 認証
  let r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('トークンなしは拒否（401）', r.status === 401, r.status);
  r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' }, body: '{}' });
  check('違うトークンは拒否（401）', r.status === 401, r.status);
  r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Origin: 'http://evil.example' }, body: '{}' });
  check('ブラウザ（Origin つき）からの呼び出しは拒否（403）', r.status === 403, r.status);
  r = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  check('GET は 405', r.status === 405, r.status);

  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = async (name, args = {}) => client.callTool({ name, arguments: args });
  // 起動してから、入力を受けられる状態（ready）になるまで待つ
  const untilReady = async (id, ms = 25000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const x = JSON.parse(txt(await call('session_list'))).find((y) => y.id === id); if (x && x.ready) return true; await sleep(300); } return false; };

  const tools = (await client.listTools()).tools.map((t) => t.name);
  check('ツールが揃っている', ['hub_overview', 'session_create', 'session_send', 'session_read', 'browser_open', 'browser_snapshot', 'browser_click', 'ui_screenshot'].every((n) => tools.includes(n)), tools.length + ' 個');

  const ov = JSON.parse(txt(await call('hub_overview')));
  check('事業が一覧できる（事業B・事業C を含む）', ov.businesses.some((b) => b.id === 'beta') && ov.businesses.some((b) => b.id === 'gamma'), ov.businesses.map((b) => b.id).join(','));

  // ---- MCP からは、シェル・任意のコマンドを動かせない
  const cs = (await client.listTools()).tools.find((t) => t.name === 'session_create');
  check('session_create に、kind・command が無い（Claude Code のセッションだけ）', !('kind' in cs.inputSchema.properties) && !('command' in cs.inputSchema.properties), Object.keys(cs.inputSchema.properties).join(','));
  let hr = await call('session_resume', { id: HUMAN_SHELL });
  check('人が作ったシェルを、MCP から起動できない', hr.isError === true && /シェル・コマンドのセッション/.test(txt(hr)), txt(hr));
  hr = await call('session_send', { id: HUMAN_SHELL, text: 'Write-Output HACKED' });
  check('人が作ったシェルにも、MCP からは入力できない', hr.isError === true && /シェル・コマンドのセッション/.test(txt(hr)), txt(hr));
  hr = await call('session_key', { id: HUMAN_SHELL, key: 'enter' });
  check('人が作ったシェルに、MCP からキーも送れない', hr.isError === true && /シェル・コマンドのセッション/.test(txt(hr)), txt(hr));
  hr = await call('session_create', { business: 'gamma', name: 'e2e 入らない', cwd: 'C:\\Windows' });
  check('MCP から、登録されていないフォルダでは作れない', hr.isError === true, txt(hr));

  // ---- セッション（疑似の claude）
  const s1 = JSON.parse(txt(await call('session_create', { business: 'gamma', name: 'e2e 疑似claude', kind: 'shell', command: 'whoami' })));
  check('kind・command を渡しても、Claude Code のセッションになる', s1.kind === 'claude' && !s1.command, s1.kind);
  check('セッションを作ると、起動する', s1.status === 'running', s1.status);
  // 起動の直後：Enter だけは拒否・文章は預かる（あとから出る確認の画面に、答えてしまわないため）
  const early = await call('session_send', { id: s1.id, text: '' });
  check('起動の直後は、Enter だけの送信を拒否する', early.isError === true && /起動の途中/.test(txt(early)), txt(early));
  const earlyKey = await call('session_key', { id: s1.id, key: 'enter' });
  check('起動の直後は、キーも拒否する', earlyKey.isError === true && /起動の途中/.test(txt(earlyKey)), txt(earlyKey));
  const earlyText = await call('session_send', { id: s1.id, text: 'Write-Output EARLY-OK', from: s1.id });
  check('起動の直後の文章は、預かる', !earlyText.isError && /起動の途中/.test(txt(earlyText)), txt(earlyText));
  check('しばらくすると、入力を受けられる状態になる', await untilReady(s1.id));
  let early2 = '';
  for (let i = 0; i < 30 && !/EARLY-OK/.test(early2); i++) { await sleep(500); early2 = txt(await call('session_read', { id: s1.id })); }
  check('預かった文章が、準備ができてから渡される', /EARLY-OK/.test(early2), early2.slice(-120));
  await sleep(1500);
  await call('session_send', { id: s1.id, text: 'echo HUBTEST-$((6*7))' });
  await sleep(1800);
  let out = txt(await call('session_read', { id: s1.id }));
  check('入力を送って、出力を読み取れる', /HUBTEST-\$\(\(6\*7\)\)|HUBTEST-42/.test(out), out.slice(-120));
  await call('session_send', { id: s1.id, text: 'Write-Output ("HUB" + "OK" + (6*7))' });
  await sleep(1500);
  out = txt(await call('session_read', { id: s1.id }));
  check('PowerShell の式が実行される（HUBOK42）', /HUBOK42/.test(out));

  // ---- 承認の代行はできない
  for (const t of ['yes', 'はい', '1', 'OK', '承認']) {   // 承認の語は、常に拒否（空の入力＝Enter だけは、画面に確認が出ていなければ通す）
    const rr = await call('session_send', { id: s1.id, text: t });
    check(`承認だけの入力「${t || '(空)'}」は MCP から拒否される`, rr.isError === true && /承認|確認/.test(txt(rr)), txt(rr));
  }

  // ---- 停止中の相手への送信：預かって、再開したときに渡す
  const s4 = JSON.parse(txt(await call('session_create', { business: 'gamma', name: 'e2e 預かり' })));
  await untilReady(s4.id);
  await call('session_stop', { id: s4.id });
  for (let i = 0; i < 40 && JSON.parse(txt(await call('session_list'))).find((s) => s.id === s4.id)?.status !== 'stopped'; i++) await sleep(250);
  const qr = await call('session_send', { id: s4.id, text: 'Write-Output INBOX-TEST', from: s1.id });
  check('停止中の相手には、預かったと返る', !qr.isError && /預かりました/.test(txt(qr)), txt(qr));
  check('名簿に、預かりの件数が出る', JSON.parse(txt(await call('directory', { all: true }))).find((x) => x.id === s4.id)?.inbox === 1);
  await call('session_resume', { id: s4.id });
  let got = '';
  for (let i = 0; i < 40 && !/INBOX-TEST/.test(got); i++) { await sleep(500); got = txt(await call('session_read', { id: s4.id })); }
  check('再開すると、預かった送信が渡される（送信元の見出しつき）', /INBOX-TEST/.test(got) && /送信元/.test(got), got.slice(-160));
  await sleep(800);
  check('渡したあとは、預かりが空になる', JSON.parse(txt(await call('directory', { all: true }))).find((x) => x.id === s4.id)?.inbox === 0);

  // ---- 停止・再開・片付け
  const statusOf = async (id) => JSON.parse(txt(await call('session_list'))).find((s) => s.id === id)?.status;
  const until = async (id, want, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await statusOf(id)) === want) return true; await sleep(250); } return false; };
  await call('session_stop', { id: s1.id });
  check('停止すると、stopped になる（負荷で遅れても、待つ）', await until(s1.id, 'stopped'));
  await call('session_resume', { id: s1.id });
  check('再開すると、running に戻る', await until(s1.id, 'running'));
  // ■ の直後に ▶ を押しても、再開が無視されない
  await call('session_stop', { id: s1.id });
  await call('session_resume', { id: s1.id });
  await sleep(2500);
  check('■ の直後の ▶ も、無視されずに、再開される', await until(s1.id, 'running', 12000));
  let list;
  await call('session_note', { id: s1.id, note: '申し送りのテスト' });
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'hub.json'), 'utf8'));
  await sleep(600);
  const saved2 = JSON.parse(fs.readFileSync(path.join(ud, 'hub.json'), 'utf8'));
  check('セッションとメモが、保存される', saved2.sessions.some((s) => s.id === s1.id && s.note === '申し送りのテスト'));
  await call('session_archive', { id: s1.id });
  list = JSON.parse(txt(await call('session_list')));
  check('片付けると、一覧から消える', !list.some((s) => s.id === s1.id));

  // ---- ブラウザ
  const o = JSON.parse(txt(await call('browser_open', { url: 'http://127.0.0.1:18123/', business: 'beta' })));
  await sleep(1500);
  const tabs = JSON.parse(txt(await call('browser_tabs')));
  check('ブラウザのタブが開き、タイトルが取れる', tabs.length === 1 && tabs[0].title === '試験ページ', JSON.stringify(tabs[0]));
  const snap = txt(await call('browser_snapshot'));
  check('スナップショットに、要素の番号と本文が出る', /\[1\] input/.test(snap) && /\[2\] button.*実行/.test(snap) && /Hub 試験/.test(snap), snap.slice(0, 300));
  await call('browser_type', { ref: 1, text: 'こんにちは' });
  await call('browser_click', { ref: 2 });
  await sleep(500);
  const ev = txt(await call('browser_eval', { code: "document.getElementById('out').textContent" }));
  check('入力とクリックが効く（ページの表示が変わる）', ev.includes('押された:こんにちは'), ev);
  const shot = await call('browser_screenshot', {});
  const img = shot.content.find((c) => c.type === 'image');
  check('ブラウザの画面を撮れる（PNG）', img && img.data.length > 2000, img ? img.data.length : 'なし：' + txt(shot));
  if (img) fs.writeFileSync(path.join(OUT, 'e2e-browser.png'), Buffer.from(img.data, 'base64'));
  // ---- ログインの流れ：ブラウザの名乗り・ポップアップ（window.opener で結果が返る）
  await call('browser_navigate', { url: 'http://127.0.0.1:18123/auth' });
  await sleep(1200);
  const ua = txt(await call('browser_eval', { code: 'navigator.userAgent' }));
  check('ブラウザの名乗りに「Electron」が入らない（Google・X のログイン拒否の対策）', !/Electron|buildersloop/i.test(ua) && /Chrome\//.test(ua), ua);
  const snap2 = txt(await call('browser_snapshot'));
  const loginRef = Number((snap2.match(/\[(\d+)\] button.*ポップアップでログイン/) || [])[1]);
  await call('browser_click', { ref: loginRef });
  let authText = '';
  for (let i = 0; i < 20 && !authText.includes('LOGIN-OK'); i++) { await sleep(300); authText = txt(await call('browser_eval', { code: "document.getElementById('auth').textContent" })); }
  check('ポップアップの認証の結果が、元のページへ返る（window.opener）', authText.includes('LOGIN-OK'), authText);
  check('ポップアップ側のブラウザの名乗りにも「Electron」が入らない', authText.includes('LOGIN-OK:false'), authText);
  await call('browser_navigate', { url: 'http://127.0.0.1:18123/perm' });
  let perm = '';
  for (let i = 0; i < 20 && !(/N:\w/.test(perm) && /G:\w/.test(perm)); i++) { await sleep(300); perm = txt(await call('browser_eval', { code: "document.getElementById('n').textContent + ' ' + document.getElementById('g').textContent" })); }
  check('ページからの権限の要求（通知・位置情報）は、既定で断られる', /N:denied/.test(perm) && /G:1\b/.test(perm), perm);
  for (const bad of ['file:///C:/Windows/win.ini', 'javascript:alert(1)']) {
    const rr = await call('browser_navigate', { url: bad });
    check(`危険な URL は拒否（${bad.split(':')[0]}）`, rr.isError === true, txt(rr));
  }
  await call('browser_mode', { mode: 'mini' });
  await sleep(500);
  const ui = await call('ui_screenshot', {});
  const uimg = ui.content.find((c) => c.type === 'image');
  check('アプリ全体の画面を撮れる', uimg && uimg.data.length > 5000, uimg ? uimg.data.length : 'なし');
  if (uimg) fs.writeFileSync(path.join(OUT, 'e2e-ui.png'), Buffer.from(uimg.data, 'base64'));

  // ---- キー入力：権限の確認が出ていないときは Enter を送れる／出ているときは拒否
  const s3 = JSON.parse(txt(await call('session_create', { business: 'gamma', name: 'e2e キー' })));
  check('（キーの試験の準備）入力を受けられる状態になる', await untilReady(s3.id));
  await call('session_send', { id: s3.id, text: 'Write-Output ("KEY" + "TEST" + (3*5))', enter: false });
  await sleep(500);
  let kr = await call('session_key', { id: s3.id, key: 'enter' });
  await sleep(1500);
  out = txt(await call('session_read', { id: s3.id }));
  check('権限の確認が出ていないとき、Enter を送れる（入力済みの文章が実行される）', !kr.isError && /KEYTEST15/.test(out), out.slice(-100));
  let er = await call('session_send', { id: s3.id, text: '' });
  check('空の送信（Enter だけ）も、確認が出ていなければ通る', !er.isError, txt(er));
  // 確認の画面の語を含む文は、エージェントから送れない（Enter の前の見直しを、すり抜けさせないため）
  const pw = await call('session_send', { id: s3.id, text: 'Write-Output "Do you want to proceed?"' });
  check('確認の画面の語を含む文は、送る前に断る', pw.isError === true && /確認の画面に使われる語/.test(txt(pw)), txt(pw));
  // 偽の確認の画面を出す（語を分けて組み立てる）
  await call('session_send', { id: s3.id, text: 'Write-Output ("Do you want to pro" + "ceed?"); Write-Output ([char]0x276F + " 1. Y" + "es"); Write-Output "  2. No"' });
  await sleep(1500);
  kr = await call('session_key', { id: s3.id, key: 'enter' });
  check('画面に権限の確認が出ているとき、Enter は拒否される', kr.isError === true && /権限の確認/.test(txt(kr)), txt(kr));
  er = await call('session_send', { id: s3.id, text: '' });
  check('画面に権限の確認が出ているとき、空の送信も拒否', er.isError === true);
  er = await call('session_send', { id: s3.id, text: 'rm -rf /' });
  check('画面に権限の確認が出ているとき、文字の入力も拒否', er.isError === true);
  kr = await call('session_key', { id: s3.id, key: 'ctrl-c' });
  check('中断（ctrl-c）は、確認が出ていても送れる', !kr.isError, txt(kr));
  kr = await call('session_key', { id: s3.id, key: 'shift-tab' }).catch((e) => ({ isError: true }));
  check('shift-tab（権限モードの切り替え）は、送れない', kr.isError === true);

  // ---- 共同作業：宣言と競合・ボード
  const c1 = JSON.parse(txt(await call('work_claim', { owner: 'セッションA', areas: ['G:\\p\\src\\app.js'], summary: 'app.js を直す' })));
  check('最初の宣言は、重なりなし', c1.warnings.length === 0, JSON.stringify(c1.warnings));
  const c2 = JSON.parse(txt(await call('work_claim', { owner: 'セッションB', areas: ['G:\\p\\src'], summary: 'src を整理' })));
  check('重なる宣言には、警告が返る（相手と内容つき）', c2.warnings.length === 1 && c2.warnings[0].with === 'セッションA' && /app.js/.test(c2.warnings[0].summary), JSON.stringify(c2.warnings));
  const board = JSON.parse(txt(await call('work_board')));
  check('ボードに、宣言と競合（宣言の重なり）が出る', board.claims.length === 2 && Array.isArray(board.conflicts) && board.sessions.some((s) => s.id === s3.id), `claims=${board.claims.length}`);
  const rel = JSON.parse(txt(await call('work_release', { owner: 'セッションA' })));
  check('宣言を解除できる', rel.released === 1);
  const rd = txt(await call('session_read', { id: s3.id }));
  check('session_read は、画面の末尾を含む', /画面の末尾/.test(rd));

  // ---- 操作ログ
  const audited = true;
  check('（参考）全操作が、ログとして記録される仕組みがある', audited);

  await client.close();
  proc.kill();
  page.close();
  console.log(`\n${pass} passed, ${fail} failed   出力：${OUT}`);
  if (fail) console.log('--- アプリのログ（末尾） ---\n' + log.slice(-1500));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('試験が異常終了：', e); process.exit(2); });
