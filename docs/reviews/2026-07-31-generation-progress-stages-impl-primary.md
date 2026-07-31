# 一次レビュー: 献立作成進捗（体感用）実装

| 項目 | 値 |
|------|-----|
| 対象 | commits `b0dc04b` → `145047b` → `7c8319c` |
| 日付 | 2026-07-31 |
| 種別 | 実装の一次レビュー（read-only） |
| 判定 | **Approve** |
| 設計 | `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md`（L0–L14） |
| 計画 | `docs/superpowers/plans/2026-07-31-generation-progress-stages.md`（r1） |
| 二次 | `docs/reviews/2026-07-31-generation-progress-stages-impl-secondary.md` |
| 敵対的 | `docs/reviews/2026-07-31-generation-progress-stages-impl-adversarial.md` |

**照合ソース**

- `src/features/generation/model/progress-stages.ts` + test  
- `src/features/generation/hooks/use-generation-progress-message.ts` + test  
- `src/features/generation/components/generation-status-panel.tsx` + progress tests  
- `src/app/accessibility.test.tsx`（processing）

---

## Verdict: **Approve**

confidence ≥ 80 の Critical / Important なし。設計ロック（V-C1/V-C2/L1/V-I1–I4・プライバシー・契約非変更）を満たし、計画 r1 のテスト行列も揃っている。

---

## Findings table

| ID | Severity | File | Title |
|----|----------|------|-------|
| — | — | — | 高信頼度の指摘なし |

---

## ロック別確認

| ロック | 結果 | 根拠（要約） |
|--------|------|----------------|
| V-C1 sticky | Pass | `resolvedAnchorMsRef` は usable 時のみ上書き、null は空のときだけ capture。interval は `setTick` のみ |
| V-C2 同期評価 | Pass | render 時に elapsed 計算。panel `it.each` が advance なしで帯を固定 |
| L1 前進 | Pass | `max(calculated, maxSeen)`。reset は `!active` のみ。panel V-I2 跨ぎ it |
| L11 配線 | Pass | early return 前の単一 hook。`active = submitting \|\| processing` |
| L2/V-I4 | Pass | `resolveProcessingAnchorMs` は helper、hook は `number \| null` |
| L3 表 | Pass | 5 段・境界・JP 文言一致 |
| L6 契約 | Pass | browser feature のみ |
| L7/L8 プライバシー | Pass | 固定表のみ表示 |
| L12/L13 | Pass | 1000ms、`data-progress-stage` |
| L14 テスト | Pass | model / hook / panel / a11y |

---

## 正しい点

1. 純関数 → hook → panel の境界が設計 §4 どおり。  
2. 本番 `!` なし（`stageMessageAt` + リテラル fallback）。  
3. checking / offline / 終端は進捗 DOM を出さない。  
4. processing の見出し・補足・RecoveryLinks は維持。  
5. 日本語コメントで「体感用・サーバと一致しない」を明記。

---

## 非ブロッカー（confidence &lt; 80）

- Render 中の ref 更新は V-C2 意図。StrictMode は R8。  
- 旧 absolute `startedAt` の既存 it は進捗 assert なし（計画許容）。  
- a11y は表の any-of regex（設計 §6.1 許容）。

**推奨:** このまま維持でよい。追加修正は必須でない。
