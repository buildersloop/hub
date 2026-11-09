// BuildersLoop Hub — メインプロセス
const { app, BrowserWindow, ipcMain, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST = process.env.BL_HUB_TEST === '1';
if (process.env.BL_HUB_USERDATA) app.setPath('userData', process.env.BL_HUB_USERDATA);
// 版の名前（package.json の hubVersion）。ウィンドウの題名・データの置き場・MCP のポートに使う。
const VER = (() => { try { return require('../package.json').hubVersion || ''; } catch { return ''; } })();
const TITLE = 'BuildersLoop Hub' + (VER ? ' ' + VER : '');
// 版つきの Hub は、版ごとに自分のデータの置き場（buildersloop-hub-v3 など）を持つ。古い Hub と、同時に動かせる。
// 初回だけ、直前の版（無ければ、それより前の版・版のない旧版）の hub.json をコピーして、事業・セッション・設定を引き継ぐ（元のデータは、変えない）。
const { Store, findInheritSource, applyFirstRun } = require('./store');
let firstRun = false;
let inheritedFrom = '';
let inheritError = '';
if (VER && !process.env.BL_HUB_USERDATA) {
  const mine = path.join(app.getPath('appData'), 'buildersloop-hub-' + VER.toLowerCase());
  app.setPath('userData', mine);
  if (!fs.existsSync(path.join(mine, 'hub.json'))) {
    firstRun = true;
    const src = findInheritSource(app.getPath('appData'), VER);
    // コピーに失敗しても、起動は続ける（新しく始める）。理由は、画面の記録（ログ）に出す。
    if (src) { try { fs.mkdirSync(mine, { recursive: true }); fs.copyFileSync(src.file, path.join(mine, 'hub.json')); inheritedFrom = src.from; } catch (e) { inheritError = `${src.from} からの引き継ぎに失敗しました：${e.message}`; } }
  }
}

const { PtyManager } = require('./ptys');
const { BrowserPanel } = require('./browser');
const { Hub } = require('./hub');
const { startMcp } = require('./mcp');

const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
if (process.env.BL_HUB_PORT) defaults.settings.mcpPort = Number(process.env.BL_HUB_PORT);
let store;
try { store = new Store(path.join(app.getPath('userData'), 'hub.json'), defaults); } catch (e) {
  // データを読めない（ロック中など）：上書きせずに、理由を出して終わる
  require('electron').dialog.showErrorBox(TITLE, e.message);
  app.exit(1);
  throw e;
}
if (process.env.BL_HUB_PORT) store.data.settings.mcpPort = Number(process.env.BL_HUB_PORT);
// コピーした設定のままだと、前の版と、ポートも合言葉も同じになってしまう。この版用に、変える（新しく始めるときも、版ごとのポートにする）。
// 引き継いだ MCP の接続の秘密の値は、この版では復号できないので消す（画面で入れ直す）。
if (firstRun) { applyFirstRun(store.data, VER, inheritedFrom); store.saveNow(); }
// ブラウザを、外部の Playwright MCP からも操作したい場合のみ（既定はオフ：Hub の画面も見えてしまうため）
if (store.data.settings.cdp) app.commandLine.appendSwitch('remote-debugging-port', String(store.data.settings.cdpPort || 9333));

// 同じ版の2つ目の起動：何も出さずに終わらず、理由を表示する（同じデータを、2つの Hub が同時に使わないための仕組み。版が違う Hub は、同時に動かせる）
if (!TEST && !app.requestSingleInstanceLock()) {
  const { dialog } = require('electron');
  dialog.showErrorBoxSync(TITLE, `${TITLE} は、すでに動いています。\n同じデータを使うため、同じ版は2つ同時には動かせません。\nタスクバーを確認するか、いったん閉じてから、開き直してください。`);
  app.quit(); process.exit(0);
}

let win = null;
let browser = null;
const ptys = new PtyManager();
// 秘密の値の暗号化：Windows の資格情報（DPAPI）で、この PC・このユーザーだけが復号できる
const secretBox = {
  available: () => { try { return require('electron').safeStorage.isEncryptionAvailable(); } catch { return false; } },
  encrypt: (t) => require('electron').safeStorage.encryptString(t).toString('base64'),
  decrypt: (b) => require('electron').safeStorage.decryptString(Buffer.from(b, 'base64')),
};
const hub = new Hub({ store, ptys, getBrowser: () => browser, getWindow: () => win, secretBox });
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
// 起動時のお知らせ（版の引き継ぎ）：記録に残し、画面を開いたときに 1 回出す
const startupNotices = [];
if (firstRun) {
  if (inheritedFrom) startupNotices.push(`${TITLE}：${inheritedFrom} の設定を引き継ぎました（${inheritedFrom} のデータは、そのままです）。`);
  if (inheritError) startupNotices.push(inheritError + '（新しく始めました）');
  const reset = store.data.settings.secretsReset || [];
  if (reset.length) startupNotices.push(`MCP の接続の秘密の値は、この版では読めないため、消しました。「接続」で入れ直してください：${reset.join('、')}`);
  for (const m of startupNotices) hub.audit('Hub', 'version', m);
}
hub.on('notice', (m) => send('ui:notice', m));

hub.on('pty:data', (id, d) => send('pty:data', id, d));
hub.on('pty:exit', (id, code) => send('pty:exit', id, code));
hub.on('session:update', (s) => send('session:update', s));
hub.on('ui:update', () => send('ui:update', hub.overview(true)));
hub.on('ui:focus', (id) => send('ui:focus', id));
hub.on('audit', (e) => send('audit:entry', e));

function createWindow() {
  win = new BrowserWindow({
    // 試験時：透明・マウスを通す・タスクバーに出さない（show:false や画面外だと、描画が止まって、撮影・入力が動かないため）
    width: 1560, height: 960, minWidth: 1000, minHeight: 640, show: true, ...(TEST ? { x: 40, y: 40, opacity: 0, focusable: false, skipTaskbar: true } : {}), backgroundColor: '#1e1e1e', title: TITLE,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  if (TEST) win.setIgnoreMouseEvents(true);
  win.setMenuBarVisibility(false);
  win.on('page-title-updated', (e) => e.preventDefault());   // 題名（版の名前つき）を、ページの題名で上書きしない
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  browser = new BrowserPanel(win);
  browser.on('update', (tabs) => send('browser:tabs', tabs));
  browser.on('mode', (m) => send('browser:mode', m));
  win.on('closed', () => { win = null; });
  if (TEST) win.setSize(1500, 900);
}

// ---- 画面からの操作（IPC）
const H = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => { try { return { ok: true, value: await fn(...a) }; } catch (e) { return { ok: false, error: String(e.message || e) }; } });
const uiSettings = () => ({ mcpPort: store.data.settings.mcpPort, cdp: store.data.settings.cdp, orgRules: store.data.settings.orgRules || '', version: VER, inheritedFrom: store.data.settings.inheritedFrom || '', notices: startupNotices });
H('state:get', () => ({ ...hub.overview(true), settings: uiSettings(), audit: hub.auditLog.slice(-100) }));
// 組織のルール：人（画面）だけが変える。MCP からは、読むだけ（settings_get）。
H('settings:orgRules', (t) => { hub.setOrgRules(t); return uiSettings(); });
H('session:create', (a) => hub.createSession({ ...a, by: 'human' }));
H('session:start', (id) => hub.startSession(id, 'human'));
H('session:inbox', (id) => hub.inboxOf(id));
H('session:inboxClear', (id) => hub.inboxClear(id));
H('session:stop', (id) => hub.stopSession(id));
H('session:rename', (id, n) => hub.renameSession(id, n));
H('session:role', (id, r) => hub.setRole(id, r));
// MCP の接続（人が画面で行う。エージェント（MCP）からは、触れない）。秘密の値は、画面に返さない。
H('mcp:catalog', () => hub.conns.catalog());
H('mcp:conns', () => hub.conns.list());
H('mcp:connUpsert', (i) => hub.conns.upsert(i));
H('mcp:connDelete', (id) => { hub.conns.remove(id); hub.emit('ui:update'); return true; });
H('session:mcpGet', (id) => { const s = hub.session(id); if (!s) throw new Error('セッションがありません'); return { ids: hub.conns.sessionIds(s), conns: hub.conns.list() }; });
H('session:mcpSet', (id, ids) => { const s = hub.session(id); if (!s) throw new Error('セッションがありません'); const r = hub.conns.setSession(s, ids); hub.emit('session:update', hub.publicSession(s)); return r; });
H('session:note', (id, n) => hub.setSessionNote(id, n));
H('session:archive', (id) => hub.archiveSession(id));
H('session:openPane', (id) => hub.openPane(id));
H('session:closePane', (id) => hub.closePane(id));
H('pty:write', (id, d) => hub.write(id, d));
H('pty:resize', (id, c, r) => ptys.resize(id, c, r));
H('pty:snapshot', (id) => ptys.snapshot(id));
H('business:note', (id, n) => hub.setBusinessNote(id, n));
H('ui:set', (p) => hub.setUi(p));
H('browser:open', (url, biz) => browser.openTab(url, biz));
H('browser:navigate', (url) => browser.navigate(url));
H('browser:back', () => browser.back());
H('browser:forward', () => browser.forward());
H('browser:reload', () => browser.reload());
H('browser:close', (id) => browser.closeTab(id));
H('browser:activate', (id) => browser.activate(id));
H('browser:bounds', (b) => browser.setBounds(b));
H('browser:visible', (v) => browser.setVisible(v));
H('browser:mode', (m) => { hub.setUi({ dock: m }); browser.setMode(m); });
H('browser:tabs', () => browser.info());
H('ui:board', () => hub.board());
H('business:upsert', (b) => hub.businessUpsert(b, 'human'));
H('business:archive', (id, archived) => hub.businessArchive({ id, archived }));
H('business:dirUpsert', (business, label, p) => hub.dirUpsert({ business, label, path: p }));
H('business:dirDelete', (business, label) => hub.dirDelete({ business, label }));
H('business:dirOpen', (p) => shell.openPath(p));
H('business:claudeList', (business) => hub.claudeMdList({ business }));
H('business:claudeGet', (business, dir) => hub.claudeMdGet({ business, dir }));
H('business:claudeSet', (business, dir, content) => hub.claudeMdSet({ business, dir, content }));
H('business:claudeTemplate', (business) => hub.claudeMdTemplate({ business }));
H('business:claudeBackups', (business) => hub.claudeMdBackups({ business }));
H('business:pendingGet', (id) => hub.claudePendingGet(id));
H('business:pendingApply', (id) => hub.claudePendingApply(id));
H('business:pendingReject', (id) => hub.claudePendingReject(id));
H('session:setupAgent', (task) => hub.startSetupAgent({ task }));
H('session:profileRun', (name) => hub.profileRun({ name }, 'human'));
H('session:key', (id, key) => hub.sendKey(id, key, 1, 'human'));
// 端末の文字のコピー・貼り付け（画面から）。メインプロセスのクリップボードを使う（画面側の方法は、フォーカスや権限で失敗することがあるため）
H('ui:copy', (t) => { clipboard.writeText(String(t == null ? '' : t).slice(0, 1000000)); return true; });
H('ui:paste', () => clipboard.readText());
H('mcp:info', () => {
  const port = store.data.settings.mcpPort;
  return { port, cmd: `claude mcp add --transport http --scope user buildersloop-hub http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${store.data.settings.token}"` };
});
H('mcp:copyCommand', () => { const port = store.data.settings.mcpPort; clipboard.writeText(`claude mcp add --transport http --scope user buildersloop-hub http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${store.data.settings.token}"`); return true; });

let mcpServer = null;
app.whenReady().then(async () => {
  createWindow();
  try {
    mcpServer = await startMcp(hub, { browser: () => browser, window: () => win }, { port: store.data.settings.mcpPort, token: store.data.settings.token });
    console.log(`[hub] MCP: http://127.0.0.1:${store.data.settings.mcpPort}/mcp`);
  } catch (e) { console.error('[hub] MCP を起動できません：', e.message); }
  // 前回開いていたセッションは、再開ボタンを待つ（自動では動かさない＝トークンと承認の画面を、勝手に出さない）
  if (TEST) console.log('[hub] ready');
  // 試験専用：画面で JavaScript を実行してから、ウィンドウを撮影して終了する（画面の見た目の確認用）
  if (TEST && !app.isPackaged && process.env.BL_HUB_SHOT_JS && process.env.BL_HUB_SHOT_OUT) {   // exe では効かない
    setTimeout(async () => {
      try {
        await win.webContents.executeJavaScript(fs.readFileSync(process.env.BL_HUB_SHOT_JS, 'utf8'));
        await new Promise((r) => setTimeout(r, 1500));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.BL_HUB_SHOT_OUT, img.toPNG());
      } catch (e) { console.error('[shot]', e.message); }
      app.quit();
    }, 3000);
  }
});
app.on('before-quit', () => { hub.markQuitting(); store.saveNow(); ptys.stopAll(); if (mcpServer) mcpServer.close(); });
app.on('window-all-closed', () => app.quit());
