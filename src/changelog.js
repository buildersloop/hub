// 変更の記録（CHANGELOG.md）から、版の主な変更を取り出す（純粋な関数）。
// 新しい版を初めて起動したとき（前の版を引き継いだとき）の、起動時のお知らせに使う。

// 「## V8（8.0.0）— …」のような見出しから、次の「## 」の前までを返す。無ければ ''。
// V1 と V10 を取り違えないよう、版の名前のあとは、空白・（・(・— または行の終わりだけを許す。
function versionSection(md, ver) {
  if (!md || !ver) return '';
  const lines = String(md).split(/\r?\n/);
  const esc = String(ver).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp('^##\\s+' + esc + '(?=$|[\\s（(—-])');
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { end = i; break; }
  return lines.slice(start, end).join('\n');
}

// 節の中の「- **太字**」の項目（主な変更）を、上から順に取り出す。末尾の句読点は除き、長いものは切る。
function versionHighlights(md, ver, maxLen = 40) {
  const sec = versionSection(md, ver);
  const out = [];
  for (const l of sec.split('\n')) {
    const m = /^\s*[-*]\s+\*\*(.+?)\*\*/.exec(l);
    if (!m) continue;
    let t = m[1].replace(/[\s。、：:]+$/u, '').trim();
    if (!t) continue;
    const chars = Array.from(t);
    if (chars.length > maxLen) t = chars.slice(0, maxLen).join('') + '…';
    out.push(t);
  }
  return out;
}

// 起動時のお知らせの 1 行。取り出せる項目が無ければ ''（お知らせを出さない）。
function versionNotice(md, ver, max = 3) {
  const items = versionHighlights(md, ver);
  if (!items.length) return '';
  const more = items.length > max ? `（ほか ${items.length - max} 件）` : '';
  const caution = /\*\*入れ替えるとき/.test(versionSection(md, ver)) ? '「入れ替えるとき」の注意もあります。' : '';
  return `${ver} の主な変更：${items.slice(0, max).join('／')}${more}。くわしくは CHANGELOG.md を見てください。${caution}`;
}

module.exports = { versionSection, versionHighlights, versionNotice };
