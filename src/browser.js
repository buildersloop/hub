// アプリ内ブラウザ（WebContentsView）。事業ごとにログインを分ける（partition）。エージェントが MCP から操作できる。
const { WebContentsView } = require('electron');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { isAllowedUrl } = require('./guard');

// ページからの権限の要求（カメラ・マイク・位置情報・通知など）は、既定で断る。Electron は、何も決めないと、すべて許可してしまうため。
// 許すのは、全画面と、ページの「コピー」ボタン（クリップボードへの書き込み）だけ。
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);
const guardedSessions = new WeakSet();
function guardPermissions(ses) {
  if (!ses || guardedSessions.has(ses)) return;
  guardedSessions.add(ses);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// Electron の Chromium と同じ版の、ふつうの Chrome の名乗り（「Electron/…」「アプリ名」を含めない）
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// アプリ全体の既定の名乗りも、これにする（ポップアップなど、あとから作られるウィンドウが、まず参照するのは、これ）
require('electron').app.userAgentFallback = CHROME_UA;

// ページの要素を、番号つきで一覧にする（クリック・入力は、この番号で指定する）
const SNAP = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('[data-hubref]').forEach((e) => e.removeAttribute('data-hubref'));
  const sel = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=textbox],[contenteditable=true],[onclick]';
  let n = 0; const items = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!vis(el)) continue;
    n++; el.setAttribute('data-hubref', n);
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    items.push('[' + n + '] ' + el.tagName.toLowerCase() + (el.type ? '(' + el.type + ')' : '') + (el.href ? ' -> ' + String(el.href).slice(0, 100) : '') + ' "' + label + '"');
    if (n >= 250) break;
  }
  return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 6000), items };
})()`;

class BrowserPanel extends EventEmitter {
  constructor(win) {
    super();
    this.win = win;
    this.tabs = new Map();      // id -> { view, businessId }
    this.active = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.visible = true;        // パネルが表示されているか（モーダル・非表示のとき false）
    this.mode = 'dock';         // dock | mini | hidden
  }

  info() {
    return [...this.tabs.entries()].map(([id, t]) => {
      const wc = t.view.webContents;
      return { id, businessId: t.businessId, title: wc.getTitle() || '(読み込み中)', url: wc.getURL(), active: id === this.active, loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() };
    });
  }
  changed() { this.emit('update', this.info()); }

  _layout() {
    for (const [id, t] of this.tabs) {
      const show = id === this.active && this.visible && this.mode !== 'hidden' && this.bounds.width > 4 && this.bounds.height > 4;
      t.view.setVisible(show);
      if (show) t.view.setBounds(this.bounds);
    }
  }
  setBounds(b) { this.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; this._layout(); }
  setVisible(v) { this.visible = !!v; this._layout(); }
  setMode(m) { this.mode = m; this._layout(); this.emit('mode', m); }

  openTab(url = 'about:blank', businessId = 'default') {
    if (!isAllowedUrl(url)) throw new Error('http／https の URL のみ開けます');
    const view = new WebContentsView({ webPreferences: { partition: `persist:biz-${businessId}`, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    const id = crypto.randomUUID();
    const wc = view.webContents;
    guardPermissions(wc.session);   // 最初の読み込みより前に（ポップアップも、同じ session を使う）
    const upd = () => this.changed();
    ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'did-fail-load'].forEach((ev) => wc.on(ev, upd));
    // ふつうの Chrome として名乗る（UA に「Electron」「アプリ名」が入っていると、Google・X などが、組み込みブラウザとして、ログインを拒否することがある）
    wc.setUserAgent(CHROME_UA);
    wc.session.setUserAgent(CHROME_UA);
    const partition = `persist:biz-${businessId}`;
    // ポップアップ（「Google でログイン」など）は、**本物の子ウィンドウ**として開く（window.opener で、元のページへ結果を返すため）。
    // ふつうのリンク（target=_blank）は、タブで開く。ポップアップも、同じログイン領域（partition）を共有する。
    wc.setWindowOpenHandler(({ url: u, disposition, features }) => {
      const popup = disposition === 'new-window' || !!(features && features.length);
      const okUrl = isAllowedUrl(u) || u === 'about:blank' || u === '';
      if (popup && okUrl) {
        // 子ウィンドウの最初の読み込みより前に、UA を揃える（session に設定済み。ここでも、もう一度）
        wc.session.setUserAgent(CHROME_UA);
        return { action: 'allow', overrideBrowserWindowOptions: { parent: this.win, width: 540, height: 760, autoHideMenuBar: true, show: process.env.BL_HUB_TEST !== '1',
          title: 'ログイン', webPreferences: { partition, sandbox: true, contextIsolation: true } } };
      }
      if (isAllowedUrl(u)) this.openTab(u, businessId);
      return { action: 'deny' };
    });
    // ポップアップが使う session（同じ partition）の UA も、Chrome にしておく（作成の直後・最初の読み込みより前に効かせるため、session 側で指定する）
    wc.on('did-create-window', (child) => {
      child.webContents.session.setUserAgent(CHROME_UA);
      child.webContents.setUserAgent(CHROME_UA);
      child.setMenuBarVisibility(false);
      child.webContents.on('will-navigate', (e, u) => { if (!isAllowedUrl(u) && u !== 'about:blank') e.preventDefault(); });
      child.webContents.setWindowOpenHandler(({ url: u }) => { if (isAllowedUrl(u)) wc.loadURL(u).catch(() => {}); return { action: 'deny' }; });
    });
    wc.on('will-navigate', (e, u) => { if (!isAllowedUrl(u)) e.preventDefault(); });
    this.win.contentView.addChildView(view);
    this.tabs.set(id, { view, businessId });
    this.activate(id);
    if (url !== 'about:blank') wc.loadURL(url).catch(() => {});
    return id;
  }
  activate(id) { if (this.tabs.has(id)) { this.active = id; this._layout(); this.changed(); } }
  closeTab(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    this.win.contentView.removeChildView(t.view);
    try { t.view.webContents.close(); } catch { /* 閉じ済み */ }
    this.tabs.delete(id);
    if (this.active === id) this.active = [...this.tabs.keys()].pop() || null;
    this._layout();
    this.changed();
  }
  wc(id) {
    const t = this.tabs.get(id || this.active);
    if (!t) throw new Error('開いているタブがありません（browser_open で開く）');
    return t.view.webContents;
  }

  async navigate(url, id) {
    if (!isAllowedUrl(url)) throw new Error('http／https の URL のみ開けます');
    const wc = this.wc(id);
    await wc.loadURL(url).catch((e) => { if (e && e.code !== 'ERR_ABORTED') throw e; });
    return { url: wc.getURL(), title: wc.getTitle() };
  }
  back(id) { const wc = this.wc(id); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  forward(id) { const wc = this.wc(id); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
  reload(id) { this.wc(id).reload(); }

  async snapshot(id) { return this.wc(id).executeJavaScript(SNAP, true); }
  async _center(wc, ref) {
    const r = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-hubref="${Number(ref)}"]'); if (!el) return null; el.scrollIntoView({block:'center', inline:'center'}); const b = el.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`, true);
    if (!r) throw new Error(`ref ${ref} が見つかりません（先に browser_snapshot を実行）`);
    return r;
  }
  // 入力・撮影は、開発者ツールのプロトコル（CDP）で行う：画面が描画されていなくても（モニターのスリープ・ロック中・隠れたウィンドウ）動く。
  // CDP が使えないときだけ、従来の方式（sendInputEvent・capturePage）に戻す。
  async _cdp(wc, method, params = {}) {
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); } catch (e) { if (!wc.debugger.isAttached()) throw e; }
    }
    return wc.debugger.sendCommand(method, params);
  }
  _keyInfo(key) {
    const M = { Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
      ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Space: [32, 'Space', ' '], Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'] };
    if (M[key]) { const [vk, code, text] = M[key]; return { key: key === 'Space' ? ' ' : key, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }; }
    if (key.length === 1) return { key, code: /[a-z]/i.test(key) ? 'Key' + key.toUpperCase() : '', windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), text: key };
    throw new Error(`使えないキーです：${key}（Enter・Escape・Tab・Backspace・Delete・Arrow*・Space・Home・End・PageUp・PageDown・1 文字）`);
  }
  async _key(wc, key) {
    const k = this._keyInfo(key);
    await this._cdp(wc, 'Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...k });
    await this._cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode });
  }
  async click(ref, id) {
    const wc = this.wc(id);
    const { x, y } = await this._center(wc, ref);
    try {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await this._cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
      await wait(40);
      await this._cdp(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await wait(40);
      await this._cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    } catch {
      wc.sendInputEvent({ type: 'mouseMove', x, y });
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    }
    await new Promise((r) => setTimeout(r, 400));
    return { clicked: ref };
  }
  async type(ref, text, { submit = false, clear = true } = {}, id) {
    const wc = this.wc(id);
    await this._center(wc, ref);
    await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-hubref="${Number(ref)}"]'); el.focus(); ${clear ? "if (el.select) el.select(); else if (el.isContentEditable) document.execCommand('selectAll');" : ''} })()`, true);
    try {
      if (clear) await this._key(wc, 'Delete');
      await this._cdp(wc, 'Input.insertText', { text });
      if (submit) await this._key(wc, 'Enter');
    } catch {
      if (clear) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Delete' }); }
      await wc.insertText(text);
      if (submit) { wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'char', keyCode: 'Enter' }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); }
    }
    await new Promise((r) => setTimeout(r, 300));
    return { typed: text.length, submit };
  }
  async press(key, id) {
    const wc = this.wc(id);
    try { await this._key(wc, key); } catch (e) {
      if (/使えないキー/.test(e.message)) throw e;
      wc.sendInputEvent({ type: 'keyDown', keyCode: key });
      if (key.length === 1 || key === 'Enter' || key === 'Space') wc.sendInputEvent({ type: 'char', keyCode: key });
      wc.sendInputEvent({ type: 'keyUp', keyCode: key });
    }
    await new Promise((r) => setTimeout(r, 200));
    return { pressed: key };
  }
  async evaluate(code, id) { return this.wc(id).executeJavaScript(code, true); }
  async screenshot(id, width = 900) {
    const wc = this.wc(id);
    try {   // まず CDP（描画面がなくても撮れる）
      const r = await this._cdp(wc, 'Page.captureScreenshot', { format: 'png' });
      if (r && r.data && r.data.length > 100) {
        const { nativeImage } = require('electron');
        const img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
        if (!img.isEmpty() && img.getSize().width > width) return img.resize({ width }).toPNG().toString('base64');
        return r.data;
      }
    } catch { /* 従来の方式へ */ }
    let img = await wc.capturePage();
    const s = img.getSize();
    if (s.width > width) img = img.resize({ width });
    return img.toPNG().toString('base64');
  }
}
module.exports = { BrowserPanel };
