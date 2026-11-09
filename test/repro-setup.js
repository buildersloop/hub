// セットアップ担当の起動コマンドを再現して、出力（エラー）を読む。新しいセッション ID で試す（本物の会話は、触らない）。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pty = require('node-pty');
const { PtyManager, cleanEnv } = require('../src/ptys');
const { stripAnsi } = require('../src/guard');
const hubJson = JSON.parse(fs.readFileSync(require('./hubdata').hubJsonPath(), 'utf8'));
const rec = hubJson.sessions.find((s) => s.name === 'セットアップ担当');
if (!rec) { console.log('セットアップ担当の記録なし'); process.exit(1); }
const sess = { ...rec, id: process.argv[2] || crypto.randomUUID() };
const pm = new PtyManager();
pm.hasConversation = () => false;
const cmd = pm.commandFor(sess, []);
console.log('コマンド（先頭 330 文字）:\n' + cmd.slice(0, 330) + '\n…\ncwd:', sess.cwd, '/ 文字数:', cmd.length);
const t0 = Date.now();
const p = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', cmd], { name: 'xterm-256color', cols: 140, rows: 40, cwd: sess.cwd, env: { ...cleanEnv(process.env), TERM: 'xterm-256color' } });
let out = '';
p.onData((d) => { out += d; });
p.onExit(({ exitCode }) => { console.log(`\n終了コード ${exitCode}（${((Date.now() - t0) / 1000).toFixed(1)} 秒）\n--- 出力 ---\n` + stripAnsi(out).split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-40).join('\n')); process.exit(0); });
const withPrompt = process.argv[3] === '--prompt';
if (withPrompt) {   // 実際の流れを再現：入力して、間を置いて Enter
  const txt = 'まず hub_overview と profile_list で現状を確認して、いまの構成を短く説明して。そのあと、何を設定したいか、私に聞いて。';
  setTimeout(() => p.write(txt), 9000);
  setTimeout(() => p.write('\r'), 9700);
}
const LIMIT = withPrompt ? 80000 : 25000;
setTimeout(() => { console.log(`\n（${LIMIT / 1000} 秒たっても終了せず＝動き続けている）\n--- 出力（末尾） ---\n` + stripAnsi(out).split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-45).join('\n')); try { p.kill(); } catch {} process.exit(0); }, LIMIT);
