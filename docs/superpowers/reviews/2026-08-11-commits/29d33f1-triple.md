# Triple review: `29d33f1`

**SHA:** `29d33f1a78f6f96226868d61b41e92128825feff`  
**Subject:** `perf(e2e): CI でのスタック復元を短縮し Phase 3 を閉じる`  
**Parent:** `aa83c7c`  
**Scope (Task 13):** `scripts/run-e2e.sh` CI restore 省略 / SKIP_RECREATE fail-closed、tooling、`docs/local-development.md`。  
**既存:** task13 report; p3-impl range の close SHA。

---

## 1次レビュー

### Summary

- `CI=true` cleanup で auth/app force-recreate 復元を省略（GHA / ci.sh の `down --volumes` 前提）。
- `KONDATE_E2E_SKIP_RECREATE=1` は開発反復用。`CI=true` 同時指定は lock 前 **exit 2**。
- tooling が CI reject / CI no restore / SKIP no start recreate を固定。
- docs に workers / limit 表 / SKIP 開発専用を追記。
- 製品 20 / preflight 非接触。Phase 3 close 宣言。

### Spec §7.7–7.8

| 要件 | 判定 |
| --- | --- |
| 開始 force-recreate 既定 | **PASS** |
| CI+SKIP exit 2 | **PASS** |
| CI restore 省略 | **PASS**（`CI=true`） |
| 同一 SHA full×2 | **プロセス residual** — Task 11 証拠引用。本 SHA full×1 + flaky retry |

### Findings

| Sev | ID | 内容 |
| --- | --- | --- |
| Critical | — | なし |
| Important | **I-carry** | **本 SHA 時点で未解消の前段穴:** A1（quota-parallel 未 CI）・A2（workers regex）は本 diff が直していない（`40baa1c` へ持ち越し）。close 宣言のゲート完全性としては residual。 |
| Important | **I-process** | §7.8 同一 SHA 2 連続 full が close SHA 未充足 + flaky 3 本 retry（コード欠陥ではない）。 |
| Minor | M1 | `ci.sh` が `CI=true` を export しない → ローカル ci.sh は restore 省略が効かず安全側。 |
| Minor | M2 | SKIP dirty env（開発専用・exit 2 済み）。 |

### Verdict (1次): **APPROVE_WITH_NITS**（振る舞い PASS; ゲート完全性は follow-up）

---

## 敵対的レビュー

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | CI で SKIP_RECREATE が有効 → dirty full | **反証** — exit 2 + tooling 実行論証 |
| 2 | CI で restore 省略により次 job が汚染 | **反証（GHA）** — always `down --volumes` |
| 3 | 製品 20 改変 | **反証** |
| 4 | workers 偽緑 / truncate 再導入 | **本 commit 非修正** — 前段 I1/I2 残存 |
| 5 | parallel orphan | **案 B 前の shell 二段** — 本線対象外 |

### Verdict (敵対): **PASS_WITH_RESIDUALS**（SKIP/CI 本線 OK; ゲート穴は持ち越し）

---

## 2次検証

| 主張 | 二次 |
| --- | --- |
| CI+SKIP exit 2 | **CONFIRMED PASS** |
| CI restore 省略 | **CONFIRMED PASS** |
| 製品 20 | **CONFIRMED PASS** |
| A1/A2 未解消 at this SHA | **CONFIRMED** — p3-secondary FIX_THEN_OK と整合 |
| A5 process residual | **CONFIRMED**（コード必須修正なし） |

### Verdict (2次): **FIX_THEN_OK**（must-fix は前段 tooling → `40baa1c`）

---

## 既存結論との照合

| 既存 | 本 triple |
| --- | --- |
| p3-primary APPROVE_WITH_NITS Important=0 | **部分矛盾** — 本 triple は A1/A2 持ち越しを Important residual 扱い（secondary 支持） |
| p3-secondary FIX_THEN_OK | **一致** |
| task13 DONE_WITH_CONCERNS | **一致**（flaky / 2 連続 / stretch） |

---

## 最終判定

| 軸 | 結果 |
| --- | --- |
| 製品 quota 20 | **非接触** |
| SKIP×CI 偽緑 | **封じ済み** |
| workers/truncate ゲート | **当該 SHA では未完** → 次 commit |
| **総合** | **FIX_THEN_OK**（close 実装は可; ゲート follow-up 必須だった） |
