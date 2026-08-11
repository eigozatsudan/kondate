# Triple review: `40baa1c`

**SHA:** `40baa1c5b151bd4f6c5dad260ea580bb9dab6876`  
**Subject:** `fix(e2e): Phase3 レビュー指摘の CI 配線と workers 正規表現を直す`  
**Parent:** `29d33f1`  
**Scope:** `scripts/ci.sh`, `.github/workflows/ci.yml`, `tests/tooling/project-config.test.mjs`, `tests/tooling/e2e-ai-quota-parallel.test.mjs`（任意 compose docs pin）。  
**目的:** p3-secondary must-fix **A1 + A2** の解消。

---

## 1次レビュー

### Summary

1. **A1:** `tests/tooling/e2e-ai-quota-parallel.test.mjs` を `ci.sh` / `ci.yml` Local-safe Node 列挙へ追加。`project-config` が script/workflow 双方に path を pin。
2. **A2:** workers / fullyParallel を行アンカー厳密マッチ  
   `^\s*workers:\s*2\s*,?\s*$` 等。`workers: 20` 部分一致偽緑を封じる。

live 確認:
- `scripts/ci.sh` L25: e2e-ai-quota-parallel 掲載
- `ci.yml` L48: 同
- `project-config.test.mjs` L187 / L281–282
- `e2e-ai-quota-parallel.test.mjs` L99–100

製品 20 / playwright workers:2 実装値は非変更（正しいまま）。

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | — | なし（A1/A2 を閉じた） |
| Minor | M1 | shell reset 出現回数の厳密 pin は未着手（案 B 後は 1 回契約へ変化するため別問題）。 |
| Minor | M2 | Mailpit 静的ガード / full×2 プロセス residual は本 fix 範囲外。 |

### Verdict (1次): **APPROVE_AS_IS**

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | 再導入 per-test truncate が PR Local-safe をすり抜ける | **反証（本線）** — CI が e2e-ai-quota-parallel を実行 |
| 2 | `workers: 20` で project-config 緑 | **反証** — 行末アンカー; `"20"` は match しない |
| 3 | ci.sh だけ追加・ci.yml 忘れ | **反証** — project-config が双方 match を要求 |
| 4 | 製品 20 を触る | **反証** — 本 diff 非対象かつ未変更 |
| 5 | 偽緑: tooling 自身を削除 | **低 residual** — project-config が path を pin するため削除は別 assert で red |

### Verdict (敵対): **PASS**

---

## 2次検証

| 主張 | 二次 |
| --- | --- |
| A1 closed | **CONFIRMED** |
| A2 closed | **CONFIRMED**（`workers: 20` は `/^\s*workers:\s*2\s*,?\s*$/mu` に不一致） |
| p3-secondary FIX_THEN_OK 条件 | **充足** → Phase 3 ゲート完全性は **APPROVE 相当** |
| 製品コード変更不要方針 | **CONFIRMED** |

### Verdict (2次): **APPROVE_AS_IS**

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| p3-secondary must-fix A1+A2 | **本 commit がそのまま実装** — 矛盾なし |
| option-b-adv「workers:20 は p3 指摘で閉じ済み」 | **一致**（本 SHA 以降） |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| workers 偽緑 | **封じ** |
| parallel orphan | **対象外**（案 B 前） |
| **総合** | **APPROVE_AS_IS** |
