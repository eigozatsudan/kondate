# External Plan Review: paid-plan-stripe
Reviewer: Codex / GPT-5 Date: 2026-07-29
Worktree HEAD: 126d6cbebb3cc8c17e28168d38ddfe42a7c3df6c
Verdict: REQUEST_CHANGES

## Summary

r1 は既存レビューの大半を計画本文へ具体的に反映しており、C1/C2/C3、ADV-1/3/6/8–15 と major 一式の多くは再掲不要と確認した。一方、Task 6 は TypeScript の v3 cutover だけを列挙し、現行 DB の `generation-command.v2` CHECK・RPC 検証・署名感度 pgTAP を v3 へ同時移行する手順が欠けるため、Task どおりの実装では生成が停止する。さらに Webhook の冪等 claim と entitlement 投影が別 RPC で、順序判定に必要な行情報も read surface に無く、クラッシュまたは競合時に課金状態を永久に取りこぼし得る。Checkout lock の session ID 遷移、削除時の subscription 列挙、Task 逐次実行、最終必須検証にも具体的な不足があるため、実装開始前の計画修正を要求する。

## Counts

• critical: 2

• major: 4

• minor: 0

• nit: 0

• confirmed_fixed_from_prior_reviews: 21

• still_open_from_prior_reviews: 1

## Issue 1: Task 6 が DB の generation-command.v2 制約と再署名 pgTAP を v3 へ切り替えない

• Severity: critical

• Category: code_mismatch

• Location: Task 6 / ADV-3 cutover / `20260729150000_quality_mode_ledgers.sql`

• Evidence: 計画は TS/ブラウザ/Functions の v2 参照と grep gate を列挙するが、対象は `src shared netlify` のみである（計画:1599–1646, 1755–1770）。現行 DB は `ai_generation_requests.request_hmac_version = 'generation-command.v2'` CHECK を持ち（`supabase/migrations/20260722225217_generation_command_v2.sql`:8–13）、最新 reserve 正本も `p_request_hmac_version <> 'generation-command.v2'` を拒否する（`supabase/migrations/20260728150000_identity_daily_quota.sql`:246–249）。Task 6 は `reserve_ai_generation(..., p_quality_mode boolean)` へ再署名する（計画:1651–1654）が、Task 3 で列挙した `rls_inventory.test.sql` 等の署名感度 pgTAP を Task 6 Files に再掲していない。これは prior ADV-4 の「Task6 when quality param lands」が未修正のまま残ったもの。

• Why it matters: ブラウザと Functions が v3 を送り始めても DB CHECK/RPC が v2 を拒否し、通常生成を含む全生成が `invalid_request_hmac` で停止する。DB 制約だけを場当たり的に直すと、旧 overload や EXECUTE grant、既存 pgTAP call site が残り、誤った署名経路を温存する。

• Suggestion: Task 6 Files と RED/GREEN に、DB CHECK の v3 置換、全 SQL 関数内 v2 検証の v3 置換、Task 3 署名の明示 drop、旧 overload 不存在、grant inventory、全 pgTAP fixture/call site の v3 更新を列挙する。grep gate を `supabase/migrations` の歴史 migration へは適用せず、Task 6 migration の実効制約・`supabase/tests/database`・現行コードに対する targeted gate と full db-test で固定する。

• Status: open

## Issue 2: Webhook の idempotency claim・順序判定・投影が crash-safe な単一境界になっていない

• Severity: critical

• Category: abuse

• Location: Task 2 write RPC table / Task 4 webhook

• Evidence: 計画は `insert_billing_webhook_event` を「衝突時 duplicate」とする別 RPC（計画:379）と、`upsert_billing_subscription_from_stripe` を別 RPC（計画:378）に分離する。duplicate は 200 no-op とする RED もある（計画:1208）。ところが entitlement read RPC の固定 JSON は `last_stripe_event_created` / `last_stripe_event_id` / `stripe_subscription_id` を返さない（計画:388–401）一方、same-second 判定は Function 側で行うとしている（計画:378）。設計は `event.created` と現在行を比較することを要求する（設計:483–508）。

• Why it matters: event row を先に insert して Function が subscription upsert 前に落ちると、Stripe 再送は duplicate として永久 no-op になり、支払済みユーザーが Free のまま、または canceled/past_due が反映されず Plus が残る。逆順なら再送・競合時の二重適用窓が残る。さらに現行の read RPC だけでは Function が same-second/terminality 判定に必要な現在行を取得できず、direct DML 禁止下で計画どおり実装できない。

• Suggestion: Task 2/4 に crash-safe な処理境界を具体化する。推奨は event claim、現在行ロック、ordered projection、processed 確定を単一 SECURITY DEFINER RPC/transaction にまとめ、同一秒 retrieve 結果を入力として適用させる方法。別 RPC を維持するなら webhook event に processing/processed 状態と再取得可能な lease を持たせ、失敗再送が再処理できることを RED で固定する。少なくとも「claim 後 crash → retry で最終投影される」「同時に新旧 event → 古い状態へ戻らない」の DB/Function 統合テストを追加する。

• Status: open

## Issue 3: Checkout lock を作成後 Session ID へ更新する write surface がない

• Severity: major

• Category: inconsistency

• Location: Task 2 checkout lock RPCs / Task 4 Checkout

• Evidence: `acquire_billing_checkout_lock` は取得時点で `p_stripe_checkout_session_id text` を必須にし、`release_billing_checkout_lock` は session ID で解放する（計画:382–383）。しかし Stripe Session ID は `checkout.sessions.create` 成功後にしか得られず、計画には lock の session ID を更新する RPC がない。設計は「Session 作成成功後に lock 行へ `stripe_checkout_session_id` を記録し、completed / expired / TTL で解放」と明記する（設計:448–452）。Task 4 の RED は競合 409 だけで、作成後 bind と completed/expired 解放を検証しない（計画:1241–1248）。

• Why it matters: 実装者は存在しない Session ID を acquisition 時に要求されるため、ロック前に Stripe Session を作って二重課金防止を失うか、仮 ID のまま completed webhook で解放できず 30 分利用者をブロックする。

• Suggestion: lock token と nullable session ID を分離する、または `bind_billing_checkout_session(lock_token, session_id)` RPC を追加する。取得→Stripe Session 作成→CAS bind→completed/expired/作成失敗 release の各遷移と、bind 失敗時に作成済 Session を expire する補償処理を Task 4 に明記し、RED を追加する。

• Status: open

## Issue 4: delete-account が customer ID から cancel 対象 subscription を解決する手順を欠く

• Severity: major

• Category: gap

• Location: Task 8 delete-account Stripe cancel

• Evidence: Task 8 は `get_billing_customer_by_user` が返す customer ID から直ちに `Stripe subscriptions.cancel` とだけ書く（計画:2047–2052）。その RPC の固定戻りは `{ stripe_customer_id }` のみ（計画:384）で、`subscriptions.cancel` に必要な subscription ID を返さない。RED も単に `subscriptions.cancel` が呼ばれたことしか要求せず、customer の live subscription 列挙や全件 cancel を検証しない（計画:2061–2067）。設計上、二重 sub 検知時の残差もあるため customer 単位で live subscription が複数あり得る。

• Why it matters: Task follower は cancel に渡す ID を取得できず、ローカル Auth/CASCADE だけを削除して Stripe 請求を残すか、DB の 1 行だけを信じて二重 subscription を取りこぼす。利用者はアカウント削除後も請求され得る。

• Suggestion: Task 8 に `stripe.subscriptions.list({ customer, status: "all" })` 相当で cancel 対象の non-terminal/live subscription を列挙し、全件を best-effort cancel してから Auth delete へ進む具体手順を追加する。0件、1件、複数件、一部 cancel 失敗でも残りを試行し Auth delete は継続する RED を追加し、ログは opaque ID のみとする。

• Status: open

## Issue 5: Task 1 と Task 2 の並列許可がリポジトリの逐次 Task / handoff 制約に反する

• Severity: major

• Category: ops

• Location: 実行順序と依存

• Evidence: 計画は「並列可: Task1 ∥ Task2」と明記する（計画:2302–2314）。一方 `AGENTS.md` は Plan 内 Task を 1 つずつ順番に進め、各 Task のレビュー・検証完了後に write-once handoff を発行して次 Task を開始することを要求する（`AGENTS.md`:58–74）。

• Why it matters: 実装計画に従うだけでは single-writer/handoff の不変条件を破り、Task 単位の確定 interface と HEAD を authority にできない。ユーザー指定ではプロジェクト制約違反は major 以上である。

• Suggestion: 並列可の記述を削除し、Task 1→Task 2→Task 3…の一意な逐次順序と、各 Task 後の verifier→一次 reviewer→別 reviewer 二次検証→handoff を計画末尾に明記する。依存図は論理依存の説明に限定する。

• Status: open

## Issue 6: 最終提出前の必須 9 検証が Task 8 に揃っていない

• Severity: major

• Category: ops

• Location: Task 8 Step 5–7 / 検証コマンド早見

• Evidence: `AGENTS.md`:137–151 は format→lint→typecheck→full `npx vitest run`→`reset-local-db.sh`→profile db-test→E2E→build→diff-check の順を必須とする。Task 8 は focused unit、typecheck/lint/format、E2E、preflight、build、diff-check のみ（計画:2096–2151）。末尾早見にも full Vitest と DB reset がなく、最終欄は E2E/build/diff-check だけである（計画:2318–2355）。

• Why it matters: 8 Task にまたがる wire/RPC/migration/UI 変更を focused test だけで提出できてしまい、全体回帰や fresh-stack migration/pgTAP 失敗を見逃す。コマンド順も必須順と異なるため、後段変更後の DB suite が未検証になり得る。

• Suggestion: Task 8 の commit 前に `AGENTS.md` の 9 コマンドを完全に同じ順・独立コマンドで列挙する。リポジトリ内 script 実行前の差分安全確認も添え、失敗時は失敗ステップ以降を再実行する規則を明記する。

• Status: open

## Prior must_fix disposition

| ID | Disposition |
|----|-------------|
| ADV-1 | fixed_in_plan |
| C1 / ADV-2 | fixed_in_plan |
| ADV-3 | fixed_in_plan |
| ADV-4 | still_open |
| C2 / ADV-5 | fixed_in_plan |
| C3 / ADV-7 | fixed_in_plan |
| ADV-6 | fixed_in_plan |
| ADV-8 | fixed_in_plan |
| ADV-10 / M2 | fixed_in_plan |
| ADV-9 | fixed_in_plan |
| ADV-11 | fixed_in_plan |
| ADV-12 | fixed_in_plan |
| M1 | fixed_in_plan |
| M3 | fixed_in_plan |
| M4 | fixed_in_plan |
| M5 | fixed_in_plan |
| ADV-14 | fixed_in_plan |
| ADV-15 | fixed_in_plan |
| ADV-13 | fixed_in_plan |
| M7 | fixed_in_plan |
| M8 | fixed_in_plan |
| M9 | fixed_in_plan |
| M6 | not_applicable |

## Strengths

• Free 3/6/4/600 と Plus 10/20/8、品質 3/日かつ20/月、チラシ 2/週+try 6 は Task 1/3/6/7 の定数・schema・RPC・RED に明確に固定されている。

• r1 で `generationQuotaSchema`、usage/status plan merge、billing write RPC only、E2E allowlist、quality/flyer release 対称、Free quality reserve 前 403、flyer success-full OpenRouter 0 回が具体化され、旧 critical の大半は閉じている。

• `BILLING_ENABLED=false` の webhook 継続、past_due NULL fail-closed、defense max 非 default、VITE secret 禁止、Hosted Checkout/Portal は計画のインターフェースと RED に反映されている。

• 現行コード inventory（Free literal wire、short CHECK 4、GLOBAL max 20、OpenRouter string content、privacy version、Stripe 未導入、migration stamp）は実ファイルと一致する。

## Recommended fix order

1. Webhook の crash-safe atomic processing/read surface を確定し、Task 2/4 の RPC・RED を直す。
2. Task 6 の DB v3 cutover、旧 overload drop、署名感度 pgTAP 一式を追加する。
3. Checkout lock の acquire→bind→release 状態遷移を固定する。
4. delete-account の customer 単位 subscription 列挙・全件 cancel を固定する。
5. Task 並列記述を逐次/handoff 運用へ合わせる。
6. Task 8 に必須 9 検証を同じ順で追加する。
