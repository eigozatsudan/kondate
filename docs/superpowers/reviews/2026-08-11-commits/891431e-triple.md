# Triple review: `891431e` docs: E2E短縮 Spec/Plan のレビュー反映と記録を追加する

- **Full SHA:** `891431e5b1da0c514a51a01076087026a8b5a33d`
- **Parent:** `a3423b19d311ebec866d7647cc8875f9ccbea6b0`
- **種別:** docs only（Spec/Plan 改訂 + `docs/superpowers/reviews/2026-08-11-e2e-runtime-reduction-*.md`）
- **照合:** live Spec/Plan（状態「レビュー反映後」）、二次検証の must-fix リスト、実装後の Phase 1 結果との整合
- **手法:** 静的（正確性・退行・設計 residual の明示不足）

---

## 1次レビュー

### Summary

`a3423b1` 初版に対する 1次/敵対/2次の must-fix を **Spec/Plan 本文に吸収**している。特に:

- **C1 緩和:** §4.2 に history-regen（MVP #13）・pantry（MVP #9）各 1 本 smoke、account-deletion は 0 のまま。§5.3 で「PR green ≠ acceptance 全量」「full は merge 後 push（事後検知）」を隠さず文書化（選択肢 B + 運用前提明示）。
- **F2:** project skip を config `grepInvert` 単一入口に固定。
- **F3:** `e2e-smoke-tags.test.mjs` で必須ファイル×最低本数を **必須**機械固定。
- **F1:** setup は shell 1 回、mobile/desktop から `dependencies` 外し方向へ収束。
- **F9:** Task 3 の smoke/full 分岐を実装可能に書き直し。
- レビュー 3 本を `docs/superpowers/reviews/` に記録し Spec からリンク。

製品 cap 不変・privacy・release full 維持は一貫。

### Verdict: **APPROVE_WITH_NITS**

### Findings

#### Critical

（なし — C1 は「穴をゼロにする」ではなく **拡張 smoke + 明示 residual** で閉じる設計選択。sign-off 相当の文書化あり。）

#### Important residual（実装時に守る契約であって、docs 欠陥としては軽微）

| ID | 内容 |
| --- | --- |
| D1 | C1 residual は残る: account-deletion / billing 全量 / a11y 全幅 / race 大半は full 依存。repo 内 branch protection 無し — **文書どおり** |
| D2 | exact title の機械固定は「本数」必須まで。title allowlist は Plan で推奨止まり（後の 33c10be で強化） |
| D3 | Phase 3 の C2/workers ゲートは文章＋Task Files 強化だが、この commit だけでは実行証明なし（想定どおり） |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | 開発者焦点実行の `./scripts/run-e2e.sh -- …` 形が残る（wrapper strip は後続実装） |
| M2 | ≤22 分 / ≤10 分は stretch 明記済み — 管理用 residual |

---

## 敵対的レビュー

### Summary

「レビュー反映」ラベルで **Critical を Important に落としていないか**を突く。C1 は **ゼロクローズではなく受容**。拡張 smoke により初版 C1 の最悪形（e2e-only path 全欠）は緩和。C2 は Phase 3 前条件として文書に残っており、この commit で消えていない（正しい）。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 「レビュー反映済み」で C1 を無視して実装 | **文書上は不可** — residual 明示。運用が読めば成立しうるが docs 欠陥ではない |
| 2 | §4.2 に #9/#13 を書いたが Plan Task 2 が古い薄いセット | **要確認点** — 反映後 Plan は同表に追随する前提。乖離があれば Important |
| 3 | grepInvert を書いて fixture 案を残す二重記述 | **概ね反証** — 単一入口を必須化 |
| 4 | self-review「Placeholder なし」再発 | 反映後 Task 3 は完成形方向。残プレースホルダがあれば Minor |

### Findings

#### Critical

（なし）

#### Important

- **I1（設計 residual）:** merge 後 full 赤の revert SLA / branch protection は repo 外。docs は推奨まで — 実装コミットが smoke ガードを弱めると C1 が再拡大
- **I2:** exact title 固定が任意だと、後続タグ付け commit で「本数だけ正しい false green」が残る（Phase 1 実装レビュー F2）

#### Minor

- docs の `--` 付き 1 ファイル起動慣習が残る

---

## 2次検証

### Cross-walk

| 指摘 | 判定 | 備考 |
| --- | --- | --- |
| a3423b1 の C1 が閉じたか | **PARTIAL → 設計受容** | 拡張 smoke + 明示。Critical 実装欠陥ではなく **運用 residual** |
| a3423b1 の F2/F3/F9 | **CONFIRMED 反映** | live Spec §4.1–4.2 / §5.3 / 機械固定文言 |
| a3423b1 の C2 | **Phase 3 前条件として保持** | この commit のスコープ外で正しい |
| D2 title 固定 | **CONFIRMED residual** | 後続 33c10be で改善 |

### Must-fix

**なし**（docs として実装着手可能な状態）。

### Final: **APPROVE_WITH_NITS**

**理由:** 初版 BLOCK 条件の Phase 1 最小セットは文書上閉じた。残る Important は実装時のガード強度と運用 residual。次の実装コミット群はこの Spec を正とすべき。

TRIPLE_REVIEW_COMPLETE
