# 二次レビュー: 家庭キッチン前提の手順（プロンプト誘導）

**Document:** `docs/superpowers/specs/2026-07-31-household-kitchen-prompt-design.md`（r2 + S1/S2）  
**Date:** 2026-07-31  
**Stance:** 一次・敵対的と独立。r2 の I1–I7 クロージャ検証 + r2 起因の新規問題の有無  
**Method:** 独立 read-only reviewer（`feature-dev:code-reviewer`）

---

## Verdict

**Approve for implementation planning**

I1–I7 および一次テーマ（絶対制約の分割、CORE 権限、soft 骨格、kill-switch、挿入固定、marker）は設計本文で Closed。Critical 新規なし。

---

## Closure matrix

| ID | Status |
|----|--------|
| I1 soft skeleton | Closed |
| I2 kill-switch | Closed |
| I3 insertion lock | Closed |
| I4 L6 / diversity | Closed（dual list は明示受容） |
| I5 free memo | Closed |
| I6 test markers | Closed（二次で再生成 canary を必須化 → 設計 S2） |
| I7 time rate residual | Closed |
| abs / CORE / soft / flag | Closed |

---

## Secondary follow-ups absorbed into design

| ID | 内容 |
|----|------|
| S1 | soft 断片はキッチン固有（`constraint_conflictにしない` 既存文だけでは不可） |
| S2 | 再生成経路の marker 必須 canary（new_menu だけ緑で L12 違反を隠さない） |

---

## Plan への申し送り（設計 blocker ではない）

1. 共有 CORE 組み立てを実装の正とする（new_menu 専用スロット禁止は L12 済み）。
2. outcome 文は列挙追記のみ（既存 non-conflict 句の全面書き換えを避ける）。
3. ライブ success rate は L11 運用観測。実装完了ゲートにしない。
4. `DIVERSITY_PARAGRAPH` / validate / 新 failure code を触らない。

---

## Residual risks

敵対的レビュー r2 表と同じ（soft-only、メモ弱体化、偽 conflict、希釈、境界語、flyer 非対象、rate 残差）。
