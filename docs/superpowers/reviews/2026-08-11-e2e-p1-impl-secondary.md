# 2次検証: Phase 1 実装レビュー

- **役割:** 独立 secondary verifier（一次・敵対と非共有コンテキスト）
- **入力:** primary `/tmp/grok-1000/e2e-p1-primary-554fd0e9.md` / adversarial `/tmp/grok-1000/e2e-p1-adversarial-554fd0e9.md` / diff package / live `/home/dev/projects/kondate`
- **手法:** 静的照合のみ（E2E 再実行なし）。Task 5 実測は `.superpowers/sdd/task-5-report.md` を正本として採用。

## Summary

Phase 1 本線（`@smoke` 付与、`KONDATE_E2E_SUITE` smoke/full、CI PR=smoke / push·ci.sh=full、desktop `grepInvert: /@mobile-only/`、account-deletion 非 smoke、docs 注意文）は **live 実装として成立**している。Critical な切替バグは一次・敵対とも無し → 本検証も **反証できない破壊的欠陥は無し**。

指摘の大半は **現行ソースが正しいままの退行ガード弱さ** か **設計受容 residual**。特に F3（full 実測が diff に無い）は **コード欠陥として却下** — Task 5 report に smoke 18/4.2m・full 68/53・desktop a11y 0 の証跡がある。

**Must-fix は 0。** Phase 1 完了判定として **APPROVE_AS_IS**（残件は follow-up）。

## Cross-walk table

| ID | 出所 | 主張 | 判定 | 根拠（live） | Phase 1 深刻度 |
| --- | --- | --- | --- | --- | --- |
| **F1 / I4** | Primary Important / Adv Important | `@mobile-only` が `≥1` のみで幅マトリクス全件を強制しない | **CONFIRMED**（ガード弱） | `e2e-smoke-tags.test.mjs` L63–69 は `countTagLiteral(..., "@mobile-only") >= 1` のみ。live `mobile-accessibility.spec.ts` は 5 定義すべてに `@mobile-only`（L163/179/193/211/243）で **現行は正しい**。1 本残しで他を外すと tooling は緑のまま desktop 二重実行が部分復活しうる | **Minor for Phase 1**（must-fix ではない）。実装完了条件は満た済み；退行耐性の follow-up |
| **F2 / I1** | Primary Important / Adv Important | smoke が「本数」だけで exact title / distinct test を固定しない | **CONFIRMED**（ガード弱） | `countTagLiteral` は `["']@smoke["']` の出現回数のみ（L10–14, L40–48）。title 照合なし。**wrong-title でも min 本数さえ満たせば green** をロジック上確認。live 付与は §4.2 表どおり（例: history-regen `does not consume a success…`、pantry CRUD、oauth 2、full-journey 2 等）で **今は穴が開いていない** | Important residual / **defer OK** |
| **F3** | Primary Important（プロセス） | §5.5 full 計測証跡が実装 diff に無い | **REJECTED as code defect** | 計測は Task 5 の仕事で git にログを載せない前提。`.superpowers/sdd/task-5-report.md` に **smoke 18 passed (4.2m)** / **full mobile 68 (15.8m) + desktop 53 (12.2m)** / desktop `mobile-accessibility` **0 行** / stretch ≤22m 未達を明記。progress にも同値。diff 非含有 ≠ 未実施 | プロセス指摘として情報価値はあるが **ブロッカーにしない** |
| **I2** | Adv Important | `grepInvert` 極性 assert が project 境界を跨ぎ false green | **CONFIRMED**（テスト弱） | `project-config.test.mjs` L166–167 の `name: "mobile-chromium"[\s\S]*?grepInvert: /@desktop-only/` は非貪欲でも **次 project の grepInvert まで伸びうる**。極性逆転 config でも両 assert が match し得る。live `playwright.config.ts` L24–35 は極性正しい（mobile→desktop-only 除外、desktop→mobile-only 除外） | Important residual / **defer OK** |
| **I3** | Adv Important | docs の `--` 付き 1 ファイル起動が効かない | **CONFIRMED**（既知 residual） | `docs/local-development.md` L74 が `./scripts/run-e2e.sh -- e2e/specs/...` を推奨。`run-e2e.sh` は `--` を strip しない（L424–457 で `"$@"` をそのまま `run_playwright` → compose `e2e` entrypoint 末尾連結）。Task 5 report §B が **同形でファイル絞り込みが効かず full 相当 68/53 になった** と実測。CI 本線は無引数のため非影響。修正は (a) wrapper で先頭 `--` を 1 個落とす、または (b) docs を `--` 無し形に直す — どちらも容易 | Important residual（DX）/ **defer OK** for Phase 1 |
| **I5** | Adv Important（設計受容） | PR smoke ≠ acceptance 全量の merge-time 穴 | **CONFIRMED as design residual, not code bug** | Spec §5.3 / docs 注意文どおり。account-deletion / billing / a11y 全幅 / race 大半は full。#9/#13 を smoke に入れ C1 縮小済み。実装欠陥ではない | 設計 residual — コード修正不要 |
| F4 | Primary Minor | count がコメント等にも反応 | **PARTIAL** | 単純リテラル count は真だが実害低。F2/I1 に包含 | Minor |
| F5 / M2 | Primary / Adv Minor | `-g=*` 未検出 | **CONFIRMED** 稀 | `e2e_args_have_grep` は `--grep` / `--grep=*` / 単独 `-g` のみ（L382–390） | Minor |
| M1 | Adv Minor | caller `--grep` があると smoke でも `@smoke` 非付与 | **CONFIRMED** 意図的 | 明示引数優先（L430–432）。CI 無引数 | Minor |
| M3 | Adv Minor | compose 側 suite 検証が文字列ピン中心 | **CONFIRMED** 弱だが二重固定 | `local-development-scripts` の `expectedE2EInvocations(..., "smoke")` が実行論証 | Minor |

### 特別確認（依頼項目）

1. **F1/I4 は Phase 1 で Important か Minor か**  
   → **Phase 1 ゲート上は Minor（非 must-fix）**。完了条件「desktop a11y 0」は実装 + Task 5 実測で満たす。`≥1` は退行ガードの穴であり、**今のツリーが壊れている証拠ではない**。follow-up としての優先度は I1 より低くてよい（マトリクス全件固定は有用だが smoke セット誤差し替えより影響面が狭い）。

2. **F2/I1 wrong-title でも green か**  
   → **Yes, CONFIRMED。** tooling は title を一切見ない。例: `history-regeneration.spec.ts` の `@smoke` を別 test に移し本数 1 を維持すれば `e2e-smoke-tags` は pass。現行 live title は表と一致。

3. **F3 をコード欠陥として REJECT できるか**  
   → **Yes。** `.superpowers/sdd/task-5-report.md` + Task 5 primary review Approved が証跡。diff に計測が無いこと自体は欠陥ではない。

4. **I2 極性弱テスト**  
   → **CONFIRMED。** 実装 OK / assert が局所化不足。

5. **I3 `--` strip**  
   → **CONFIRMED real residual**（report 実測 + docs 推奨形 + wrapper 非 strip）。CI 非影響、fixable。

6. **I5**  
   → **Not a code bug.**

## Must-fix (deduplicated, prioritized)

**なし。**

Phase 1 の CI 本線・タグ現行値・suite 分岐・desktop a11y 0 実測は揃っており、マージ／Phase 1 完了を止める実装欠陥は二次検証でも再現できない。

## Safe to defer

優先順（非ブロッカー follow-up）:

1. **I1 / F2** — smoke ガードを distinct test 件数、できれば exact title（または title 近傍 `tag: ["@smoke"]`）へ強化。PR から e2e-only path が静かに消える false-green が最大の残存リスク。
2. **I2** — `grepInvert` を project ブロック単位で固定（非跨ぎ regex / 簡易パース）。
3. **I3** — docs から有害な `--` を除去、または `run-e2e.sh` 先頭で `--` を 1 個 strip。tooling で推奨形をピン。
4. **I4 / F1** — `@mobile-only` を `test(` 定義数と一致、または幅ループ内 5 シナリオ全 tag を固定。
5. **I5** — 運用（branch protection / merge queue）の話。コード変更不要。docs 注意文で十分。
6. Minors（F4/F5/M1/M2/M3）— 必要ならまとめて。

## Final: **APPROVE_AS_IS**

**理由:**

- Critical: 0（一次・敵対・二次で一致）。
- Important のうち **現行破壊**に相当するもの: 0。
- F3 は Task 5 実測でクローズ済み → コード欠陥 REJECT。
- F1/I4 は Phase 1 では **Minor residual**（ガード強化は follow-up）。
- I1/I2/I3 は妥当な Important residual だが CI 本線・Phase 1 成功条件を壊していない。
- I5 は設計受容。

Phase 1 は **APPROVE_AS_IS** で完了扱いでよい。tooling 強化と docs/`--` 修正は別 PR で十分。

SECONDARY_REVIEW_COMPLETE
