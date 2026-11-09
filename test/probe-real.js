// 実際に起動しているアプリへ、読み取りだけで接続して確認する（何も作らない・変えない）
const fs = require('fs'), path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
(async () => {
  const j = JSON.parse(fs.readFileSync(require('./hubdata').hubJsonPath(), 'utf8'));
  const c = new Client({ name: 'probe', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${j.settings.mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${j.settings.token}` } } }));
  const tools = (await c.listTools()).tools.map((t) => t.name);
  console.log('ツール数:', tools.length);
  const ov = JSON.parse((await c.callTool({ name: 'hub_overview', arguments: {} })).content[0].text);
  console.log('事業:', ov.businesses.map((b) => b.id + '(' + b.name + ')').join(' / '));
  console.log('セッション数:', ov.sessions.length, ' 列:', ov.ui.cols, ' ブラウザ:', ov.ui.dock);
  const shot = (await c.callTool({ name: 'ui_screenshot', arguments: {} })).content.find((x) => x.type === 'image');
  fs.writeFileSync(process.argv[2], Buffer.from(shot.data, 'base64'));
  console.log('画面を保存:', process.argv[2], Math.round(shot.data.length / 1024) + 'KB(base64)');
  await c.close();
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
