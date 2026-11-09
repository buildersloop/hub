# BuildersLoop Hub（開発の決まり）

複数の事業を並列で動かすための、専用のデスクトップアプリ（Electron・Windows）。本物の `claude` CLI を ConPTY で動かすターミナル、事業ごとにログインを分けたアプリ内ブラウザ、エージェントが操作できる MCP サーバーを持つ。**Web アプリではない**（PC 上のプロセスを起動するため）。

- このリポジトリは公開（OSS・MIT）。**個人のパス・アカウント名・秘密の値を、コード・文書・Issue・コミットに書かない**（単体テストが、追跡するすべてのファイルを検査する。手元の禁止語は、公開しない `private/forbidden-words.txt` に 1 行 1 語で書く）。
- 手元だけの決まり（自分の PC のパス・組織のルール）は、`CLAUDE.local.md` に書く（git に入れない）。あれば、最初に読む。

## 構成（src/）
| ファイル | 役割 |
|---|---|
| `main.js` | メインプロセス。IPC（`H('...')`）と起動・版のデータの引き継ぎ。`BL_HUB_TEST=1` は試験用（透明なウィンドウ） |
| `hub.js` | **中核**。画面（IPC）と MCP が、同じ操作を使う。セッション・設定・共同作業・CLAUDE.md・組織のルール |
| `ptys.js` | node-pty（ConPTY）。claude の起動（`--session-id`／`--resume`）・`cleanEnv` |
| `mcp.js` | MCP サーバー（127.0.0.1・Bearer・Host/Origin 検査）。ツール定義 |
| `guard.js` | **入力の安全装置**（純粋な関数）。承認語の拒否・権限の確認の検出・URL の制限 |
| `connections.js`／`mcp-catalog.js` | **MCP の接続**（GitHub・Slack・Notion など）。定義は hub.json の `mcpConnections`、秘密の値は `mcpSecrets`（safeStorage で暗号化）。起動時に、そのセッションで有効な接続だけを `--mcp-config` に渡す（秘密の値は、設定ファイルに書かず、環境変数 `${BLH_…}` で渡す） |
| `activity.js` | 会話の記録（.jsonl）から、活動の読み取り・競合の検出 |
| `browser.js` | WebContentsView。事業ごとの partition（Cookie 分離） |
| `store.js` | JSON の保存（原子的に書く）・版の引き継ぎ元の選択（`findInheritSource`） |
| `renderer/` | 画面（素の JS＋xterm）。`preload.js` は、チャンネルの許可リスト |
| `config/default.json` | 新しく入れたときの初期設定（見本の事業 1 件だけ。既存の環境には足さない） |

## コマンド
```
npm install
npm start                     # 開発用に起動
npm test                      # 単体（node test/unit.test.js）
npm run e2e                   # 通し（本物の Electron を起動し、MCP 経由で操作）
E2E_EXE=<exe のパス> node test/e2e.js    # パッケージ化した exe を試験
node test/hubctl.js <tool> '<json>'      # 動いている Hub を、MCP で操作する小さな CLI（いちばん新しい版のデータを読む。HUB_DATA で hub.json を指定できる）
```
ビルド・版の出し方は `docs/RELEASING.md`。

## 弱めてはいけない安全の不変条件
1. **承認の代行を、MCP からさせない**：`session_send` は、承認の語（y・はい・1・OK 等）を常に拒否する。画面に権限の確認が出ているときは、Enter・矢印・Tab・文字の入力を拒否する（中断の Esc・Ctrl+C は可）。`shift-tab`（権限モードの切り替え）は送れない。
2. **CLAUDE.md を、MCP から直接書き換えさせない**：エージェントは `claudemd_propose`（変更案の提出）まで。反映は、人が画面で差分を見て行う。MCP に書き込み系のツールを足さない（単体テストが検査する）。
3. **安全に関わる設定は、MCP から変えさせない**：`agentKeys`・`claudeArgs`・トークン・ポート・CDP・**組織のルール（`orgRules`）**。MCP からは読むだけ。
4. **起動時に、前回のセッションを自動で動かさない**（人が「▶ 続きから再開」を押す）。
5. MCP は 127.0.0.1 のみ・トークン必須・ブラウザ（Origin つき）からの呼び出しは拒否。ブラウザは http／https のみ。
6. Hub の MCP のフォルダの道具（`dir_tree`・CLAUDE.md の確認と変更案）が扱えるのは、事業に登録したものの中だけ（`..` の脱出を拒否）。MCP の `session_create` の cwd も、登録したものの中だけ。次は、作業フォルダ（MCP の `session_create` の cwd を含む）にも登録フォルダにもできない（`_assertSafeFolder`）：UNC・デバイスのパス（`\\` で始まる）・ドライブの直下・ホームフォルダとその親・`~\.claude`・Hub のデータのフォルダ（ほかの版を含む。とその親・中）。判定と `_inDirs` は、ジャンクション・リンクをたどった実際の場所で行う。
7. 「auto mode」など、ユーザーの Claude Code の既定の設定を、Hub が勝手に変えない・強めない。`--dangerously-skip-permissions` を、付けない。
8. **MCP の接続（`mcp:*`・`session:mcpGet/mcpSet`）は、人が画面で行う IPC だけ**。MCP のツールには、接続の読み取りも変更も、足さない（秘密の値に、AI が触れないように）。画面に返すのは、「どの秘密が設定済みか」だけで、値は返さない。暗号化できない PC では、秘密の値を保存しない。
9. **`--append-system-prompt-file` や `--mcp-config` に渡すパスは、引用符をつけない**（cmd 経由で壊れ、セッションが 1 秒で落ちる）。安全な文字だけのパスのときだけ渡す（`SAFE_ARG_PATH`）。渡せないときは、黙って落とさず、記録と画面に出す。
10. **名前・役割（セッション・事業）は、1 行の表示名**（`cleanLabel`：改行・制御文字・【】を除く）。自己紹介（system prompt）に入るため、エージェントが偽の見出し（例：【組織のルール】）を仕込めないようにする。
11. **MCP を、コマンドの実行の入口にしない**：MCP の `session_create` が作れるのは `kind=claude` だけ（`shell`・`custom`・`command`・`args` を受け取らない）。`session_send`・`session_key` は、Claude Code 以外のセッションへの入力を拒否する（人の画面だけ）。MCP の `session_resume`・`profile_run` は、シェル・コマンドのセッションを起動しない。プロファイルからは `custom` を作れない。`createSession`・`startSession`・`sendKey`・`profileRun`・`adoptSession` の `by` の既定は `agent`（安全な側）で、画面の IPC が `human` を明示する。
12. **エージェントが書いた指示は、人の発言に見せない**：MCP の `session_create` の prompt、`by` が人でないプロファイルの prompt、MCP の `setup_agent_start` の task、エージェントが作ったプリセット（人がボタンで送るときも）には、先頭に「【送信元：…】」を付ける（自己紹介では「見出しのない文は、人から」と教えているため）。
13. **確認の画面に、エージェントの入力を入れない**：最初の指示・預かった送信は、確認の画面が出ているあいだは渡さない（`sendWhenReady`）。起動のたびに、入力を受けられる状態を一度通るまで（`_ready`）、エージェントの文は預かり、Enter・キーは拒否する（あとから出る確認が、たまった入力を受け取らないように）。Enter の直前にも、確認の画面を見直す（`typeAndSubmit`。打った文の中の語も区別しない）。そのため、確認の画面に使われる語（`guard.js` の `PERMISSION_PATTERNS`）を含むエージェントの文（`session_send`・MCP の最初の指示・エージェントのプロファイル・`setup_agent_start`）は、送る前に断る。
14. **アプリ内ブラウザは、ページからの権限の要求を、既定で断る**（`browser.js` の `guardPermissions`。許すのは全画面と、クリップボードへの書き込みだけ）。端末の OSC 52（コピーの依頼）は、Claude Code のセッションで、人が直前に操作したときだけ受け付け、記録の再生中は受け付けない。
15. セットアップ担当の事前の許可（`SETUP_TOOLS`）に、セッションを起動・入力するツール（`profile_run`・`session_*` の書き込み）を入れない。

## 版（V2 以降）
- `package.json` の `hubVersion`（V8 など）が、版の名前。`version` は `<n>.<小さな修正>.0`（V8 → `8.0.0`、V8 の修正 → `8.1.0`）。
- 版つきの Hub は、自分のデータの置き場（`%APPDATA%\buildersloop-hub-v<n>`）と MCP のポート（17890＋n）を持つ。**初回だけ**、直前の版（無ければ、それより前の版・版のない旧版）の hub.json をコピーして、新しい合言葉を作る（`store.findInheritSource`）。旧版と同時に動かせる。同じ会話（セッション）を、2 つの Hub で同時に再開しない。
- 名簿と自己紹介：起動・再開のたびに、`identity/<id>.md` を書いて渡す（名前・役割・ID・同じ事業の仲間・組織のルール）。MCP の `whoami`・`directory`、`session_send` の `from` と名前指定。`from` は自己申告（MCP は全セッション共通の入口で、呼び出し元を確かめられない）。

## 改良の回し方（Issue → 版）
1. 要望・不具合は、GitHub の Issue にする（テンプレートあり）。版ごとのマイルストーン（V9・V10…）に振り分ける。
2. 1 つの変更は、1 つのブランチ → PR。PR には、何を・なぜ・どう試したかと、安全の不変条件に触れるかを書く。
3. AI のレビュー（別のセッション）と安全の検査が通れば、`main` に合流してよい。**外の人の PR は、持ち主が見てから合流する。**
4. 版を出すときは、`CHANGELOG.md` に書き、`docs/RELEASING.md` の手順でビルドする。リリースの公開・入れ替えは、人が行う。

## 落とし穴（実際にハマったもの）
- **Claude Code の中から Hub を起動すると、親の変数（`CLAUDECODE`・`CLAUDE_CODE_CHILD_SESSION` 等）が、子の claude に渡り、「会話を保存しない」状態になる**（再開できない・共同作業の読み取りもできない）。`ptys.cleanEnv` で除去している。起動は、ふつうにダブルクリックするのが一番確実。
- **Claude Code は、貼り付け直後の Enter を無視する**。文字の入力と Enter の間に 600ms の間を置く（`typeAndSubmit`）。
- **画面外・`show:false` のウィンドウは、描画が止まる**。試験では、透明（opacity 0）・マウスを通す・画面内に置く。ブラウザの `backgroundThrottling:false`。
- **画面（端末）の文字を読むのは、再描画で崩れる**。`session_read` は、会話の記録（.jsonl）を主に使う。
- **`node-pty` の `pty.kill()` は、Windows で、ログが荒れる**。`taskkill /T /F` を先にして、最後の手段にする。
- **PowerShell の `Remove-Item Env:...` は、安全装置に「システムパスの削除」と誤判定される**。`[Environment]::SetEnvironmentVariable(名, $null)` を使う。
- **`sleep` の長い待機は、実行環境が止める**。待つなら、短い確認の繰り返し、またはバックグラウンドで。
- 会話の記録の場所：`~\.claude\projects\<作業フォルダの英数字以外を - に置換>\<セッション ID>.jsonl`。
- **「終了コード 1」は、失敗とは限らない**：強制終了（アプリを閉じる・停止）は、Windows で終了コード 1 になる。`lastExit.reason`（`app-quit`／`stopped`／`exited`）で区別する。セットアップ担当などが「落ちた」ように見えたときは、まず、`node test/repro-setup.js "" --prompt`（新しい ID で、起動から最初の指示までを再現）で、本当に落ちるかを確かめる。
- **入れ替え（アプリの再起動）は、いま動いている自分自身のセッションも止める**。Hub の中で動いている会話から、アプリを入れ替えるときは、先に、会話の保存と、再開の手順を確認する。
- **アプリ内ブラウザで、Google・X のログインが壊れる**：①ブラウザの名乗り（UA）に「Electron」「アプリ名」が入ると、拒否されることがある → `app.userAgentFallback` と session・webContents の UA を、Chrome にそろえる（`CHROME_UA`）。②「〜でログイン」は `window.open` のポップアップで認証し、`window.opener` に結果を返す → ポップアップを、タブにせず、本物の子ウィンドウで開く（同じ partition を共有）。**ポップアップ側の UA は、`app.userAgentFallback` で決まる**（session や webContents への設定だけでは、効かなかった）。
- **ブラウザの入力・撮影は、CDP（`Input.*`・`Page.captureScreenshot`）を主にする**（モニターのスリープ・画面ロック中でも動く。`sendInputEvent`・`capturePage` は、予備）。

## 開発の流れ
1. 変更 → `npm test` → `npm run e2e`（40 件前後が通る）。
2. 画面の見た目は、`BL_HUB_SHOT_JS`／`BL_HUB_SHOT_OUT`（試験用の撮影フック）か、MCP の `ui_screenshot` で確認する。
3. 設計の変更は、README の該当の節に、理由とともに、追記する。版の変更点は `CHANGELOG.md` に書く。

## 言葉づかい
- 平易な日本語で、短く。本文は、チャットに書く（選択 UI は本文が見えない）。
- 外部への投稿・送信・公開・デプロイ（リポジトリへの push・リリースの作成を含む）は、内容を見せて、持ち主の名指しの承認のあとだけ。
