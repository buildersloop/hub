## 何を・なぜ（What and why）
<!-- 関係する Issue：#番号 -->


## どう試したか（How was it tested?）
- [ ] `npm test`
- [ ] `npm run e2e`
- [ ] 画面で確かめた（画像を付ける） / Checked in the UI (screenshot attached)

## 安全の確認（Safety checklist）
- [ ] CLAUDE.md の「安全の不変条件」を弱めていない / Does not weaken the safety invariants in CLAUDE.md
- [ ] MCP に、書き込み・承認・秘密の値を扱うツールを足していない / No new MCP tools that write CLAUDE.md, approve, or read secrets
- [ ] 個人のパス・アカウント名・秘密の値を書いていない / No personal paths, account names or secrets
- [ ] 版の変更点が要るなら CHANGELOG.md に書いた / CHANGELOG.md updated if needed
