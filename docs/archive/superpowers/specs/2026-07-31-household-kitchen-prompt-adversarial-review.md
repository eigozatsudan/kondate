# 敵対的レビュー: 家庭キッチン前提の手順（プロンプト誘導）

**Document:** `docs/archive/superpowers/specs/2026-07-31-household-kitchen-prompt-design.md`  
**Date:** 2026-07-31  
**Stance:** adversarial product + generation-success + implementer ambiguity  
**Method:** 独立 read-only reviewer（`feature-dev:code-reviewer`）+ 一次レビュー突合  
**前提:** 実装者は設計を字義どおり実装し、未記載は省略する

---

## Summary（draft 時点）

| 重大度 | 件数 |
|--------|-----:|
| Critical | 0 |
| Important | 7（一次と重複する論点含む） |
| Minor | 4 |

**Verdict (draft): Request changes**  
**Post-r2 design:** 下表を設計本文 r2 へ吸収済み  
**Post-secondary:** I1–I7 Closed → **Approve for implementation planning**（`2026-07-31-household-kitchen-prompt-secondary-review.md`）

---

## Critical

なし。hard-gate 禁止（validate / repair / 新 conflict code）は明確で、字義実装でも本番に機材 reject を足しにくい。残差は主に **prompt の強さ** と **既存 failure code の rate**。

---

## Important（draft → r2）

### I1. Skeleton が hard に聞こえる

- **Section (draft):** §6.3 骨格 vs 要件 5  
- **Failure:** 「だけで実行できるように書く」が必須義務に読まれ、偽 conflict・時間超過・薄い献立が増える  
- **Design fix (r2):** soft 骨格・success 逃げ道必須・単独の強い「だけで書く」禁止  

### I2. kill-switch 不在

- **Section (draft):** §2 / §9 vs 多様性 L13  
- **Failure:** rate 悪化時に off できず revert のみ  
- **Design fix (r2):** L11 `HOUSEHOLD_KITCHEN_PROMPT_ENABLED` default on  

### I3. 挿入位置が二者択一

- **Section (draft):** §6.2「直前または直後」  
- **Failure:** 実装者ごとに優先・attention が変わる  
- **Design fix (r2):** outcome **直前**固定 + non-conflict 列挙に機材句必須  

### I4. L6 が preferences / diversity 番号リストと衝突

- **Section (draft):** L6  
- **Failure:** 二重の優先順位、preferences 欠落  
- **Design fix (r2):** hard → preferences → キッチン → 多様性 → 季節。DIVERSITY 本文は更新しない  

### I5. 自由メモ「蒸し器を使って」の勝ち負け未記載

- **Section (draft):** §5.4 / Non-Goals  
- **Failure:** メモ無視・蒸し器遵守・conflict の三通りがすべて「設計どおり」になり得る  
- **Design fix (r2):** §6.3 / L6 でメモは命令にしない、機材を理由に conflict にしない  

### I6. テスト断片が不安定

- **Section (draft):** §7「固定フレーズ断片」  
- **Failure:** 緩すぎ／全文一致で fragile／idea のみ  
- **Design fix (r2):** marker `【家庭キッチン】`、idea+household 必須、flag off 否定、推奨で順序  

### I7. 既存 code の rate リスク（時間）未記載

- **Section (draft):** §2 / §9  
- **Failure:** validate 差分ゼロなのに time_limit / repair 増で success rate 低下  
- **Design fix (r2):** §2.2 モデル残差、§9 長時間化、skeleton に時間水増し禁止  

---

## Minor（draft → r2）

| ID | 内容 | r2 |
|----|------|-----|
| M1 | トースター / グリル境界 | 観測でも網羅しないと明記 |
| M2 | flyer 等の対象外 | Non-Goals に明示 |
| M3 | repair が original system 再利用 | L7 / §6.1 |
| M4 | quality 語彙の shared export 誘惑 | L9 private |

---

## Residual accepted risks（r2 後も残る）

| Risk | Why acceptable |
|------|----------------|
| モデルがたまに蒸し器等を出す | soft-only。保証テスト禁止 |
| メモの機材希望が弱められる | 登録なし・例外経路なしの製品判断 |
| 偽 conflict のモデル逸脱 | 多様性と同型。パース拒否しない |
| 指示希釈 | 短文 + flag |
| 境界語の出力揺れ | 意図的非網羅 |
| フィードバック学習なし | 非目標 |

---

## 一次レビューとの対応

一次レビュー Important I1–I6 は上表 I1–I4 / abs / CORE と対応し、r2 Revision summary に統合済み。
