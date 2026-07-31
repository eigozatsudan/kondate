# 二次レビュー: 実装計画 `2026-07-31-household-kitchen-prompt.md`（r1）

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-31-household-kitchen-prompt.md`（r1） |
| 一次 | `docs/reviews/2026-07-31-household-kitchen-prompt-plan-primary.md` |
| 敵対的 | `docs/reviews/2026-07-31-household-kitchen-prompt-plan-adversarial.md` |
| 日付 | 2026-07-31 |
| 種別 | 独立二次（クロージャ検証 + r1 新規欠陥） |
| 判定 | **Approve for implementation** |

---

## Closure matrix

| ID | Status |
|----|--------|
| P1 PREFIX/TAIL 全文 | **Closed** |
| P2 Step 1 import | **Closed** |
| P3 Task Files Create | **Closed** |
| P4 Placeholder scan | **Closed** |
| P5 Architecture 名 | **Closed** |
| A1–A5 | **Closed**（P2/P1/P3/A4/A5 と対応） |

Partial / Open: なし。

---

## Spot-checks（二次独自）

1. **PREFIX / TAIL vs live CORE_BODY:** PREFIX 終端は `autoまたはnull=…判断する。`、TAIL 始端は `membersのallergenIds・…`。live `generation-prompt.ts` の分割と一致。
2. **Step 1 kitchen import:** `household-kitchen-prompt.js` のみ。re-export 禁止。
3. **再生成 canary:** full `HOUSEHOLD_KITCHEN_PARAGRAPH` + 機材句。new_menu 専用チートを防止。
4. **kitchen-off mock:** diversity-off と同型（sibling module + hoisted getter）。

---

## New Critical / Important from r1

なし。

Residual nits のみ（実装ブロッカーではない）。

---

## Verdict

**Approve for implementation**

P1–P5 / A1–A5 は計画本文で Closed。字義実装可能な単一 Task として dispatch してよい。
