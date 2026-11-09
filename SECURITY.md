# セキュリティ（Security Policy）

## 弱点の知らせ方（Reporting a vulnerability）
**公開の Issue には書かないでください。** GitHub の「Security」タブ →「Report a vulnerability」から、非公開で知らせてください。

Please **do not open a public issue**. Use GitHub's private vulnerability reporting: the "Security" tab → "Report a vulnerability".

知らせてほしいこと（Please include）：
- 何が起きるか・どの版か（Hub の版：V8 など、Windows の版）
- 再現の手順
- 想定される影響（例：エージェントが承認を代行できる、MCP に外から届く、秘密の値が読める）

受け取ったら、できるだけ早く返事をします。直した版を出すまでは、内容を公開しないでください。

## 対象（Scope）
特に、次を破るものを重く見ます（[CLAUDE.md](CLAUDE.md) の「安全の不変条件」）：
- エージェント（MCP）が、人の代わりに承認・権限の確認に答えられる
- エージェントが、Hub の MCP から、シェル・任意のコマンドを動かせる（Claude Code の権限の確認を通らずに）
- エージェントが、CLAUDE.md・安全に関わる設定・組織のルール・MCP の接続を変えられる
- エージェントが書いた指示が、見出しなしで、人の発言として届く
- MCP に、この PC の外・ブラウザ・合言葉なしで届く
- Hub の MCP のフォルダの道具で、登録したフォルダの外を読める
- 秘密の値（トークンなど）が、画面・ファイル・ログに平文で出る

## 対象の外（Out of scope）
- Claude Code そのものの道具（ファイルの読み書き・コマンドの実行）でできること。これは、Claude Code の権限の設定で決まります。
- 利用者が、Hub の MCP のツールを Claude Code で「常に許可」にしたうえで起きること（README の「安全の考え方」を見てください）。
- 利用者が有効にした「CDP」（合言葉のないデバッグ用のポート）を通した操作。既定はオフです。
- この PC で、すでに任意のコードを動かせる人（環境変数を変える・ファイルを置き換える など）による操作。

## 対応する版（Supported versions）
いちばん新しい版だけを直します。The latest version only.
