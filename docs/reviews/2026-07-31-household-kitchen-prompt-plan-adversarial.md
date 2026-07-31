# 敵対的レビュー: 実装計画 `2026-07-31-household-kitchen-prompt.md`

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-31-household-kitchen-prompt.md`（初版 `dfdc671`） |
| 対照 | 設計 + 現行 `generation-prompt.ts` / diversity-off / repair |
| 日付 | 2026-07-31 |
| Stance | 字義どおり実装する implementer を想定した敵対 |
| 初版判定 | **Request changes** |
| r1 後 | **Approve for implementation**（二次確認） |
| r1 | 計画本文に A1–A5 吸収 |

---

## Verdict (初版): **Request changes**

§2.1（新 failure クラス）違反の計画はない。Critical は 0。  
字義実装で GREEN 失敗・アーキチートが残る Important を r1 で閉じる。

---

## Critical

なし。

---

## Important（初版 → r1）

| ID | Title | Plan fix (r1) |
|----|-------|---------------|
| A1 | Step 1 import が Step 2/5 と矛盾（re-export 禁止） | kitchen は `household-kitchen-prompt.js` のみ |
| A2 | PREFIX/TAIL プレースホルダ + scan 虚偽 | 全文転記 |
| A3 | Task Files に Create 欠落 | 追加 |
| A4 | 順序テストが diversity on 前提を未記載 | 前提 + `diversityIndex >= 0` |
| A5 | 再生成 canary が弱く new_menu 専用チート可能 | full PARAGRAPH + 機材句 |

## Attack angles disposition

| # | Result |
|---|--------|
| import 矛盾 | Real → A1 |
| true as const mock | OK（diversity-off 同型） |
| PREFIX placeholders | Real → A2 |
| CORE.slice(0,40) | OK |
| promptDto null | OK（既存 canary） |
| diversity order | Real low CI → A4 |
| re-export 他 consumer | OK |
| buildCoreBody 名 | Minor → P5 |
| Files 欠落 | Real → A3 |
| 句読点微調整 vs PARAGRAPH | OK（同一定数） |
| non-conflict 文字列 | OK |
| base 二重合成 | OK |
| new_menu only cheat | A5 で強化 |

## 計画が正しく守るべき点（簡略化禁止）

- 共有 `buildGenerationSystemPromptCoreBody` を両 builder が実行時 flag で呼ぶ
- `household-kitchen-prompt.ts` mock 境界
- soft 逃げ道・validate 非接触
- non-conflict 並列挿入のみ
- 静的 CORE default-on スナップショット + 実行時 read
