// 補助の道具（hubctl など）が読む hub.json の場所。
// 環境変数 HUB_DATA（hub.json のパス）があれば、それ。無ければ、いちばん新しい版のデータ（無ければ、版のない旧版）。
const path = require('path');
const { findInheritSource } = require('../src/store');
function hubJsonPath() {
  if (process.env.HUB_DATA) return process.env.HUB_DATA;
  const src = findInheritSource(process.env.APPDATA, 'V9999');
  if (!src) throw new Error('hub.json が見つかりません（環境変数 HUB_DATA で、場所を指定できます）');
  return src.file;
}
module.exports = { hubJsonPath };
