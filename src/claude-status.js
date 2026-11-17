// Claude Code 自身が知らせる、会話の状態（`claude agents --json`）。画面の文字による確認の検出を、補う（置き換えない・弱めない）。
// 会話が「人の答えを待っている」（status が 'waiting'。権限の確認・質問など）なら、エージェントからの Enter・文字・キーを送らない。
// 取れないとき（古い Claude Code・時間切れ・読めない）や、一覧に無い会話（フォルダの信頼の確認の最中など）は「分からない」とし、
// 画面の検出だけで判断する（いままでと同じ）。
'use strict';
const cp = require('child_process');
const fs = require('fs');
const { childEnv, sysTool, winShell } = require('./ptys');

// `claude agents --json` の出力を、会話の ID → { status, waitingFor } にする。読めなければ null。
function parseAgents(out) {
  let list;
  try { list = JSON.parse(String(out || '').trim()); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const m = new Map();
  for (const a of list) {
    if (a && typeof a.sessionId === 'string') m.set(a.sessionId, { status: String(a.status || ''), waitingFor: a.waitingFor ? String(a.waitingFor) : '' });
  }
  return m;
}
const isWaiting = (e) => !!e && e.status === 'waiting';

function killTree(p) {
  if (!p || !p.pid) return;
  if (process.platform === 'win32') cp.execFile(sysTool('taskkill.exe', 'taskkill'), ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { p.kill(); } catch { /* もう終わっている */ } }
}

class ClaudeStatus {
  // run(cb)：一覧を取り、出力の文字列（失敗は null）を cb に渡す。試験では、差し替える。
  // onUnavailable()：はじめて取れなかったときに 1 回だけ呼ぶ（記録用）。
  // cwd：起動するフォルダ（Hub のデータのフォルダ。どのセッションの作業フォルダでもない場所）
  constructor({ env = process.env, cwd, ttlMs = 1000, timeoutMs = 4000, maxAgeMs = 15000, run, onUnavailable } = {}) {
    this.env = env;
    this.cwd = cwd;
    this.ttlMs = ttlMs;          // この間は、取り直さない（続けて呼ばれても、1 回だけ動かす）
    this.timeoutMs = timeoutMs;
    this.maxAgeMs = maxAgeMs;    // これより古い情報は使わない
    this.onUnavailable = onUnavailable;
    this.map = null;
    this.at = 0;                 // いまの情報を取り終えた時刻
    this.seq = 0;                // 取りに行った回数（古い結果で、新しい結果を上書きしない）
    this.applied = 0;
    this.pending = null;
    this.pendingStart = 0;
    this._warned = false;
    this._run = run || ((cb) => this._exec(cb));
  }
  _exec(cb) {
    const win = process.platform === 'win32';
    // 会話を起動するときと同じく、PATH の claude を使う。引数は固定（外からの値を入れない）。
    // 起動の仕方は、ほかの子のプロセスとそろえる（ptys.js の childEnv・絶対パスの cmd）。
    const env = childEnv(this.env);
    const cwd = this.cwd && fs.existsSync(this.cwd) ? this.cwd : undefined;
    const p = cp.spawn(win ? winShell() : '/bin/sh', win ? ['/d', '/c', 'claude agents --json'] : ['-c', 'claude agents --json'],
      { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    let timer = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); cb(v); };
    p.on('error', () => finish(null));   // 起動できない（EMFILE など）ときも、あとで 'error' が来る。先に受ける
    timer = setTimeout(() => { killTree(p); finish(null); }, this.timeoutMs);
    if (!p.stdout) { killTree(p); finish(null); return; }
    p.stdout.on('data', (d) => { out += d; if (out.length > 2e6) { killTree(p); finish(null); } });
    p.on('close', (code) => finish(code === 0 ? out : null));
  }
  // 一覧を取り直す（失敗しても reject しない）。force：いまから取りに行った結果を待つ（直前の Enter の見直し用）
  refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.at < this.ttlMs) return Promise.resolve();
    if (this.pending && (!force || this.pendingStart >= now)) return this.pending;
    const seq = ++this.seq;
    let resolveRun;
    const run = new Promise((resolve) => { resolveRun = resolve; });
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      const m = out == null ? null : parseAgents(out);
      if (seq > this.applied) { this.applied = seq; this.map = m; this.at = Date.now(); }
      if (!m && !this._warned) { this._warned = true; try { if (this.onUnavailable) this.onUnavailable(); } catch { /* 記録の失敗は無視 */ } }
      if (this.pending === run) this.pending = null;
      resolveRun();
    };
    this.pending = run;
    this.pendingStart = now;
    try { this._run(done); } catch { done(null); }   // 同期の例外（起動できない等）も「取れない」として扱う
    return run;
  }
  // true：Claude Code が「この会話は、人の答えを待っている」と知らせている（新しい情報のときだけ）
  waiting(sessionId) {
    if (!this.map || Date.now() - this.at > this.maxAgeMs) return false;
    return isWaiting(this.map.get(sessionId));
  }
}

module.exports = { ClaudeStatus, parseAgents, isWaiting };
