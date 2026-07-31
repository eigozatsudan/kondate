# 一次レビュー: 実装計画 `2026-07-31-generation-progress-stages.md`

| 項目 | 値 |
|------|-----|
| 対象 | `docs/superpowers/plans/2026-07-31-generation-progress-stages.md`（`80f69c8`） |
| 対照 | 設計 `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md` |
| 日付 | 2026-07-31 |
| 種別 | 実装計画の一次レビュー（read-only） |
| 判定 | **Approve with changes** |
| 二次 | `docs/reviews/2026-07-31-generation-progress-stages-plan-secondary.md` |
| 敵対的 | `docs/reviews/2026-07-31-generation-progress-stages-plan-adversarial.md` |

**照合:** panel / machine / panel.test / a11y / eslint（`strictTypeChecked` + test のみ `no-non-null-assertion` off）/ 設計 L0–L14

---

## Verdict: **Approve with changes**

Task 分割・Locked interfaces・V-C1/V-C2/L1 アルゴリズム全文・a11y 旧 copy 更新方針は設計と整合し、writing-plans の No Placeholders も概ね満たす。

実装開始前に直すべきは **本番コードの `!`（lint）** と **設計 §6.1 の panel テスト行列の不足**。narrowing を Critical とみなす指摘は二次で実測棄却（本リポジトリ TS 5.9.3 では plan 写経パターンが typecheck 通過）。

---

## Findings table

| ID | Severity | Task | Title |
|----|----------|------|-------|
| P1 | Critical→**Reject**（二次） | 3 | `const phase = state.phase` で typecheck 失敗 — **実測では通過** |
| P2 | **Important** | 1–2 | 本番 `GENERATION_PROGRESS_STAGES[0]!` が `@typescript-eslint/no-non-null-assertion` で lint 失敗 |
| P3 | **Important** | 3 | 設計 §6.1 の相対 `startedAt` 行列（0/10s/60s）と unmount interval 掃除が不足 |

---

## Detailed findings

### [P1] narrowing — **二次で Reject**

一次は「`const phase = state.phase` では `state` が narrow されない」と Critical 判定。  
**二次実測（`npm run typecheck`）:** plan と同じ

```ts
const phase = state.phase;
phase === "processing" ? state.data.startedAt : null
```

は **エラーなし**。TS 5.9.3 が discriminant alias を追跡する。  
任意改善として `state.phase === "processing"` 直書きは読みやすいが **ブロッカーではない**。

### [P2] 本番 `!` — **Important（維持）**

`eslint.config.js`: `strictTypeChecked` 既定で `no-non-null-assertion` が error。test ファイルだけ off。

計画の本番:

```ts
GENERATION_PROGRESS_STAGES[0]!.message
```

`npm run lint`（Task 3 ゲート）で落ちる。Task 1–2 は lint を走らせないため commit 後に露呈しやすい。

**Required plan fix:** `stageMessageAt(index)` やリテラル fallback で `!` を除去。

### [P3] panel テスト行列 — **Important（維持）**

設計 §6.1 は processing で `NOW` / `NOW-10s` / `NOW-35s` / `NOW-60s` と unmount 後 interval クリアを必須寄りに列挙。計画は submitting 進行 + processing 35s のみ。

**Required plan fix:** `it.each` で相対帯 + unmount で timer 0。

---

## What the plan gets right

1. L0–L14 / V-C\* の Locked 転記が明確  
2. model → hook → panel/a11y の 3 Task が設計 §7 と一致  
3. Hook アルゴリズムが sticky / 同期評価 / L1 を満たす  
4. a11y 旧固定文を表 OR に置換（旧文は regex 外 → 配線前 RED）  
5. 既存 processing の絶対 `startedAt` を進捗 assert に使わない  
6. early return 前 hook・契約非変更・全文コード・コマンド非連結  

---

## 再レビュー条件

1. 本番から `!` を除去した実装コードを plan に埋め込む  
2. Task 3 に相対 `startedAt` 行列 + unmount cleanup（+ 推奨: submitting→processing rerender）を全文追加  
