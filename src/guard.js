// 入力の安全装置（純粋な関数）。
// 方針：Claude Code の権限の確認（許可・承認）は、**人がアプリの画面で行う**。エージェントが MCP 経由で、承認を代わりに押せないようにする。
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI, '').replace(/\r(?!\n)/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

const APPROVAL_WORDS = new Set([
  'y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'approve', 'approved', 'accept', 'allow', 'confirm', 'proceed', 'go', 'continue',
  '1', '2', '3', 'a', 'always', 'はい', 'うん', 'いいよ', 'いい', 'おk', '承認', '許可', '同意', '送信して', '送信', '実行', '進めて', '続けて',
]);

// 「承認だけ」の入力か（空・Enter のみ・承認の語のみ）。true なら、拒否する。
function isApprovalOnly(text) {
  const t = String(text == null ? '' : text).replace(/[\r\n\t ]+/g, ' ').trim().toLowerCase();
  if (!t) return true;
  const bare = t.replace(/[.!！。、,]+$/g, '');
  return APPROVAL_WORDS.has(bare);
}

// 画面に、権限の確認・承認の質問が出ているか。出ているときは、Enter・数字・矢印の決定が「承認」になりうるので、エージェントからのキー入力を拒否する。
// 画面の末尾（直近の描画）だけを見る。誤検知（出ていないのに出ていると判定）は、安全側＝拒否になる。
const PERMISSION_PATTERNS = [
  /Do you want to (proceed|make this edit|create|allow|run|continue|trust|apply|overwrite|use)/i,
  /\bDo you trust\b/i,
  /trust the files in this folder/i,
  /❯\s*1\.\s*(Yes|Allow|Approve|Trust)/i,
  /\b1\.\s*Yes\b[\s\S]{0,200}\b2\.\s*(Yes|No)\b/i,
  /\(y\/n\)|\[y\/N\]|\[Y\/n\]/,
  /Yes, and don'?t ask again/i,
  /Allow (this|once|always)\b/i,
  /Press Enter to (confirm|continue|approve)/i,
  /permission (request|required|prompt)/i,
  /Esc to cancel/i,
  /Bypass Permissions|dangerously/i,
];
function looksLikePermissionPrompt(screenText) {
  const tail = String(screenText || '').slice(-2500);
  return PERMISSION_PATTERNS.some((re) => re.test(tail));
}
// 文の中に、確認の画面に使われる語があるか（あれば、その語を返す）。エージェントの文に入っていると、Enter の前の見直しで、本物の確認と区別できないため、送る前に断る。
function permissionWordsIn(text) {
  const t = String(text || '');
  const hit = PERMISSION_PATTERNS.find((re) => re.test(t));
  return hit ? (t.match(hit) || [''])[0] : '';
}
// 端末から来た入力のうち、人が打った文字があるか（端末が自動で返す応答・マウスの報告・フォーカスの報告だけなら false）
function hasTypedInput(data) {
  const rest = String(data || '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')             // CSI（カーソル位置・装置の属性・マウス・フォーカスの報告）
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')            // OSC の応答
    .replace(/\x1b[P_^][\s\S]*?\x1b\\/g, '')                     // DCS などの応答
    .replace(/\x1b./g, '');
  return rest.length > 0;
}

// エージェントが送ってよい「キー」。shift-tab（権限モードの切り替え）は、含めない。
const KEYS = { enter: '\r', escape: '\x1b', tab: '\t', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', 'ctrl-c': '\x03' };

// 端末に送る文字列を作る（複数行は、貼り付けとして送る）。
function toTerminalInput(text, enter = true) {
  const s = String(text);
  const body = /[\r\n]/.test(s) ? `\x1b[200~${s.replace(/\r\n/g, '\n').replace(/\n/g, '\r')}\x1b[201~` : s;
  return body + (enter ? '\r' : '');
}

// ブラウザの遷移先の制限
function isAllowedUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:';
  } catch { return u === 'about:blank'; }
}

module.exports = { stripAnsi, isApprovalOnly, toTerminalInput, isAllowedUrl, looksLikePermissionPrompt, permissionWordsIn, hasTypedInput, KEYS };
