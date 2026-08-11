# Triple review: `7e6fa8b`

**SHA:** `7e6fa8b0332cd54dfe8c70ca01eab23f612cd235`  
**Subject:** `feat(e2e): workers 並列と per-test AI 枠 truncate 廃止を導入する`  
**Parent:** `98e3519`  
**Scope (Tasks 10+11):** playwright workers/fullyParallel、e2e/** から per-test truncate 除去、serial 6 file、`e2e-ai-quota-parallel.test.mjs` 新設、`project-config` workers 契約更新。  
**Method:** task report / per-task review / live e2e grep 0 / tooling ソース照合。**本 SHA 時点**の CI 配線・regex は後続 `40baa1c` で強化されるため、**当該 commit 単体の穴として記録**する。  
**既存:** `.superpowers/sdd/e2e-p3-task10-11-review.md`; range `e2e-p3-impl-*`。

---

## 1次レビュー

### Summary

per-test / fixture の global AI truncate を **0** にし、枠リセットを shell（suite / 当時の project 境界）のみに閉じたうえで、`workers: 2` + `fullyParallel: true` を定数導入。race / 共有 storageState / 生成密集 file に file-level serial。fail-closed tooling を新設。製品 20 / E2E 500 は非接触。報告どおり full×2 green（作業 tree）。

### Checklist

| 項目 | 判定 |
| --- | --- |
| e2e/** ensure/reset/truncate 0 | **PASS**（live grep 0; stub は comment-only） |
| shell reset 残存 | **PASS**（当時 suite + mobile→desktop 境界） |
| workers 2 + fullyParallel true 定数 | **PASS**（実装） |
| serial 6 file | **PASS** |
| 製品 20 / Task9 500 | **PASS** |
| Task 10+11 同一 commit | **PASS**（§7.3 dual fail-closed 意図） |

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし（現行 e2e ツリーは clean） |
| Important | **I1** | **本 SHA 時点:** `e2e-ai-quota-parallel.test.mjs` が `ci.sh` / `ci.yml` Local-safe Node に**未掲載**。C2 の「truncate 0」半が PR 静的ゲートから外れる（後続 `40baa1c` で修正）。 |
| Important | **I2** | **本 SHA 時点:** workers 正則が `/workers:\s*2/` 系で **`workers: 20` に部分一致し得る**（後続 `40baa1c` で行アンカー厳密化）。 |
| Minor | M1 | shell reset 出現回数を ≥2 固定していない（当時 2 呼び出し実装）。 |
| Minor | M2 | F7 行ロック residual / ≤10m stretch miss（仕様受容）。 |

### Verdict (1次): **APPROVE_WITH_NITS**（実装本線 PASS; tooling ゲートは Important residual）

> 注: 既存 task10-11-review は Important=0。本 triple は **当該 SHA の CI 接続欠落**を Important と再評価（p3 secondary の A1/A2 と整合）。**既存と部分矛盾 → 本 triple が厳しい側。**

---

## 敵対的レビュー

### Attack: parallel orphan / workers 偽緑 / 製品 20

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | workers=2 のまま fixture が global truncate → 他 worker 枠破壊 | **現行反証 / ゲート弱い** — e2e 0 ヒット。再導入を CI が止めない（I1）。 |
| 2 | `workers: 20` で tooling 偽緑 | **本 SHA で成立し得る**（I2）。live config は literal `2`。 |
| 3 | 製品 compose 20 改変 | **反証** |
| 4 | workers を CI ternary で 1 に戻す逃げ | **tooling doesNotMatch で概ね封じ**（1 と CI workers 分岐）。 |
| 5 | serial 漏れで storageState 汚染 | **主要候補 serial**。shopping/a11y は ephemeral 分離。 |
| 6 | parallel orphan（process 二重） | **本 SHA は shell 二段 mobile→desktop**（案 B 前）。orphan 本線は後続 `06ad4ef`。 |

### Verdict (敵対): **PASS_WITH_RESIDUALS**（I1/I2 Important; 現行 corruption Critical なし）

---

## 2次検証

| ID | 判定 | 重大度 |
| --- | --- | --- |
| I1 CI 未接続 | **CONFIRMED**（当該 SHA） | **Important** — `40baa1c` で close |
| I2 regex 過弱 | **CONFIRMED**（当該 SHA） | **Important** — `40baa1c` で close |
| 製品 20 | **CONFIRMED PASS** | — |
| truncate 0 実装 | **CONFIRMED PASS** | — |
| 既存 task10-11 Important=0 | **PARTIAL 矛盾** — 実装は正しいが **fail-closed ゲート完全性**を過小評価 |

### Verdict (2次): **FIX_THEN_OK**（must-fix = I1+I2 tooling/CI のみ。製品コード不要）

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| task10-11-review: Approved with nits | **実装本線一致** / **tooling ゲート Important でより厳格** |
| p3-secondary A1/A2 | **一致**（本 SHA で穴が開いていた） |
| p3-primary Important=0 | **矛盾（本 triple は A1/A2 を Important）** — secondary 支持 |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| per-test truncate | **0（実装 OK）** |
| workers 偽緑 | **当該 SHA で穴（I2）** → 後続 fix |
| **総合** | **FIX_THEN_OK** → 後続 `40baa1c` で解消済み |
