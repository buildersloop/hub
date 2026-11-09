// 共同作業の可視化：各セッション（Claude Code）の会話の記録（.jsonl）から、「いま何をしているか」を自動で読み取り、
// 同じ場所を触っているセッションを検出する。セッション側の協力は、要らない（協力があれば、work_claim の宣言も使う）。
const fs = require('fs');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
const dirOf = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i > 0 ? n.slice(0, i) : n; };

function readTail(file, bytes = 700 * 1024) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let s = buf.toString('utf8');
    if (start > 0) s = s.slice(s.indexOf('\n') + 1);   // 途中から始まる最初の行は捨てる
    return s;
  } finally { fs.closeSync(fd); }
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n');
};

// 会話の記録から、最近の活動を取り出す
function readActivity(file, { sinceMs = 6 * 3600 * 1000 } = {}) {
  const out = { exists: false, edited: [], read: [], commands: [], lastUserPrompt: '', lastAssistantText: '', lastAt: 0, tools: 0 };
  if (!file || !fs.existsSync(file)) return out;
  out.exists = true;
  const now = Date.now();
  const edited = new Map(), read = new Map();
  for (const line of readTail(file).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const at = Date.parse(o.timestamp) || 0;
    if (at) out.lastAt = Math.max(out.lastAt, at);
    const msg = o.message || {};
    if (o.type === 'user' && !o.isSidechain) {
      const t = textOf(msg.content).trim();
      if (t && !t.startsWith('<') ) out.lastUserPrompt = t.slice(0, 400);
    } else if (o.type === 'assistant') {
      const t = textOf(msg.content).trim();
      if (t) out.lastAssistantText = t.slice(0, 600);
      for (const it of Array.isArray(msg.content) ? msg.content : []) {
        if (!it || it.type !== 'tool_use') continue;
        out.tools++;
        const inp = it.input || {};
        const f = inp.file_path || inp.notebook_path;
        if (EDIT_TOOLS.has(it.name) && f) edited.set(norm(f), { path: String(f), at });
        else if (it.name === 'Read' && f) read.set(norm(f), { path: String(f), at });
        else if (it.name === 'Bash' && inp.command) out.commands.push({ command: String(inp.command).slice(0, 160), at });
      }
    }
  }
  const recent = (m) => [...m.values()].filter((x) => !x.at || now - x.at < sinceMs).sort((a, b) => b.at - a.at);
  out.edited = recent(edited).slice(0, 30);
  out.read = recent(read).slice(0, 10);
  out.commands = out.commands.slice(-6).reverse();
  return out;
}

// 直近の会話（人と Claude の発言）を、読みやすく取り出す（画面の再描画に影響されない）
function readConversation(file, maxChars = 6000) {
  if (!file || !fs.existsSync(file)) return '';
  const lines = [];
  for (const line of readTail(file, 500 * 1024).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const msg = o.message || {};
    const hhmm = o.timestamp ? new Date(o.timestamp).toTimeString().slice(0, 5) : '';
    if (o.type === 'user' && !o.isSidechain) {
      const t = textOf(msg.content).trim();
      if (t && !t.startsWith('<')) lines.push(`[${hhmm}] 人：${t}`);
    } else if (o.type === 'assistant') {
      const t = textOf(msg.content).trim();
      const tools = (Array.isArray(msg.content) ? msg.content : []).filter((c) => c && c.type === 'tool_use').map((c) => c.name);
      if (t) lines.push(`[${hhmm}] Claude：${t}`);
      if (tools.length) lines.push(`[${hhmm}]   （ツール：${tools.join('、')}）`);
    }
  }
  return lines.join('\n').slice(-maxChars);
}

// 競合の検出：同じファイル（file）／同じフォルダ（area）を、別のセッションが最近、編集している。宣言（claim）の重なりも。
function findConflicts(items, { windowMs = 60 * 60 * 1000, now = Date.now() } = {}) {
  // items: [{ id, name, edited:[{path,at}], claims:[{areas:[...]}] }]
  const conflicts = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      const ea = A.edited.filter((e) => !e.at || now - e.at < windowMs), eb = B.edited.filter((e) => !e.at || now - e.at < windowMs);
      const sameFiles = ea.filter((x) => eb.some((y) => norm(x.path) === norm(y.path))).map((x) => x.path);
      if (sameFiles.length) conflicts.push({ kind: 'file', a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name }, paths: sameFiles });
      const dirsA = new Set(ea.map((x) => dirOf(x.path))), sameDirs = [...new Set(eb.map((y) => dirOf(y.path)).filter((d) => dirsA.has(d)))];
      const fileDirs = new Set(sameFiles.map(dirOf));
      const onlyDirs = sameDirs.filter((d) => !fileDirs.has(d));
      if (onlyDirs.length) conflicts.push({ kind: 'area', a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name }, paths: onlyDirs });
      const ca = (A.claims || []).flatMap((c) => c.areas), cb = (B.claims || []).flatMap((c) => c.areas);
      const hit = ca.filter((x) => cb.some((y) => overlaps(x, y)));
      if (hit.length) conflicts.push({ kind: 'claim', a: { id: A.id, name: A.name }, b: { id: B.id, name: B.name }, paths: hit });
    }
  }
  return conflicts;
}
// 2 つの領域（ファイル／フォルダ）が重なるか（一方が他方の中にある）
function overlaps(a, b) {
  const x = norm(a), y = norm(b);
  return x === y || x.startsWith(y + '/') || y.startsWith(x + '/');
}

module.exports = { readActivity, readConversation, findConflicts, overlaps, norm, dirOf };
