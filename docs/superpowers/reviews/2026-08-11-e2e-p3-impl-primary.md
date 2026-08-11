# 1次レビュー: Phase 3 E2E 短縮 実装

- **範囲:** `9ebfe82`（Phase 2 end）..`29d33f1`（HEAD, Task 13）
- **コミット列:**  
  `98e3519` Task 9 · `7e6fa8b` Tasks 10+11 · `aa83c7c` Task 12 · `29d33f1` Task 13
- **資料:** Spec `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md` §7 全体 / Plan Tasks 9–13  
  報告: `.superpowers/sdd/e2e-p3-task{9,10-11,12,13}-report.md`  
  既存 per-task レビュー: `e2e-p3-task{9,10-11,12}-review.md`（Task 13 レビューは無し）
- **手法:** 静的解析のみ（full E2E / Docker tooling は本 Reviewer が再実行していない）。live tree を Spec §7.2–7.8 と照合。
- **live HEAD 照合:** `compose.e2e.yaml` / `compose.yaml` / `playwright.config.ts` / `e2e/fixtures/*` / `scripts/run-e2e.sh` / `tests/tooling/*` / `docs/local-development.md` / `shared/contracts/plan-quota.ts`

## Summary

Phase 3（E2E 専用 `GLOBAL_DAILY_AI_LIMIT`・per-test truncate 廃止・`workers: 2` + `fullyParallel`・Admin `generateLink` 既定・CI cleanup 短縮）は **Spec §7 と Plan Tasks 9–13 に概ね忠実**。製品 local 20 / product max 500 / preflight は不変。E2E 緩和は `compose.e2e.yaml` + fixture + runner に閉じている。

特に強い点:

1. **§7.3 fail-closed が同一変更セット**（Task 10+11 単一 commit）で、`e2e/**` 内 truncate 0 と `workers: 2` 定数を tooling が固定している。
2. **generateLink は GoTrue verify 経由の実トークン**を storage に載せる。`addInitScript` 手注入なし・service role は Node `.env` のみ・Mailpit 成功 path（setup + auth-recovery）を残す。
3. **CI+`KONDATE_E2E_SKIP_RECREATE` は入口 exit 2**、CI restore 省略とローカル restore 維持が golden + compose 文字列ピンで固定されている。
4. **F7 行ロックと ≤10 分 stretch 未達**が report で正直に説明されており、workers=1 への逃げは無い。

残るのは **完了ゲートのプロセス証跡**（HEAD での full 2 連続は Task 11 SHA 引用、Task 13 で flaky+retry あり）と tooling の **退行耐性の穴**（workers 正則・shell reset 呼び出し本数）。いずれも現行ツリーの仕様逸脱というより close 証跡・将来退行ガード。**Critical は無し。**

## Verdict: APPROVE_WITH_NITS

| Axis | Result |
| --- | --- |
| 1. Spec §7.2–7.8 compliance | **PASS**（§7.8 項 3 の 2 連続は中間 SHA 証跡 + 項 6 stretch miss は文書化） |
| 2. Security / ownership | **PASS** |
| 3. Flaky / race under workers=2 | **PASS with residual**（serial 配置妥当・F7 既知・HEAD flaky はプロセス残渣） |
| 4. Residual risks (F7 / ≤10m) | **PASS**（説明済み・許容） |
| 5. Docs / tooling fail-closed | **PASS with nits** |

| Final | **APPROVE_WITH_NITS** |
| Completion blocker? | **No**（Critical = 0, Important = 0） |

---

## Findings

### Critical

（なし）

### Important

（なし — コード上の §7 逸脱・製品契約破壊・secret 漏洩は確認されず）

### Minor（nits — 非ブロッキング）

#### M1. §7.8「同一 SHA 2 連続 full green」の証跡が Task 11 SHA に留まり、generateLink 後 HEAD では 1 回のみ

- **Confidence:** 78  
- **Where:** Spec §7.8 項 3 / Task 11 report（`7e6fa8b` 作業 tree ×2）/ Task 12 report（full×1）/ Task 13 report（full×1、flaky 3 本が retry 後 green）  
- **Why:** workers=2 の安定性は Task 11 で立証済み。一方 Task 12 は ephemeral 認証経路を実質差し替えており、flaky プロファイルが変わり得る。Task 13 の単発 full では `history detail both modes fit 430px` / desktop `auth-recovery` isolated WebView / desktop settings member edit が flaky（retry 成功）。Spec §8.1 は「同一 SHA で full 2 連続。retry 消化が増えたら原因調査」とある。  
- **Suggestion:** Phase 3 クローズ宣言前に **HEAD `29d33f1` で full ×2** を 1 度取り、retry 本数が Task 11 比で増えていないことを handoff/PR に 1 行。未実施でもコード修正必須にはしない（honest residual）。

#### M2. tooling の `workers: 2` 正則に word boundary が無い

- **Confidence:** 72  
- **Where:** `tests/tooling/e2e-ai-quota-parallel.test.mjs` L92 `/workers:\s*2/u` · `tests/tooling/project-config.test.mjs` L186 `/workers: 2/u`  
- **Why:** 将来 `workers: 20` / `21` に誤変更しても positive assert が通る（`workers: 1` 禁止側は `\b` あり）。現行 tree は literal `workers: 2` のため実害なし。  
- **Suggestion:** `/workers:\s*2\b/u`（または `,` / 行末）に揃える。

#### M3. shell 境界の AI reset が「文字列 1 回以上」しか固定されていない

- **Confidence:** 74  
- **Where:** `tests/tooling/e2e-ai-quota-parallel.test.mjs` L83–87（`run-e2e.sh` に `reset-e2e-ai-quota.sh` が match するだけ）  
- **Why:** live は suite 開始（L473 付近）と mobile→desktop 境界（L531 付近）の **2 呼び出し**がある。片方削除しても tooling は緑のまま。full の project 境界枯渇防止が静かに弱まる。  
- **Suggestion:** 呼び出し回数 ≥2、または両制御フロー近傍の assert。

#### M4. generateLink 経路の localStorage 書き込みは「glue」であり SPA ネイティブ hash 消費ではない

- **Confidence:** 70  
- **Where:** `e2e/fixtures/auth.ts` `loginAsNewUser`（GoTrue verify → hash キャプチャ → `localStorage.setItem(browserSupabaseSessionStorageKey, …)` → clean `/planner`）  
- **Why:** Spec §7.5 が禁止するのは **`addInitScript` による session 形状の手注入**。実装は action_link を開き、GoTrue が付けた **実トークン**を、製品の `detectSessionInUrl: false` 制約下で storage に載せる。Task 12 レビューと同じ分類: **§7.5 違反ではない**。将来メンテナが「Mailpit フォールバック」や「トークン捏造」へ簡略化しないようコメントは既に十分だが、二次で再確認推奨。  
- **Suggestion:** 変更不要。二次は「手注入禁止」の境界解釈を追認するだけ。

#### M5. 生成を含む一部 file が serial 外（Spec 候補外・許容）

- **Confidence:** 68  
- **Where:** `shopping-list.spec.ts` / `mobile-accessibility.spec.ts` 等  
- **Why:** Spec §7.4 必須候補（races / 共有 storageState / history-safety 相互依存 / 生成密集）は 6 file で serial 済み。上記は共有 storageState も intra-file 相互依存も明示されない。F7 下では予約待ちで遅延し得るが、workers=1 へ戻す必要はない。将来 timeout flaky が増えたら **file serial 追加が第一レバー**。

---

## Spec §7.8 Phase 3 完了チェックリスト

| # | 条件 | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | `compose.e2e.yaml` のみ高い `GLOBAL_DAILY_AI_LIMIT`、通常 compose は 20（tooling 固定） | **PASS** | `compose.e2e.yaml` L15–19 `"500"` + 必須コメント; `compose.yaml` L148 `"20"`; `compose.test.mjs` L423–426 |
| 2 | per-test global truncate 0 の tooling が緑 | **PASS（静的）** | `e2e/**` に `ensureAiQuotaForGeneration` / `resetGlobalAiQuotaForE2e` / `truncate private.ai_global_daily_usage` **0**（grep 確認）; `e2e-ai-quota-parallel.test.mjs` 禁止針 + shell 残存; `reset-global-ai-quota.ts` は comment-only `export {}` |
| 3 | `workers: 2` + `fullyParallel: true` で full が **同一 SHA 2 連続 green** | **PASS（Task 11 SHA）/ HEAD は 1 回** | `playwright.config.ts` L8/L15; project-config + e2e-ai-quota-parallel 固定; Task 11: full×2 EXIT 0（mobile 68 + desktop 53）。Task 12/13 HEAD は full×1（M1） |
| 4 | generateLink 高速経路が ephemeral 既定、Mailpit 成功 path ≥1 本 | **PASS** | `authenticatedPage` → `loginAsNewUser`（Admin generateLink）; Mailpit: `auth.setup.ts` + `auth-recovery.spec.ts`（`@smoke` 含む）; oauth/callback/cancel·expired は UI 維持 |
| 5 | 生成系は serial 許容。短縮は UI 並列中心で説明可能 | **PASS** | serial 6 file（races / billing-plus / full-journey / generation-recovery / history-regen / history-safety）; report が UI 並列 + F7 を説明 |
| 6 | ≤10 分は stretch。未達なら行ロック / ハードウェアを説明 | **PASS（stretch miss 文書化）** | Task 11 ~18–20m wrapper; Task 12 ~15m list; Task 13 ~18m。F7 単一行 `FOR UPDATE` + 生成 serial + 二段 project + start recreate を明示 |
| 7 | 製品 preflight / 本番 env 契約テストが緑 | **PASS（回帰なし・静的）** | `plan-quota.ts` `globalDailyAiLimitProductMax: 500` 不変; `preflight-production.mjs` 501 reject 不変; Phase 3 が製品 limit/preflight を編集した痕跡なし |

### §7.2–7.7 詳細マトリクス

| 節 | 要件 | 判定 | 根拠 |
| --- | --- | --- | --- |
| **7.2** | E2E のみ 500、通常 20、製品 max 上げない、コメント必須 | **PASS** | compose.e2e ENV のみ; コメントに運用 20 分離 / E2E 並列 / PRODUCT_MAX / safety factor |
| **7.3** | suite/project shell reset のみ; test/fixture truncate 0; workers>1 で dual fail-closed; Task 10+11 同一 PR | **PASS** | `run-e2e.sh` L473 + L531; e2e 0 呼び出し; 単一 commit `7e6fa8b`; tooling 2 ファイル |
| **7.4** | workers 2 定数; fullyParallel true; serial 候補; F7 residual | **PASS** | config 定数; CI workers 三項なし; serial 6; F7 説明済み |
| **7.5** | generateLink のみ採用; addInitScript 禁止; Mailpit ≥1; UI path 維持; fail-closed | **PASS** | 上記 + throw のみ（Mailpit フォールバックなし）; storage は実トークン glue（M4） |
| **7.6** | shard 不採用 | **PASS** | `--shard` / Compose 分離 shard なし |
| **7.7** | 開始 force-recreate 既定; SKIP 開発のみ; CI+SKIP exit 2; CI restore 短縮; tooling 更新 | **PASS** | `run-e2e.sh` L22–25 / L257–265 / L456–481; `expectedE2EInvocations({ci,skipRecreate})`; local-dev tests 3 本; docs |

---

## Security / ownership

| Check | Result | Evidence |
| --- | --- | --- |
| service role は Node fixture のみ | **PASS** | `auth.ts` `createServiceAdmin` / `seed-onboarding` / `acceptance`: `.env` の `SERVICE_ROLE_KEY`、`persistSession: false`。page evaluate へ key 非渡与（session JSON + storageKey のみ） |
| 製品 `GLOBAL_DAILY_AI_LIMIT` 20 不変 | **PASS** | `compose.yaml` L148; tooling pin |
| 製品 max / preflight 不変 | **PASS** | `plan-quota` 500; preflight 501 reject |
| VITE 秘密の新設なし | **PASS** | compose.e2e に VITE_/SERVICE なし; 既存 publishable 読取パターンのみ |
| quota theater（E2E で limit=20 UX 非証明） | **Spec 許容残渣** | docs に local 20 / E2E 500 分離; MVP #17 は unit/pgTAP |

---

## Flaky / race under workers=2

| 領域 | 評価 |
| --- | --- |
| AI 共有枠 truncate race | **緩和済み** — per-test truncate 0 + shell 境界のみ + limit 500 |
| F7 行ロック | **既知残渣** — 生成予約はアプリ全体直列。短縮は UI 並列。≤10m 未達の主因候補として文書化 |
| 共有 storageState | **serial** — `billing-plus` のみ `reusedCompletedPage`、file serial |
| race 系 | **serial** — `shopping-list-races` |
| Realtime / focus 相互依存 | **serial** — `history-safety-change` |
| 生成密集 | **serial** — full-journey / generation-recovery / history-regeneration |
| 認証並列 | **緩和** — ephemeral は generateLink（Mailpit 非経由）; メール一意（title+browser+workerIndex+timestamp）; setup Mailpit は shell 1 回 |
| Task 13 flaky 3 本 | **residual** — retry 後 EXIT 0。workers=1 逃げなし。M1 の再計測推奨 |

---

## Docs / tooling fail-closed completeness

| 項目 | 判定 |
| --- | --- |
| `docs/local-development.md` workers / limit 表 / SKIP 開発専用・CI 禁止 / CI restore 省略 | **PASS**（L79–103） |
| `compose.test.mjs` limit + runner SKIP/CI 文字列 + guide ピン | **PASS** |
| `e2e-ai-quota-parallel.test.mjs` truncate 0 + workers | **PASS**（M2/M3 nits） |
| `project-config.test.mjs` workers 2 契約 | **PASS** |
| `local-development-scripts.test.mjs` CI reject / CI no restore / SKIP no start recreate / host CI・SKIP 遮断 | **PASS** |
| §7.2 必須コメント本文の tooling pin | **任意残渣**（Task 9 M1）— 値は固定済み |

---

## Residual risks (explicit)

1. **F7** `private.ai_global_daily_usage` 単一行 `FOR UPDATE` — limit 500 でも予約直列。製品意味を変えない前提で許容（Spec §7.4 / §9）。  
2. **stretch ≤10 分未達** — 実測 15–20 分帯。説明済み。必須ゲートは「workers≥2 で 2 連続 green + 相対短縮」であり stretch は目安。  
3. **HEAD での 2 連続未実施 + flaky retry** — M1。  
4. **Phase 2 由来の別残渣**（本 Phase 非対象）: `@ephemeral-auth` allowlist 静的テスト、tracked `e2e/.auth` tooling 等。seed の portion/spice は **現行 tree で修正済み**（`seed-onboarding.ts` L62–63）— Phase 2 REVISE 項目は Phase 3 範囲外だが live は緑側。

---

## Positive notes

1. Task 10+11 を同一 commit にし、§7.3「truncate 残存で workers 禁止」を運用と tooling の両方で塞いだ。  
2. generateLink 実装が製品 `detectSessionInUrl: false` を壊さず、`redirect_to=/login` + `framenavigated` で hash ロスト flaky を潰している。  
3. CI restore 省略と SKIP_RECREATE を **同時**に fail-closed し、tooling がホスト `CI`/`SKIP` 漏れ込みを空既定で遮断。  
4. 製品契約（compose 20 / max 500 / preflight / mock 決定論 / lock / privacy assert 経路）を触っていない。  
5. 各 Task report が stretch miss・F7・flaky を隠さず、workers=1 ロールバック逃げをしていない。

---

## Candidate findings for secondary revalidation

二次検証エージェントはコンテキストを共有しない前提で、次を **独立に CONFIRMED / PARTIAL / REJECTED** すること。

| ID | Claim (primary) | Why revalidate | Suggested live checks |
| --- | --- | --- | --- |
| **P1** | §7.3: `e2e/**` に per-test truncate / ensure / reset が **0**、shell のみ残存 | 並列枠破壊の中核。grep 取りこぼし・shots 経由の再導入を否定する | `rg` で 3 needles; `reset-e2e-ai-quota.sh` + `run-e2e.sh` の 2 呼び出し; tooling ソース一致 |
| **P2** | §7.5: generateLink は **addInitScript 手注入ではない**（実トークン glue 許容） | 敵対的に「localStorage 書き込み = 手注入」と再 litigate されやすい | `loginAsNewUser` フロー; `page.evaluate` 引数; service role 非露出; fail-closed throw; Mailpit ≥1 |
| **P3** | service role が page / VITE / ログ経路に漏れない | セキュリティ軸の最重要 | `createServiceAdmin` 3 箇所; evaluate payload; compose.e2e に SERVICE/VITE secret 無し |
| **P4** | 製品 limit 20 / max 500 / preflight が Phase 3 で不変 | 非目的違反の否定 | `compose.yaml` / `plan-quota` / `preflight-production.mjs` が range で実質未変更 |
| **P5** | serial 6 file が §7.4 候補を十分カバーし、共有 storageState は billing-plus のみ | workers=2 偽 green / 汚染 | `describe.configure serial` 一覧; `reusedCompletedPage` 参照 grep |
| **P6** | CI+SKIP exit 2 が lock 前・Docker 0 回; CI cleanup が restore 無し | §7.7 偽 green / CI 汚染 | `run-e2e.sh` 先頭 if; `expectedE2EInvocations` の `ci`/`skipRecreate`; テスト 3 本 |
| **P7** | §7.8 項 3 の 2 連続 green が **Task 11 SHA のみ**で、HEAD は flaky residual | プロセス完了ゲートの厳密さ | Task reports の数値; HEAD で full×2 が無いか; flaky タイトル |
| **P8** | F7 + ≤10m stretch miss の説明が十分で、必須ゲートを破っていない | stretch を必須と誤読していないか | Spec §1/§7.4/§7.8 文言 vs reports |
| **P9** | tooling 穴 M2（workers 正則）/ M3（reset 呼び出し 1 回 match） | Important 昇格の要否 | 正則が `workers: 20` を通すか; reset 本数 assert の有無 |
| **P10** | Task 13 の flaky 3 本が workers=2 固有の共有状態汚染ではない | race 再発の否定 | 各 flaky タイトルの独立性（layout / isolated WebView / settings）; serial 対象外であることの妥当性 |

---

## 推奨フォロー（マージ後でも可）

1. **HEAD で full ×2**（M1 / P7）— Phase 3 クローズ宣言前に推奨。  
2. tooling harden M2/M3 — follow-up で可。  
3. flaky 3 本が再現するなら serial 追加やテスト側決定論を調査（workers=1 へ戻さない）。

---

PRIMARY_REVIEW_COMPLETE
