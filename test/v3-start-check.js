// 起動の確認：実際の exe で、claude のセッションを作り、起動・停止・再開ができるかを見る（実データは使わない）
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const exe = process.argv[2];
const PORT = 17997;
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'v3chk-'));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'v3cwd-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

(async () => {
  // 実データのコピーに、版つき Hub と同じ設定（MCP の上書き）を入れて、起動する。実データそのものは、触らない。
  const real = require('./hubdata').hubJsonPath();
  const seed = JSON.parse(fs.readFileSync(real, 'utf8'));
  seed.settings.mcpOverride = true; seed.settings.mcpPort = PORT; seed.settings.token = require('crypto').randomBytes(24).toString('hex');
  seed.sessions = []; seed.ui.open = [];
  fs.writeFileSync(path.join(ud, 'hub.json'), JSON.stringify(seed));
  const proc = spawn(exe, [], { env: { ...process.env, BL_HUB_TEST: '1', BL_HUB_USERDATA: ud, BL_HUB_PORT: String(PORT) }, stdio: 'ignore' });
  await sleep(6000);
  const token = JSON.parse(fs.readFileSync(path.join(ud, 'hub.json'), 'utf8')).settings.token;
  const client = new Client({ name: 'chk', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const biz = JSON.parse(txt(await call('hub_overview'))).businesses[0].id;
  const s = JSON.parse(txt(await call('session_create', { business: biz, name: '起動確認', role: '試験', kind: 'claude', cwd })));
  await sleep(9000);
  let st = JSON.parse(txt(await call('session_list'))).find((x) => x.id === s.id);
  console.log('新規：status=' + st.status + ' lastExit=' + JSON.stringify(st.lastExit || null));
  console.log('--- 画面 ---\n' + txt(await call('session_read', { id: s.id, max_chars: 600 })).slice(-500));
  await call('session_stop', { id: s.id });
  await sleep(4000);
  await call('session_resume', { id: s.id });
  await sleep(9000);
  st = JSON.parse(txt(await call('session_list'))).find((x) => x.id === s.id);
  console.log('再開：status=' + st.status + ' lastExit=' + JSON.stringify(st.lastExit || null));
  console.log('--- 画面 ---\n' + txt(await call('session_read', { id: s.id, max_chars: 600 })).slice(-500));
  spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F']);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
