# 一次レビュー: 実装計画 `2026-07-31-household-kitchen-prompt.md`

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-31-household-kitchen-prompt.md`（初版 `dfdc671`） |
| 対照 | 設計 `docs/superpowers/specs/2026-07-31-household-kitchen-prompt-design.md` |
| 日付 | 2026-07-31 |
| 種別 | 実装計画の一次レビュー（read-only） |
| 初版判定 | **Request changes** |
| r1 後 | **Approve**（二次確認: `plan-secondary.md`） |
| 敵対的 | `docs/reviews/2026-07-31-household-kitchen-prompt-plan-adversarial.md` |
| 二次 | `docs/reviews/2026-07-31-household-kitchen-prompt-plan-secondary.md` |
| r1 | 計画本文の Plan revision summary に P1–P5 を吸収 |

---

## Verdict (初版): **Request changes**

設計 locks（共有 CORE builder・kill-switch・soft・non-conflict 並列挿入・validate 非接触）は正しい。  
ただし Step 5 の PREFIX/TAIL が非実行プレースホルダ、Step 1 import 矛盾、Task Files 欠落があり、字義実装が thrash する。r1 で吸収済み。

---

## Findings table

| ID | Severity | Title | r1 |
|----|----------|-------|-----|
| P1 | Critical | Step 5 PREFIX/TAIL が `/* cut&paste */` | 全文転記 |
| P2 | Important | Step 1 が `generation-prompt.js` から kitchen を import | `household-kitchen-prompt.js` に統一 |
| P3 | Important | Task Files に Create kitchen モジュール欠落 | 追加 |
| P4 | Important | Placeholder scan「なし」が虚偽 | r1 後に修正 |
| P5 | Minor | Architecture `buildCoreBody` と locked 名不一致 | 改名 |

## 通過したチェック

- mock パターン（diversity-off 同型）
- regenerate_menu fixture 型（既存 canary と一致）
- `CORE.slice(0, 40)` は PREFIX 先頭のまま通過見込み
- 静的 CORE スナップショット vs 実行時 flag の役割分担
- 設計 L1–L13 / §2.1 のカバレッジ（P1–P3 修正後）

## Residual risks（計画欠陥ではない）

- DIVERSITY 番号リストにキッチン soft が無い（設計 lock）
- モデル残差（time_limit / conflict rate）は L11 で運用
- repair は originalMessages 再利用で直接テストなし（設計どおり）
