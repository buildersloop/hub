const { app } = require('electron');
app.whenReady().then(() => {
  const pty = require('node-pty');
  let out = '';
  const p = pty.spawn('cmd.exe', ['/c', 'echo PTY_OK && cd'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd() });
  p.onData(d => out += d);
  p.onExit(e => { console.log('exit', e.exitCode, JSON.stringify(out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim())); app.quit(); });
  setTimeout(() => { console.log('timeout'); app.quit(); }, 15000);
});
