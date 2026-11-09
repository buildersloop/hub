// 実際に起動している Hub を、MCP 経由で操作する小さなコマンド。  node test/hubctl.js <tool> '<json の引数>'
const fs = require('fs'), path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
(async () => {
  const j = JSON.parse(fs.readFileSync(require('./hubdata').hubJsonPath(), 'utf8'));
  const c = new Client({ name: 'hubctl', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${j.settings.mcpPort}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${j.settings.token}` } } }));
  // 引数は JSON。'@ファイル名' なら、ファイルから読む（シェルを通ると、バックスラッシュが壊れるため）
  const raw = process.argv[3];
  const [tool, args] = [process.argv[2], raw ? JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8').replace(/^﻿/, '') : raw) : {}];
  if (tool === '--tools') { console.log((await c.listTools()).tools.map((t) => t.name).join('\n')); await c.close(); return; }
  const r = await c.callTool({ name: tool, arguments: args });
  for (const x of r.content) console.log(x.type === 'text' ? x.text : `[${x.type} ${Math.round((x.data || '').length / 1024)}KB]`);
  if (r.isError) process.exitCode = 1;
  await c.close();
})().catch((e) => { console.error('失敗:', e.message); process.exit(1); });
