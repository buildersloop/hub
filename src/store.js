// 状態の保存（JSON）。アプリのデータ領域に、原子的に書く（途中で落ちても壊れない）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// 見本の事業の作業フォルダを置く場所（ホームフォルダそのものは、作業フォルダにしない：エージェントが読める範囲が広がりすぎるため）
const defaultWorkRoot = () => path.join(os.homedir(), 'BuildersLoopHub');

class Store {
  // opts.workRoot：作業フォルダが空の事業に、作るフォルダの親（試験では、一時フォルダを渡す）
  constructor(file, defaults, opts = {}) {
    this.file = file;
    this._t = null;
    let data = null;
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      // 新しく始めてよいのは「ファイルが無い」ときだけ。ロック中（EBUSY・EPERM など）に新規扱いにすると、既存のデータを上書きしてしまう。
      if (e.code !== 'ENOENT') throw new Error(`データ（${file}）を読めませんでした（${e.code || e.message}）。ほかのプログラムが使っていないか確かめて、開き直してください。`);
      raw = null;
    }
    if (raw !== null) {
      try { data = JSON.parse(raw); } catch {
        // 読めない（手で直して書き間違えた等）：上書きする前に、元のファイルを残す
        data = null;
        try { fs.renameSync(file, `${file}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`); } catch { /* 残せなくても、起動はする */ }
      }
    }
    const fresh = !data;
    if (fresh) data = JSON.parse(JSON.stringify(defaults));
    data.settings = { ...defaults.settings, ...(data.settings || {}) };
    data.ui = { ...defaults.ui, ...(data.ui || {}) };
    data.sessions = data.sessions || [];
    data.businesses = data.businesses && data.businesses.length ? data.businesses : JSON.parse(JSON.stringify(defaults.businesses));
    // 既定の事業（config/default.json）は、新しく入れたときだけ使う。既存の環境には、足さない（使う人ごとに、事業は違うため）。
    // 作業フォルダが空の事業（既定の見本）は、専用のフォルダ（例：~\BuildersLoopHub\general）を作って使う。
    const root = opts.workRoot || defaultWorkRoot();
    for (const b of data.businesses) {
      if (b.cwd) continue;
      b.cwd = path.join(root, String(b.id || 'general').replace(/[^A-Za-z0-9_-]/g, '_'));
      try { fs.mkdirSync(b.cwd, { recursive: true }); } catch { /* 作れなくても、起動はする（画面で変えられる） */ }
    }
    if (!data.businesses.some((b) => b.id === data.ui.currentBusiness)) data.ui.currentBusiness = (data.businesses.find((b) => !b.archived) || data.businesses[0]).id;
    if (!data.settings.token) data.settings.token = crypto.randomBytes(24).toString('hex');
    if (typeof data.settings.orgRules !== 'string') data.settings.orgRules = '';
    if (!Array.isArray(data.claudePending)) data.claudePending = [];
    this.data = data;
    if (fresh) this.saveNow();
  }
  save() { clearTimeout(this._t); this._t = setTimeout(() => this.saveNow(), 300); }
  saveNow() {
    clearTimeout(this._t);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }
}

const readableJson = (f) => { try { JSON.parse(fs.readFileSync(f, 'utf8')); return true; } catch { return false; } };

// 版の引き継ぎ：新しい版（V<n>）を初めて起動したとき、どのデータ（hub.json）をコピーするか。
// 直前の版から順に（V<n-1>、V<n-2>…）探し、読める hub.json がある、いちばん新しい版を使う。どれも無ければ、版のない旧版（buildersloop-hub）。
// 何も無ければ null（新しく始める）。appData は %APPDATA% のフォルダ、base はデータのフォルダ名の頭。
function findInheritSource(appData, ver, base = 'buildersloop-hub') {
  const n = parseInt((String(ver || '').match(/\d+/) || ['0'])[0], 10) || 0;
  let names = [];
  try { names = fs.readdirSync(appData); } catch { names = []; }
  const cands = [];
  for (const name of names) {
    const m = name.match(new RegExp('^' + base + '-v(\\d+)$', 'i'));
    if (!m) continue;
    const k = parseInt(m[1], 10);
    if (k < n) cands.push({ n: k, file: path.join(appData, name, 'hub.json'), from: 'V' + k });   // 自分と、自分より新しい版からは、引き継がない
  }
  cands.sort((a, b) => b.n - a.n);
  cands.push({ n: 0, file: path.join(appData, base, 'hub.json'), from: base });
  return cands.find((c) => fs.existsSync(c.file) && readableJson(c.file)) || null;
}

// 版の初回の起動：前の版のデータをコピーしたあと（または新しく始めたとき）、この版用に整える。
// ポート（17890＋版の番号）と合言葉を作り直し、この版の MCP をセッションに渡す。
// 引き継いだ場合、MCP の接続の秘密の値は消す（暗号化の鍵が、データのフォルダごとに違い、新しい版では復号できないため）。消した接続の名前を返す。
function applyFirstRun(data, ver, inheritedFrom) {
  const n = parseInt((String(ver || '').match(/\d+/) || ['0'])[0], 10) || 0;
  data.settings.mcpPort = 17890 + n;
  data.settings.token = crypto.randomBytes(24).toString('hex');
  data.settings.mcpOverride = true;
  data.settings.inheritedFrom = inheritedFrom || '';
  const reset = [];
  if (inheritedFrom && data.mcpSecrets && typeof data.mcpSecrets === 'object') {
    for (const id of Object.keys(data.mcpSecrets)) {
      const c = (data.mcpConnections || []).find((x) => x.id === id);
      reset.push(c ? c.name : id);
    }
    data.mcpSecrets = {};
  }
  data.settings.secretsReset = reset;
  return reset;
}

module.exports = { Store, findInheritSource, applyFirstRun, defaultWorkRoot };
