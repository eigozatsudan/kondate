# 敵対的レビュー: 実装計画 `2026-07-31-generation-progress-stages.md`

| 項目 | 値 |
|------|-----|
| 対象 | `docs/archive/superpowers/plans/2026-07-31-generation-progress-stages.md`（`80f69c8`） |
| 対照 | 設計 `docs/archive/superpowers/specs/2026-07-31-generation-progress-stages-design.md` |
| 日付 | 2026-07-31 |
| 種別 | 実装計画の敵対的レビュー（read-only） |
| 判定 | **ACCEPT_WITH_CHANGES**（Critical 0・Important 必須改訂あり） |
| 二次 | `docs/archive/reviews/2026-07-31-generation-progress-stages-plan-secondary.md` |

**照合:** panel / machine / a11y / recovery / eslint / `npm run typecheck` による narrowing 実測

---

## Verdict: **ACCEPT_WITH_CHANGES**

アルゴリズム・Task 1–2・a11y 移行方針は攻撃しても大きく崩れない。  
**ブロッカー級 typecheck 失敗は実測で否定**（D-C1 Reject）。残る攻撃面は **lint `!`**、**panel 統合 L1 の false-green**、**§6.1 テスト穴**。

---

## Findings table

| ID | Severity（発行） | 二次後 | Title |
|----|------------------|--------|-------|
| D-C1 | Critical | **Reject** | `phase` 変数経由で typecheck 失敗 — TS 5.9.3 では plan 写経が通過 |
| D-I1 | Important | **Important** | submitting→processing の panel `rerender` テスト欠落（V-I1 false-green） |
| D-I2 | Important | **Important** | §6.1 相対行列・unmount interval 欠落 |
| D-I3 | Important | **Minor** | Task 3 Step 1 で panel RED と a11y 置換が同梱（手順事故） |
| D-I4 | （二次追加） | **Important** | 本番 `!` が lint で落ちる（一次 P2） |
| D-M1 | Minor | Minor | Task 2 typecheck「本 Task 起因のみ」の soft 期待 |
| D-M2 | Minor | Minor | StrictMode ref 再 capture は R8 許容・plan 未注記 |
| — | — | Reject | POSITIVE_INFINITY→0 は設計どおり |
| — | — | Reject | 既存 processing + 旧 startedAt は進捗未 assert のため破壊なし |

---

## Detailed findings

### [D-C1] narrowing typecheck — **Reject（二次）**

発行時は Critical と判定したが、リポジトリで plan 同一パターンを `npm run typecheck` したところ **narrow-check エラーなし**。  
TS 5.9.3 が `const phase = state.phase` 後の `phase === "processing"` で `state` を narrow する。

**任意:** 可読性のため `state.phase === "processing"` 直書きを推奨（Must ではない）。

### [D-I1] panel 跨ぎ L1 欠落 — **Important**

hook 単体には sticky→`startedAt=now` の非後退がある。panel は別 `render` の it のみ。  
実装者が枝内 hook や active 誤配線でも panel 緑になり得る。recovery の visibility→processing は実経路。

**Required:** Task 3 に submitting 10s（stage2）→ processing（`startedAt=now`）の `rerender` it を全文追加。

### [D-I2] §6.1 行列 — **Important**

processing `NOW` / `NOW-60s`、unmount timer 0 が plan に無い。35s 帯だけでは V-I3 部分充足。

### [D-I3] Step 手順 — **Minor**

a11y 置換を Step 1 に混ぜると RED 対象が二重。Step 5 で拾うため致命ではない。分離推奨。

### [D-I4] 本番 `!` — **Important**

`@typescript-eslint/no-non-null-assertion` は本番 error（test のみ off）。計画の `[0]!` は Task 3 lint で落ちる。

### Reject 済み攻撃

| 攻撃 | 結論 |
|------|------|
| Infinity を stage4 に「修正」 | 設計 §3.1 非有限→0。plan each が正 |
| 既存 processing 旧 startedAt 破壊 | 見出し・補足のみ assert → PASS 継続 |
| a11y だけ緩めて常時 stage0 | 35s panel it が防波堤。0/60s 追加で更に堅い |

---

## Focus checklist

| # | 観点 | 結論 |
|---|------|------|
| 1 | TS narrowing via phase | **Reject Critical**（実測通過） |
| 2 | panel wiring typecheck | 写経で typecheck は通る見込み |
| 3 | fake timers + setInterval | 妥当。unmount テスト欠落は D-I2 |
| 4 | a11y regex vs 旧 copy | 正しい移行 |
| 5 | submitting→processing panel | **D-I1** |
| 6 | StrictMode | R8 / D-M2 |
| 7 | 既存 processing + 旧 startedAt | 破壊なし |
| 8 | POSITIVE_INFINITY | 0 が正 |

---

## Required plan locks

1. **[Must] D-I4:** 本番から `!` 除去（`stageMessageAt` 等）  
2. **[Must] D-I1:** panel submitting→processing L1 it  
3. **[Must] D-I2:** processing 相対 0/60s（または each）+ unmount timer  
4. **[Should] D-I3:** Task 3 RED 手順の分割  
5. **[Optional]** wiring を `state.phase` 直書きに（D-C1 予防的可読性）

---

## Bottom line

Critical typecheck ブロッカーは **実測で消滅**。残る Must は lint `!` と panel テスト強化。反映後 **ACCEPT** で実装可。
