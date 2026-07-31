# 敵対的レビュー: 献立作成進捗（体感用）実装

| 項目 | 値 |
|------|-----|
| 対象 | commits `b0dc04b` → `145047b` → `7c8319c` |
| 日付 | 2026-07-31 |
| 種別 | 実装に対する敵対的レビュー（read-only） |
| 判定 | **ACCEPT** |
| 設計 | `docs/superpowers/specs/2026-07-31-generation-progress-stages-design.md` |

**照合:** model / hook / panel / a11y / machine の phase モデル / GenerationPage マウント

---

## Verdict: **ACCEPT**

Critical / Important（confidence ≥ 80）なし。設計時に潰した穴（sticky・同期評価・単一 hook L1・a11y・相対時刻・本番 `!`）はソースとテストで閉じている。残余は設計許容（R1, R6–R8）。

---

## Findings table

| ID | Severity | 二次後 | Title |
|----|----------|--------|-------|
| D-C1 | Critical 候補 | **Reject** | 体感文言による欺瞞が R1 を超える |
| D-C2 | Critical 候補 | **Reject** | submitting→processing で L1 後退 |
| D-C3 | Critical 候補 | **Reject** | Rules of Hooks 違反 |
| D-I1 | Important 候補 | **Reject** | interval リーク |
| D-I2 | Important 候補 | **Reject** | a11y 旧固定文 / live region 破壊 |
| D-I3 | Important 候補 | **Reject** | プライバシー漏えい |
| D-I4 | Important 候補 | **Reject** | 契約境界破壊 |
| D-I5 | Important 候補 | **Reject** | 絶対時刻によるフレーク |
| D-I6 | Important 候補 | **Reject** | §6.1 テスト不足 |
| D-I7 | Important 候補 | **Reject** | StrictMode を製品バグ扱い — R8 |
| D-I8 | Important 候補 | **Reject** | offline で max リセット — 設計どおり |
| D-I9 | Important 候補 | **Reject** | 本番 `!` |
| D-M1 | Minor | Minor | `active→false` 時の timer 0 を明示テストしていない |
| D-M2 | Minor | Minor | a11y が stage を固定しない（意図的） |

---

## 攻撃シナリオ（要約）

### L1 後退 — Reject

単一 hook・`active` が跨ぎで true のまま・`maxStageIndexSeen`・panel V-I2 it（`startedAt=now` でも stage 2 維持）。

### Rules of Hooks — Reject

hook は phase early return より前で常に 1 回。

### Timer リーク — Reject

`useEffect([active])` cleanup で `clearInterval`。unmount it で `vi.getTimerCount()===0`。

### a11y — Reject

旧「料理の組み合わせと全体の段取りを確認しています」assert 削除。表 OR + 見出し + axe。

### プライバシー / 契約 — Reject

固定 5 文言のみ。`Date.parse` は helper のみ。contracts / Functions 未変更。

### offline max リセット — Reject

`active=false` で reset は設計 §3.2。offline は進捗 DOM なし。復帰後は `startedAt` から再計算。

---

## Required fixes

**なし。**

任意 polish（非必須）:

1. `active true→false` で timer 0 の it（D-M1）  
2. a11y で `startedAt≈now` のとき stage0 を固定（D-M2 強化）

---

## Bottom line

実装はロック設計の忠実な着地。ACCEPT — マージ阻害なし。
