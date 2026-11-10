// Claude Code 自身が知らせる、会話の状態（`claude agents --json`）。画面の文字による確認の検出を、補う（置き換えない・弱めない）。
// 会話が「人の答えを待っている」（status が 'waiting'。権限の確認・質問など）なら、エージェントからの Enter・文字・キーを送らない。
// 取れないとき（古い Claude Code・時間切れ・読めない）や、一覧に無い会話（フォルダの信頼の確認の最中など）は「分からない」とし、
// 画面の検出だけで判断する（いままでと同じ）。
'use strict';
const { spawn } = require('child_process');

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
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else p.kill();
  } catch { /* もう終わっている */ }
}

class ClaudeStatus {
  // run(cb)：一覧を取り、出力の文字列（失敗は null）を cb に渡す。試験では、差し替える。
  constructor({ env = process.env, ttlMs = 1000, timeoutMs = 4000, maxAgeMs = 15000, run } = {}) {
    this.env = env;
    this.ttlMs = ttlMs;          // この間は、取り直さない（続けて呼ばれても、1 回だけ動かす）
    this.timeoutMs = timeoutMs;
    this.maxAgeMs = maxAgeMs;    // これより古い情報は使わない
    this.map = null;
    this.at = 0;
    this.pending = null;
    this._run = run || ((cb) => this._exec(cb));
  }
  _exec(cb) {
    const win = process.platform === 'win32';
    // 会話を起動するときと同じく、PATH の claude を使う。引数は固定（外からの値を入れない）。
    const p = spawn(win ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh', win ? ['/d', '/c', 'claude agents --json'] : ['-c', 'claude agents --json'],
      { env: this.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    let timer = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); cb(v); };
    timer = setTimeout(() => { killTree(p); finish(null); }, this.timeoutMs);
    p.stdout.on('data', (d) => { out += d; if (out.length > 2e6) { killTree(p); finish(null); } });
    p.on('error', () => finish(null));
    p.on('close', (code) => finish(code === 0 ? out : null));
  }
  // 一覧を取り直す（失敗しても reject しない）
  refresh() {
    if (Date.now() - this.at < this.ttlMs) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => {
      this._run((out) => {
        this.map = out == null ? null : parseAgents(out);
        this.at = Date.now();
        this.pending = null;
        resolve();
      });
    });
    return this.pending;
  }
  // true：Claude Code が「この会話は、人の答えを待っている」と知らせている（新しい情報のときだけ）
  waiting(sessionId) {
    if (!this.map || Date.now() - this.at > this.maxAgeMs) return false;
    return isWaiting(this.map.get(sessionId));
  }
}

module.exports = { ClaudeStatus, parseAgents, isWaiting };
