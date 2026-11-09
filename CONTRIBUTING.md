# 参加のしかた（Contributing）

日本語でも英語でも大丈夫です。Japanese or English is fine.

## 要望・不具合
- [Issue](https://github.com/buildersloop/hub/issues) に、テンプレートに沿って書いてください。
- 版ごとのマイルストーン（V9・V10…）に振り分けて、まとめて出します。
- 弱点（セキュリティ）は、Issue ではなく [SECURITY.md](SECURITY.md) の方法で。

## 変更（PR）の出し方
1. Issue で、何を変えるかを先に相談してください（小さな修正は、いきなり PR でも大丈夫です）。
2. ブランチを作り、変更します。
3. 試験を通します：
   ```
   npm test        # 単体
   npm run e2e     # 通し（本物の Electron を起動。Windows が必要）
   ```
4. PR に、何を・なぜ・どう試したかを書きます。画面が変わるときは、画像を付けてください。

## 守ってほしいこと
- **[CLAUDE.md](CLAUDE.md) の「弱めてはいけない安全の不変条件」を、弱めないでください。** 迷ったら、PR に「安全に関わる」と書いてください。
- MCP に、書き込み・承認・秘密の値を扱うツールを足さないでください（人が画面で行う操作にします）。
- 個人のパス・アカウント名・秘密の値を、コード・試験・文書に書かないでください（単体テストが検査します）。
- 依存するライブラリを足すときは、ライセンス（MIT・Apache-2.0・BSD など）を確かめてください。

## 合流の決まり
- 持ち主以外からの PR は、持ち主が見てから合流します。
- 版の変更点は、合流のときに `CHANGELOG.md` に書きます。

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
