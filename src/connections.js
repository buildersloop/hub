// MCP の接続（n8n のように、サービスを選んで、セッションごとにつなぐ）。
// - 接続の定義は hub.json（mcpConnections）。秘密の値（トークン等）は、暗号化して別の場所（mcpSecrets）に置く。画面にも、ログにも、出さない。
// - セッションを起動するとき、そのセッションで有効な接続だけを、--mcp-config のファイルにまとめて渡す。
//   ファイルには秘密の値を書かない（${変数名} だけ）。値は、そのセッションの環境変数として、起動時に渡す。
// - 変えられるのは、人だけ（画面の IPC）。エージェント（MCP）からは、読むことも、変えることもできない。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CATALOG } = require('./mcp-catalog');

const NAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]{0,60}$/;
const HDR_RE = /^[A-Za-z0-9-]{1,60}$/;
const RESERVED = new Set(['buildersloop-hub']);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'server';

class Connections {
  // box：{ encrypt(text)->base64, decrypt(base64)->text, available() }。本番は Electron の safeStorage（Windows の資格情報で暗号化）。
  constructor({ store, box }) {
    this.store = store;
    this.box = box;
    if (!Array.isArray(store.data.mcpConnections)) store.data.mcpConnections = [];
    if (!store.data.mcpSecrets || typeof store.data.mcpSecrets !== 'object') store.data.mcpSecrets = {};
  }
  get conns() { return this.store.data.mcpConnections; }
  get secrets() { return this.store.data.mcpSecrets; }
  get(id) { return this.conns.find((c) => c.id === id); }
  catalog() { return CATALOG; }

  // 画面に出す形：秘密の値は含めない。どの秘密が、設定済みかだけ。
  publicConn(c) {
    const set = Object.keys(this.secrets[c.id] || {});
    return { id: c.id, name: c.name, catalogId: c.catalogId || null, type: c.type, url: c.url || '', command: c.command || '', args: c.args || [], plainEnv: c.plainEnv || {},
      secretNames: c.secretNames || [], secretSet: set, ok: (c.secretNames || []).every((n) => set.includes(n)) };
  }
  list() { return this.conns.map((c) => this.publicConn(c)); }

  // 追加・更新。secrets は { 名前: 値 }。空の値は「変えない」。
  upsert(input) {
    const i = input || {};
    const name = String(i.name || '').trim();
    if (!NAME_RE.test(name)) throw new Error('名前は、英数字・-・_・. の 1〜40 文字にしてください');
    if (RESERVED.has(name)) throw new Error(`「${name}」は、Hub 自身の名前です。別の名前にしてください`);
    const type = i.type;
    if (!['http', 'stdio'].includes(type)) throw new Error('type は http か stdio');
    const c = { id: i.id || crypto.randomUUID(), name, catalogId: i.catalogId ? String(i.catalogId).slice(0, 40) : null, type, secretNames: [], plainEnv: {} };
    if (this.conns.some((x) => x.name === name && x.id !== c.id)) throw new Error(`「${name}」は、すでにあります`);
    if (type === 'http') {
      let u;
      try { u = new URL(String(i.url || '')); } catch { throw new Error('URL が正しくありません'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('URL は http／https のみ');
      c.url = u.toString();
      for (const n of i.secretNames || []) { if (!HDR_RE.test(n)) throw new Error(`ヘッダー名が正しくありません：${n}`); c.secretNames.push(n); }
    } else {
      const cmd = String(i.command || '').trim();
      if (!cmd || /[\r\n]/.test(cmd) || cmd.length > 200) throw new Error('コマンドが正しくありません');
      c.command = cmd;
      c.args = (Array.isArray(i.args) ? i.args : []).map((a) => String(a)).filter((a) => a.length <= 500 && !/[\r\n]/.test(a)).slice(0, 30);
      for (const n of i.secretNames || []) { if (!ENV_RE.test(n)) throw new Error(`環境変数名が正しくありません：${n}（大文字・数字・_）`); c.secretNames.push(n); }
      for (const [k, v] of Object.entries(i.plainEnv || {})) { if (!ENV_RE.test(k)) throw new Error(`環境変数名が正しくありません：${k}`); c.plainEnv[k] = String(v).slice(0, 500); }
    }
    c.secretNames = [...new Set(c.secretNames)];
    const incoming = i.secrets && typeof i.secrets === 'object' ? i.secrets : {};
    const wanted = Object.entries(incoming).filter(([k, v]) => c.secretNames.includes(k) && String(v) !== '');
    if (wanted.length && !this.box.available()) throw new Error('この PC では、秘密の値を暗号化できません。保存を中止しました');
    const idx = this.conns.findIndex((x) => x.id === c.id);
    if (idx >= 0) this.conns[idx] = c; else this.conns.push(c);
    const mine = this.secrets[c.id] || {};
    for (const [k, v] of wanted) mine[k] = this.box.encrypt(String(v));
    for (const k of Object.keys(mine)) if (!c.secretNames.includes(k)) delete mine[k];   // 使わなくなった秘密は、消す
    if (Object.keys(mine).length) this.secrets[c.id] = mine; else delete this.secrets[c.id];
    this.store.save();
    return this.publicConn(c);
  }
  remove(id) {
    const i = this.conns.findIndex((c) => c.id === id);
    if (i < 0) throw new Error('接続がありません');
    this.conns.splice(i, 1);
    delete this.secrets[id];
    for (const s of this.store.data.sessions) if (Array.isArray(s.mcp)) s.mcp = s.mcp.filter((x) => x !== id);
    this.store.save();
  }
  clearSecret(id, name) {
    if (this.secrets[id]) { delete this.secrets[id][name]; if (!Object.keys(this.secrets[id]).length) delete this.secrets[id]; this.store.save(); }
  }

  sessionIds(sess) { return (Array.isArray(sess.mcp) ? sess.mcp : []).filter((id) => this.get(id)); }
  setSession(sess, ids) {
    sess.mcp = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => this.get(id)))];
    this.store.save();
    return sess.mcp;
  }

  // 起動用：{ servers, env, errors }。servers は --mcp-config に書く内容（秘密の値は ${変数名} のみ）、env は、起動する端末に渡す値。
  // 復号できない秘密の値（別の版・別の PC で保存したもの）は、渡さずに errors に入れる（起動は止めない）。
  build(sess) {
    const servers = {}, env = {}, errors = [];
    const used = new Set(RESERVED);
    for (const id of this.sessionIds(sess)) {
      const c = this.get(id);
      let key = slug(c.name); let n = 2;
      while (used.has(key)) key = `${slug(c.name)}-${n++}`;
      used.add(key);
      const sec = this.secrets[c.id] || {};
      const open = (name) => { try { return this.box.decrypt(sec[name]); } catch { errors.push({ name: c.name, secret: name }); return null; } };
      const varOf = (name) => `BLH_${c.id.replace(/-/g, '').slice(0, 8)}_${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
      if (c.type === 'http') {
        const headers = {};
        for (const h of c.secretNames) { if (sec[h]) { const val = open(h); if (val === null) continue; const v = varOf(h); env[v] = val; headers[h] = '${' + v + '}'; } }
        servers[key] = { type: 'http', url: c.url, ...(Object.keys(headers).length ? { headers } : {}) };
      } else {
        const e = { ...(c.plainEnv || {}) };
        for (const nme of c.secretNames) { if (sec[nme]) { const val = open(nme); if (val === null) continue; const v = varOf(nme); env[v] = val; e[nme] = '${' + v + '}'; } }
        servers[key] = { type: 'stdio', command: c.command, args: c.args || [], ...(Object.keys(e).length ? { env: e } : {}) };
      }
    }
    return { servers, env, errors };
  }
  // 設定ファイルを書く（秘密の値は含まない）。戻り値：ファイルのパス。
  writeConfig(dir, sessId, servers) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `mcp-${sessId}.json`);
    fs.writeFileSync(f, JSON.stringify({ mcpServers: servers }), 'utf8');
    return f;
  }
}
module.exports = { Connections };
