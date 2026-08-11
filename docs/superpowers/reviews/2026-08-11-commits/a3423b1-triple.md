# Triple review: `a3423b1` docs: E2E 実行時間短縮の Spec と実装 Plan を追加する

- **Full SHA:** `a3423b19d311ebec866d7647cc8875f9ccbea6b0`
- **Parent:** `89c89bf6d53397bdbad53735635c4bac09f7aa8c`
- **種別:** docs only（`docs/superpowers/specs/` + `docs/superpowers/plans/`）
- **照合:** 初版内容は review package `/tmp/grok-1000/e2e-reduction-review-pkg-2f2d14bc/` と既レビュー `2026-08-11-e2e-runtime-reduction-*.md`、live 実装・tooling
- **手法:** 静的（docs 正確性・退行・false-green 設計リスク。セキュリティより設計ゲート完全性）

---

## 1次レビュー

### Summary

製品 cap（`GLOBAL_DAILY_AI_LIMIT=20` を通常 compose に残す）・privacy ログ・CI ゲート順・acceptance 22/22 を壊さない前提で、Phase 1–3 の段階短縮を書く方針は妥当。一方、**初版のままでは実装に入ると tooling 赤・smoke 形骸・setup 二重・PR merge 穴**が残る。

### Verdict: **REVISE**

### Findings

#### Critical

（製品契約破壊の即時バグは docs 内に無い。ただし次は sign-off 無しでは実装開始不可。）

#### Important

| ID | 箇所 | 内容 |
| --- | --- | --- |
| P1 | Spec §5.3 / Plan Task 4 | PR を smoke のみにすると、初版 §4.2 では pantry / history-regen 等が **merge 前に 0 実行**。full は push 後のみ → merge-time false green |
| P2 | Spec §4.1 / Plan Task 1 | project skip を auth `beforeEach` 集約案。raw `@playwright/test` 3 ファイルを覆わない |
| P3 | Plan Task 2 | smoke 静的ガードが「`@smoke` ≥1」級で、必須ファイル×本数が任意 |
| P4 | Spec §6.3 ↔ Plan Task 7 | setup が dependsOn と shell 1 回で食い違う。config 概形に `dependencies` 残存 |
| P5 | Plan Task 3 | shell 疑似コードが placeholder（`set -- "$@"` / `build_playwright_args` 未完成） |
| P6 | Plan Task 11 | `workers: 1` 固定の `project-config.test.mjs` 更新が Files に無い |
| P7 | Plan / tooling | `expectedE2EInvocations` の smoke/setup/CI restore 追随が Task に落ちていない |

#### Minor

| ID | 内容 |
| --- | --- |
| M1 | docs/README 索引に smoke 未掲載 |
| M2 | Phase 1 full ≤22 分が stretch と明記不足 |

---

## 敵対的レビュー

### Summary

著者バイアス（green CI・短縮目標達成）を前提に突く。**C1（PR smoke のみ merge）と C2（per-test truncate × workers≥2）は成立。** 0 smoke で exit 0 は Playwright 既定で反証可。compose.e2e に GLOBAL limit を載せられないは反証。

### Attack scenarios

| # | 攻撃 | 判定 |
| --- | --- | --- |
| 1 | PR smoke 緑 → full 赤を main に積む | **成立 Critical**（初版 smoke に #9/#13 無し） |
| 2 | Phase 順序破り workers 先行 | **成立 Critical**（truncate 残存の技術ゲート無し） |
| 3 | fixture filter で raw test に skip 効かない | **限定成立**（@mobile-only を foundation に付けなければ当面実害小） |
| 4 | 薄い smoke（1–2 本）で PR green | **成立**（ガード弱い） |
| 5 | setup 二重で storageState 汚染 | **成立しうる** |
| 6 | 0 件 smoke exit 0 | **反証**（pass-with-no-tests 無し） |
| 7 | 製品 20 を E2E 500 で隠す | **residual**（MVP #17 は unit/pgTAP 所有。docs 明示要） |

### Findings

#### Critical

- **C1** PR smoke のみ + 薄い §4.2 → merge-time 穴
- **C2** truncate × workers 並列破壊（Phase 3 順序破りの設計ゲート欠如）

#### Important

- setup モデル未固定、smoke ガード弱、Task 3 placeholder、tooling ピン更新漏れ、seed の `privacyNoticeVersion` 未固定、magic-link 成功 path 縮小 residual

---

## 2次検証

### Cross-walk

| 指摘 | 判定 | 最終 severity |
| --- | --- | --- |
| Adv C1 / Pri P1 | **CONFIRMED** | **Critical**（初版のまま実装開始は不可） |
| Adv C2 | **CONFIRMED** | **Critical**（Phase 3 前） |
| P2 project filter | **CONFIRMED** | Important |
| P3 smoke ガード | **CONFIRMED** | Important |
| P4/P5 setup・shell | **CONFIRMED** | Important |
| 0 smoke exit 0 | **反証 CONFIRMED** | n/a |

### Must-fix before implement（この commit 単体）

1. C1 を設計で閉じる（拡張 smoke / PR full / 明示 sign-off のいずれか）
2. Phase 1 向け: F2 grepInvert 単一入口、F3 必須ファイル×本数固定、Task 3 完成、smoke 分岐 tooling
3. C2/workers は Phase 3 前

### Final: **REVISE / 実装開始 BLOCK**

**理由:** docs コミットとして内容追加は有用だが、**レビュー未反映の初版**であり、この時点の Spec/Plan を正として Task 実装に入ると false-green と tooling 破綻のリスクが高い。次 commit `891431e` での反映が前提。

TRIPLE_REVIEW_COMPLETE
