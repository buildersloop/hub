// つなげられるサービスの一覧（雛形）。画面で選ぶと、必要な項目が出る。公式・広く使われているものだけを入れる。
// type: stdio＝この PC でコマンド（npx）を動かす／http＝URL につなぐ。secretNames＝秘密の値の名前（環境変数名／ヘッダー名）。
// Windows では、npx を cmd 経由で動かす。
const npx = (pkg, ...rest) => ({ command: 'cmd', args: ['/c', 'npx', '-y', pkg, ...rest] });
const CATALOG = [
  { id: 'github', label: 'GitHub', note: 'リポジトリ・Issue・PR を扱う。トークン（Personal access token）が要る。', type: 'stdio', ...npx('@modelcontextprotocol/server-github'), secretNames: ['GITHUB_PERSONAL_ACCESS_TOKEN'] },
  { id: 'slack', label: 'Slack', note: 'チャンネルの読み書き。Bot トークンとチームの ID が要る。', type: 'stdio', ...npx('@modelcontextprotocol/server-slack'), secretNames: ['SLACK_BOT_TOKEN'], plainEnvNames: ['SLACK_TEAM_ID'] },
  { id: 'notion', label: 'Notion', note: 'ページ・データベース。インテグレーションのトークンが要る。', type: 'stdio', ...npx('@notionhq/notion-mcp-server'), secretNames: ['NOTION_TOKEN'] },
  { id: 'filesystem', label: 'ファイル（フォルダ限定）', note: '指定したフォルダだけを読み書きする。引数の末尾に、許可するフォルダを入れる。', type: 'stdio', ...npx('@modelcontextprotocol/server-filesystem', 'C:\\許可するフォルダ'), secretNames: [] },
  { id: 'playwright', label: 'ブラウザ操作（Playwright）', note: 'ブラウザを操作する。外部サイトへのログインは、人が行う。', type: 'stdio', ...npx('@playwright/mcp@latest'), secretNames: [] },
  { id: 'fetch-http', label: 'URL で追加（http）', note: 'MCP の URL をそのまま追加する。認証が要るなら、ヘッダー名（例：Authorization）を秘密の値に入れる。', type: 'http', url: 'https://', secretNames: [] },
  { id: 'custom-stdio', label: 'コマンドで追加（自分で）', note: 'コマンドと引数を自分で書く。信頼できるものだけ。', type: 'stdio', command: '', args: [], secretNames: [] },
];
module.exports = { CATALOG };
