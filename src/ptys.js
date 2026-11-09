// ターミナル（ConPTY）の管理。本物の claude CLI を起動する。セッション ID を固定して、あとで --resume で再開できる。
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { stripAnsi } = require('./guard');

const BUF_MAX = 400 * 1024;
const encodeCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');   // Claude Code が会話の記録を置く場所の規則

// 親の Claude Code のセッションが持つ環境変数を、子に渡さない。渡すと、子が「子セッション」と見なされ、
// 会話の記録が保存されない（再開できない・共同作業の読み取りもできない）。設定用の変数（CLAUDE_CONFIG_DIR 等）は、残す。
const SESSION_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(CHILD|SESSION|MESSAGING|ENTRYPOINT|PARENT))/;
function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SESSION_ENV.test(k)) out[k] = v;
  return out;
}

class PtyManager extends EventEmitter {
  constructor() { super(); this.map = new Map(); }

  transcriptPath(sess) { return path.join(os.homedir(), '.claude', 'projects', encodeCwd(sess.cwd), sess.id + '.jsonl'); }
  hasConversation(sess) { try { return fs.existsSync(this.transcriptPath(sess)); } catch { return false; } }

  commandFor(sess, claudeArgs = []) {
    if (sess.kind === 'claude') {
      const q = (a) => (/^[\w\-./:\\*@=]+$/.test(a) ? a : `"${String(a).replace(/"/g, '')}"`);   // cmd 用の引用（"を含む値は想定しない）
      const all = [...(sess.args || []).map(q), ...claudeArgs];
      const extra = all.length ? ' ' + all.join(' ') : '';
      return this.hasConversation(sess) ? `claude --resume ${sess.id}${extra}` : `claude --session-id ${sess.id}${extra}`;
    }
    if (sess.kind === 'custom') return sess.command;
    return null; // shell
  }

  isRunning(id) { return this.map.has(id) && !this.map.get(id).exited; }

  start(sess, { cols = 120, rows = 32, claudeArgs = [], extraEnv = {} } = {}) {
    if (this.isRunning(sess.id)) return;
    // extraEnv：MCP の接続の秘密の値（このセッションだけに渡す。設定ファイルには書かない）
    const env = { ...cleanEnv(process.env), TERM: 'xterm-256color', COLORTERM: 'truecolor', ...extraEnv, BL_HUB_SESSION: sess.id };
    const cmd = this.commandFor(sess, claudeArgs);
    const file = cmd ? (process.env.ComSpec || 'cmd.exe') : 'powershell.exe';
    const args = cmd ? ['/d', '/c', cmd] : ['-NoLogo'];
    const cwd = fs.existsSync(sess.cwd) ? sess.cwd : os.homedir();
    const p = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env });
    const rec = { pty: p, buf: '', lastOutputAt: Date.now(), startedAt: Date.now(), exited: false, exitCode: null, cols, rows };
    this.map.set(sess.id, rec);
    p.onData((d) => {
      rec.lastOutputAt = Date.now();
      rec.buf += d;
      if (rec.buf.length > BUF_MAX) rec.buf = rec.buf.slice(-BUF_MAX);
      this.emit('data', sess.id, d);
    });
    p.onExit(({ exitCode }) => {
      rec.exited = true;
      rec.exitCode = exitCode;
      this.emit('exit', sess.id, exitCode, Date.now() - rec.startedAt);
    });
  }

  write(id, data) { const r = this.map.get(id); if (r && !r.exited) r.pty.write(data); return !!r && !r.exited; }
  resize(id, cols, rows) {
    const r = this.map.get(id);
    if (r && !r.exited && cols > 1 && rows > 1) { try { r.pty.resize(cols, rows); r.cols = cols; r.rows = rows; } catch { /* 終了直後など */ } }
  }
  snapshot(id) { const r = this.map.get(id); return r ? r.buf : ''; }
  readText(id, maxChars = 6000) {
    const r = this.map.get(id);
    if (!r) return '';
    const t = stripAnsi(r.buf).split('\n').map((l) => l.replace(/\s+$/g, '')).join('\n').replace(/\n{3,}/g, '\n\n');
    return t.slice(-maxChars);
  }
  lastOutputAt(id) { const r = this.map.get(id); return r ? r.lastOutputAt : 0; }
  pid(id) { const r = this.map.get(id); return r && !r.exited ? r.pty.pid : null; }

  stop(id) {
    const r = this.map.get(id);
    if (!r || r.exited) return;
    const pid = r.pty.pid;
    // claude が起こした子プロセスも、まとめて終了（pty.kill() は、Windows で、コンソール一覧の取得に失敗してログが荒れるため、最後の手段にする）
    if (pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => {});
    setTimeout(() => { if (!r.exited) { try { r.pty.kill(); } catch { /* 既に終了 */ } } }, 3000).unref();
  }
  stopAll() { for (const id of this.map.keys()) this.stop(id); }
  forget(id) { this.stop(id); this.map.delete(id); }
}
module.exports = { PtyManager, encodeCwd, cleanEnv };
