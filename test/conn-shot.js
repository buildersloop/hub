// 接続の画面の見た目の確認（実データのコピーで起動。実データは触らない）。使い方：node test/conn-shot.js <出力フォルダ>
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'connshot-'));
const seed = JSON.parse(fs.readFileSync(require('./hubdata').hubJsonPath(), 'utf8'));
seed.settings.mcpPort = 17994;
const sess = seed.sessions.filter((s) => !s.archived && s.kind === 'claude')[0];
seed.mcpConnections = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'github', catalogId: 'github', type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-github'], secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'], plainEnv: {} },
  { id: '22222222-2222-2222-2222-222222222222', name: 'notion', catalogId: 'fetch-http', type: 'http', url: 'https://example.com/mcp', secretNames: ['Authorization'], plainEnv: {} },
];
seed.mcpSecrets = { '11111111-1111-1111-1111-111111111111': { GITHUB_PERSONAL_ACCESS_TOKEN: 'AAAA' } };
sess.mcp = ['11111111-1111-1111-1111-111111111111'];
fs.writeFileSync(path.join(ud, 'hub.json'), JSON.stringify(seed));

const shot = (name, js) => {
  const f = path.join(ud, name + '.js');
  fs.writeFileSync(f, js);
  const png = path.join(out, name + '.png');
  const r = spawnSync(require('electron'), [path.join(__dirname, '..')], { env: { ...process.env, BL_HUB_TEST: '1', BL_HUB_USERDATA: ud, BL_HUB_PORT: '17994', BL_HUB_SHOT_JS: f, BL_HUB_SHOT_OUT: png }, timeout: 60000, encoding: 'utf8' });
  console.log(name, fs.existsSync(png) ? 'OK ' + png : 'NG ' + (r.stderr || '').slice(0, 200));
};
shot('c1-manager', 'openConnManager()');
shot('c2-editor', `openConnEditor(null, { id: 'slack', label: 'Slack', note: 'チャンネルの読み書き。', type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-slack'], secretNames: ['SLACK_BOT_TOKEN'], plainEnvNames: ['SLACK_TEAM_ID'] })`);
shot('c3-session', `openSessionMcp(S.sessions.find((s) => s.id === ${JSON.stringify(sess.id)}))`);
