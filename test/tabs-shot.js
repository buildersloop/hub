// タブ表示の見た目の確認：実データのコピーで起動し、タブ→分割に切り替えて、画面を撮る（実データは触らない）。
// 使い方：node test/tabs-shot.js <出力フォルダ> [electron のパス]
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = process.argv[2];
const electron = process.argv[3] || require('electron');
fs.mkdirSync(out, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tabshot-'));
const seed = JSON.parse(fs.readFileSync(require('./hubdata').hubJsonPath(), 'utf8'));
seed.settings.mcpPort = 17996;
const ids = seed.sessions.filter((s) => !s.archived).slice(0, 4).map((s) => s.id);
seed.ui.open = ids; seed.ui.view = 'grid'; seed.ui.dock = 'hidden';
fs.writeFileSync(path.join(ud, 'hub.json'), JSON.stringify(seed));

const shot = (name, js) => {
  const f = path.join(ud, name + '.js');
  fs.writeFileSync(f, js);
  const png = path.join(out, name + '.png');
  const r = spawnSync(electron, [path.join(__dirname, '..')], { env: { ...process.env, BL_HUB_TEST: '1', BL_HUB_USERDATA: ud, BL_HUB_PORT: '17996', BL_HUB_SHOT_JS: f, BL_HUB_SHOT_OUT: png }, timeout: 60000, encoding: 'utf8' });
  console.log(name, fs.existsSync(png) ? 'OK ' + png : 'NG ' + (r.stderr || '').slice(0, 200));
};
const inv = (ch, ...a) => `window.hub.invoke(${JSON.stringify(ch)}, ${a.map((x) => JSON.stringify(x)).join(', ')})`;
shot('1-grid', 'null');
shot('2-tabs', `${inv('ui:set', { view: 'tabs', active: ids[0] })}`);
shot('3-split-h', `${inv('ui:set', { view: 'tabs', active: ids[0], split: { id: ids[1], dir: 'h' } })}`);
shot('4-split-v', `${inv('ui:set', { view: 'tabs', active: ids[2], split: { id: ids[0], dir: 'v' } })}`);
console.log('ids', ids.length);
