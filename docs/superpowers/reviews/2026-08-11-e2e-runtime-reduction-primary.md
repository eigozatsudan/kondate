# 1次レビュー: E2E 実行時間短縮 Spec/Plan

**対象:** パッケージ `/tmp/grok-1000/e2e-reduction-review-pkg-2f2d14bc/` の `spec.md` / `plan.md`（および同梱の `playwright.config.ts`・`run-e2e.sh`・`compose.e2e.yaml`・CI/auth 抜粋）  
**照合先（実装が正）:** `/home/dev/projects/kondate` の現行 E2E・tooling・acceptance-matrix・plan-quota・fixtures  
**レビュー種別:** 設計適合・Spec↔Plan 網羅・セキュリティ/プライバシー・CI ゲート完全性・false-green リスク

## Summary

本設計は、製品の `GLOBAL_DAILY_AI_LIMIT` 既定 20 / preflight / OpenRouter mock 決定論 / acceptance-matrix 22+8 を壊さず、タグ付き smoke・fixture 高速化・E2E 閉包の limit 上書きと並列化を段階導入する方向として妥当である。Phase 分割・非目的・ロールバック・privacy ログ維持は明確で、現行 `run-e2e.sh` の mobile→reset→desktop 二段実行と共有枠の理由も正しく捉えている。

一方、**Phase 2 の setup project と二段実行の関係が Spec と Plan で食い違い**、**project フィルタの接続点が fixture グラフと raw `@playwright/test` 利用を覆い切れていない**、**Phase 3 の `workers: 1` 固定 tooling と `local-development-scripts` の起動シーケンス契約が Task に十分載っていない**、**smoke 固定セットの静的ガードが弱く PR false-green を許し得る**点が、実装前に直すべき Important ブロッカーである。加えて、global AI の単一行 `FOR UPDATE` は limit を 500 にしても並列生成を直列化し得る残存 flaky/timeout 源であり、Phase 3 完了条件の説明が不足している。

## Verdict

**REVISE**（Important が複数 open。Critical な製品契約破壊は見当たらないが、このまま Task 実行に入ると Phase 1–3 で tooling 赤・auth 再利用二重実行・smoke 形骸化のリスクが高い）

## Findings

### F1 — Severity: Important
- Doc: both
- Location: Spec §6.3 / Plan Task 7
- Description: Spec は `setup → mobile/desktop dependsOn` を正として書く一方、Plan Task 7 は「shell で setup を 1 回だけ走らせ `dependencies` を外す」を推奨し、同じ Task 内の config 概形にはまだ `dependencies: ["setup"]` が残る。現行 `run-e2e.sh` は project 未指定時に **Playwright を 2 回**起動する（mobile 全件 → quota reset → desktop 全件）ため、`dependencies` 付きのまま二段実行すると setup / `e2e/.auth/user.json` 書き込みが二重になり、storageState 競合・無駄な magic-link・失敗時の診断困難を招く。
- Why it matters: Phase 2 の中核アーキテクチャが未固定のまま実装に入ると、実装者ごとに異なる解になり、tooling の起動シーケンス契約（`tests/tooling/local-development-scripts.test.mjs` の `expectedE2EInvocations`）も追随不能になる。
- Suggestion:
  1. Spec §6.3 を **「full は Phase 2 でも shell 二段を維持。setup は `run-e2e.sh` が mobile の前に `--project=setup` を 1 回だけ実行。mobile/desktop の `dependencies` は使わない」** に書き換える（または Phase 3 で単一 `playwright test` に統合する時期を明記）。
  2. Plan Task 7 の config 概形から `dependencies` を削除し、`run-e2e.sh` の疑似コードと `local-development-scripts.test.mjs` の期待配列更新を **必須 Step** にする。
  3. smoke（1 project）時は setup を 1 回だけ、または setup 不要な ephemeral のみ、のどちらにするかを 1 行で固定する。
- Status: open

### F2 — Severity: Important
- Doc: both
- Location: Spec §4.1 / Plan Task 1
- Description: project skip を `auth` fixture の `beforeEach`（＋ extend 出口への `installProjectFilter`）に集約する案だが、現行 suite は次の 3 系統が混在する:
  - raw `@playwright/test`: `foundation.spec.ts` / `oauth-mock.spec.ts` / `auth-callback-security.spec.ts`
  - `auth` 直接: settings / onboarding / mobile-accessibility 等
  - `authTest.extend`: `history.ts` / `shopping.ts` / `acceptance.ts`
  
  Plan 自身が「子への伝播を Playwright 版で確認」と未確定のままにしており、**「1 か所集約」契約を満たさない**。Phase 1 で `@mobile-only` を付ける主対象は `mobile-accessibility`（auth 経由）のため当面動く可能性はあるが、将来タグや shopping/history への `@mobile-only` 付与で silent 二重実行が再発する。
- Why it matters: desktop で a11y マトリクスを「0 実行」にする完了条件（Spec §5.5）は auth 経由なら達成し得るが、フィルタ機構がスイート全体の不変条件になっていない。extend で hook が継承されない場合、Task 1 の注意書きだけでは実装漏れが起きやすい。
- Suggestion:
  - **推奨（fixture 非依存）:** `playwright.config.ts` の project 定義で `grepInvert: /@desktop-only/`（mobile）/ `grepInvert: /@mobile-only/`（desktop）を使い、skip を config 1 か所に固定する。
  - または全 spec を共通 `e2e/fixtures/base.ts` の `test` に寄せ、raw `@playwright/test` を禁止する tooling テストを追加する。
  - `installProjectFilter` を採用するなら、auth / history / shopping / acceptance の **全 export** と raw 利用 3 ファイルの移行を Task 1 の必須チェックリストにする（「確認する」で終わらせない）。
- Status: open

### F3 — Severity: Important
- Doc: plan
- Location: Task 2 Step 3 / Spec §4.2
- Description: smoke 固定セットは Spec でファイル・本数方針まで固定されているが、Plan の静的ガードは「`@smoke` が 1 件以上」「`@mobile-only` が mobile-accessibility にある」程度。必須ファイルリスト照合は任意。これではタグ付け忘れ・誤った 1 本だけの smoke・セット改変時の表未更新を CI が検知できない。
- Why it matters: PR ゲートが smoke のみになる（Spec §5.3）ため、ガードが弱いと **PR が実質ほぼ E2E なしで green** になり得る（`--grep @smoke` で 0 件なら fail だが、1–2 件の薄いセットでは false-green）。acceptance-matrix の e2e owning の多くが PR で走らなくなる前提なので、セットの機械的固定がゲート完全性の中心になる。
- Suggestion:
  - `tests/tooling/e2e-smoke-tags.test.mjs` で Spec §4.2 の **必須ファイル × 最低本数**（または exact title リスト）を固定する。
  - セット変更は同テストと Spec 表の同時更新を必須とし、Plan の「任意」を削除する。
  - 可能なら `KONDATE_E2E_SUITE=smoke` 時に「実行予定件数の下限」（例: ≥12）を list reporter または専用スクリプトで fail-closed する。
- Status: open

### F4 — Severity: Important
- Doc: plan
- Location: Task 11（および Task 9–13 全般）/ 現行 `tests/tooling/project-config.test.mjs`
- Description: 現行 tooling は次を **ハード固定**している:
  - `project-config.test.mjs`: `workers: 1` が playwright.config に存在すること
  - 同: CI 分岐で workers を変えるパターンを明示拒否（過去の `process.env.CI ? { workers: 1 }` 退行防止）
  
  Plan Task 11 は `workers: 2` + `fullyParallel: true` に変更するが、**Files に `project-config.test.mjs` が無く**、断言の更新方針も無い。Phase 3 着手時点で tooling が必ず赤になる。
- Why it matters: ゲート契約テストを更新せず workers を上げると CI の Local-safe Node ステップで即 fail。逆に断言を雑に緩めると「workers 1 必須」の意図（共有 auth/DB）を失う。
- Suggestion:
  - Task 11 に `tests/tooling/project-config.test.mjs` 更新を必須化。
  - 断言を「`workers` が 1 または 2（定数）であり、調査なしの動的 CI 分岐パターンは禁止」など、Phase 3 設計に合わせた **新しい契約**に書き換える。
  - `fullyParallel: true` も同様に固定または許可に更新する。
- Status: open

### F5 — Severity: Important
- Doc: plan
- Location: Task 7 / Task 13 / 現行 `tests/tooling/local-development-scripts.test.mjs`
- Description: `expectedE2EInvocations` は base up → auth recreate → quota reset → app 群 recreate →（mobile → quota reset → desktop）→ logs →（失敗時 kill/rm）→ auth/app 復元 を配列で完全固定している。Plan は Task 3 で compose 系の文字列テストに触れるが、**setup 段追加（Task 7）・CI 時 restore 短縮（Task 13）・smoke 時 1 段実行**がこの期待配列に与える影響を Task の Files/Step に落としていない。
- Why it matters: このファイル群は CI の node:test 列挙に含まれ、run-e2e の挙動回帰を実プロセス起動で検出する。設計どおりシェルを変えても tooling 未更新なら Phase 2/3 で長期 red、または実装が tooling に引きずられて中途半端な互換になる。
- Suggestion:
  - Task 3: smoke 時は playwright 1 回・中間 quota reset なし、を `expectedE2EInvocations` の分岐（env `KONDATE_E2E_SUITE`）でテスト。
  - Task 7: setup 1 回を期待配列の mobile 前に挿入。
  - Task 13: `CI=true` 時の restore 省略/短縮を別ケースで固定。ローカル経路は現行 restore を維持。
- Status: open

### F6 — Severity: Important
- Doc: both
- Location: Spec §6.4 / Plan Task 6
- Description: onboarding seed は「実装が正・偽スキーマを Plan に固定しない」とあるが、agentic 実装向けには **投入必須条件が不足**している。現行 `completedOnboardingPage` は (1) welcome で家族導線 (2) メンバー 1 名 + allergy none (3) planner 到達 (4) `/privacy` 同意 UI を経る。生成系は privacy 同意後を前提にし、`acceptance.ts` は `public.privacy_consents` を必須ファミリーに含む。Task 6 の interface コメントは触れるが、Step は「migrations を読んで埋める」に逃げており、**成功条件の RED テスト（seed 後に `/planner` と生成 CTA が使える等）が薄い**。
- Why it matters: 不足 seed（`onboarding_status` 未更新、privacy 未投入、member 0 人）は settings の一部だけ緑・full-journey で赤、という部分 green を生む。Plan self-review の「Placeholder なし」とも矛盾する。
- Suggestion:
  - Task 6 に「参照実装」を明示: `e2e/fixtures/acceptance.ts` の `createServiceAdmin` / owned seed、`profiles.onboarding_status`、`privacy_consents`、最低 1 `household_members`。
  - seed の契約テスト（Vitest または焦点 E2E）で、seed 直後に welcome へ戻されない・privacy 導線を踏まず planner に留まれる、を必須化する。
  - UI onboarding owning（`onboarding.spec.ts` / full-journey household）が seed を使わないことを Task チェックリストで再確認。
- Status: open

### F7 — Severity: Important
- Doc: both
- Location: Spec §7.2–7.4 / Plan Task 9–11
- Description: Phase 3 は `compose.e2e.yaml` で `GLOBAL_DAILY_AI_LIMIT=500`（製品 max）とし test ごと truncate を廃止して `workers≥2` する。limit 引き上げ自体は製品 max 以内・通常 `compose.yaml` の 20 不変で **契約上は妥当**。しかし現行アーキテクチャでは `private.ai_global_daily_usage` の単一行 `FOR UPDATE` により、**予約がアプリ全体で直列化**される（README / 過去レビューでも既知）。limit 500 は枯渇は防ぐが、**並列生成の壁時計短縮効果を打ち消し、Function budget 下での lock wait を flaky 化し得る**。Spec §2.3 は truncate 競合は述べるが、この直列ロックを Phase 3 リスク表に載せていない。
- Why it matters: 「workers≥2 で ≤10 分」の完了条件が、生成系が bulk の suite では達成不能または不安定になり、実装が workers を無理に上げて retry で隠す圧力がかかる（Spec 非目的に抵触）。
- Suggestion:
  - Spec §9 リスク表に「global usage 行ロックによる生成直列化」を追加。
  - Phase 3 成功指標を「workers≥2 かつ full green」と「生成系以外の UI テスト並列で短縮」に分解し、生成重いファイルは `@serial` または低並列を許容する。
  - ≤10 分はハードウェア + ロック制約で未達なら説明で可、と既にある文言を「行ロックが主因になり得る」まで具体化する。
  - tooling で `compose.yaml`=20 / `compose.e2e.yaml`=500（または製品 max 以下）を Task 9 どおり固定し、**本番 preflight が 500 を「推奨運用値」と誤読しない**コメントを compose.e2e に必須化（製品 max 到達は ENV で可能なだけ、運用推奨は別、と明記）。
- Status: open

### F8 — Severity: Important
- Doc: both
- Location: Spec §4.2 / §5.3 / §9
- Description: PR smoke は意図的に薄い。acceptance-matrix 上 e2e が主 owning の path のうち、少なくとも次が **full/push のみ**になる:
  - MVP #13 `history-regeneration`（二重成功消費防止）— smoke 0
  - MVP #9 `menu-domain-pantry` — smoke 0（unit バックアップあり）
  - MVP #2 の「reused continuation 拒否」— auth-callback は cancel/expired のみ smoke
  - account-deletion（Notes 所有）— 破壊的として除外は妥当
  
  Spec は「push に full を残す」「薄く main だけ red」リスクを認識している。ただし **ブランチ保護で push full が merge 必須か**、release-checklist が full を要求し続けるかの運用が設計パッケージ内で閉じられていない。`docs/testing/release-checklist.md` は引き続き `./scripts/run-e2e.sh`（full 既定）でよく、Plan も更新対象にしていない（これは正しい）が、「PR green ≠ merge 可能」の一文が Spec/Plan/local-development に不足。
- Why it matters: GitHub の required check が PR job のみだと、#13 等の回帰が main 直撃後に初めて見つかる。設計として許容するなら、その前提を明示しないと false confidence。
- Suggestion:
  - Spec §5.3 / §9 に「merge 前に full が required であること（push ゲートまたは protected branch rule）を運用前提とする。PR smoke は早期シグナルであり acceptance 全量の代替ではない」と明記。
  - smoke から外す e2e-only owning（特に #13）について、full 必須である旨を acceptance-matrix Notes か local-development に 1 行追記する Task を Phase 1 に入れる。
  - 必要なら #13 を smoke に 1 本入れるトレードオフを Phase 1 計測後に再評価（Spec の変更手続きで可）。
- Status: open

### F9 — Severity: Important
- Doc: plan
- Location: Task 3 / Plan self-review
- Description: Task 3 の `run-e2e.sh` 実装例に `set -- "$@"` の no-op、`extra=`、`:` だけの枝があり、`build_playwright_args` もコメントのみ。Plan self-review は「Placeholder なし」と宣言しているが、**実装可能な疑似コードになっていない**。`--grep=@smoke` と `--grep @smoke` のどちらに固定するか、引数を `run_playwright` にどう渡すかも未決。
- Why it matters: shell の引数再構築はバグりやすく、二段実行・明示 `--project` 優先・不正 suite の exit 2 という契約を落とすと smoke/full が意図と逆に動く。
- Suggestion:
  - Task 3 に **完成形に近い** `build_playwright_args` / smoke 分岐（portable `/bin/sh`）を書き切る。
  - 不正 suite・smoke 1 段・full 2 段・呼び出し側 `--project`/`--grep` 優先の 4 ケースを tooling で固定。
  - self-review の「Placeholder なし」を撤回するか、残プレースホルダ一覧を Plan 末尾に置く。
- Status: open

### F10 — Severity: Important
- Doc: both
- Location: Spec §7.4–7.5 / Plan Task 11–12
- Description: 並列時の残存 flaky ベクトルのうち、設計が十分に閉じていないもの:
  1. **Mailpit 共有** — storageState / Admin 注入で減らせるが、Task 12 は方式未選択（Spec は YAGNI で 1 方式）。Phase 3 完了条件「ephemeral の過半数を高速経路」は方式決定が前提。
  2. **同一 storageState ユーザの汚染** — `@ephemeral-auth` と serial は言及あるが、reused に移す spec の判定チェックリストが Plan に無い。
  3. **race 系以外の共有 DB**（Realtime revalidate、history seed、shopping）— `@serial` 対象が shopping-list-races 中心で、history-safety の Realtime/focus 系が並列で不安定になり得る。
  4. **retries: CI 2** — 並列 flaky を retry で隠す圧力（Spec 原則 5 と緊張）。
- Why it matters: Phase 3 は「2 連続 full green」を完了条件にするが、失敗時の切り分け（workers を下げるな、とだけ書いて原因類型が少ない）と、Task 12 の方式未決が後続ブロッカーになる。
- Suggestion:
  - Task 12 を Phase 3 前半に固定方式（推奨: Admin `generateLink` で URL 取得し Mailpit 回避、session 形状を 1 つに固定）で書く。
  - `@serial` 候補を「DB/Realtime/同一ユーザ共有」の観点でファイル一覧化する（最低: shopping-list-races、同一 storageState describe、history-safety の相互依存があれば）。
  - flaky 時は retry 消化数を記録し、Phase を戻す判断基準を数値化（例: 同一 SHA で retry 消化 > N）。
- Status: open

### F11 — Severity: Minor
- Doc: both
- Location: Spec §5.4 / §10 / Plan Task 5
- Description: ドキュメント更新が `docs/local-development.md`（と任意 README）に閉じている。運用索引 `docs/README.md` や release-checklist は full のままで機能上は正しいが、**新しい smoke 概念が運用ドキュメント地図に載らない**。shots（`e2e/playwright.shots.config.ts`）は非目的で妥当。`.run-e2e.lock` 維持・function server（`KONDATE_E2E_FUNCTION_SERVER`）非変更も妥当で、パッケージはこれらを壊す指示をしていない。
- Why it matters: 発見性の問題。設計欠陥というより運用の追随漏れ。
- Suggestion: Phase 1 で `docs/README.md` の local-development 行に「smoke/full」を括弧追記する程度で足りる。release-checklist は full 維持を明示コメント 1 行あるとより安全。
- Status: open

### F12 — Severity: Minor
- Doc: plan
- Location: Task 1 `installProjectFilter` 型
- Description: `import type { test as baseTest } from "@playwright/test"` は value export を type-only で扱うため、実装時に型エラーまたは不正確な `typeof` になり得る。Plan はフォールバック interface を書いており致命傷ではない。
- Why it matters: 実装ノイズ。F2 の config 集約に寄せれば不要。
- Suggestion: `{ beforeEach: ... }` 最小 interface のみにするか、config `grepInvert` に切り替え。
- Status: open

### F13 — Severity: Minor
- Doc: spec
- Location: §1 目標壁時計 Phase 1 full ≤22 分
- Description: 現状 full ≈30 分のうち desktop a11y 重複排除は約数分規模。認証固定費削減は Phase 2、並列は Phase 3。Phase 1 完了条件は「短縮 or 説明」で逃げ道があるが、表の ≤22 は達成困難に見え、後から「目標未達＝失敗」と誤読され得る。
- Why it matters: プロセス上の期待値管理。品質ゲートそのものではない。
- Suggestion: Phase 1 の定量目標を「desktop で mobile-accessibility 本体 0 + smoke ≤12 分」を必須にし、full ≤22 は stretch と明記。
- Status: open

## Spec↔Plan coverage gaps

| Spec 要求 | Plan 対応 | ギャップ |
| --- | --- | --- |
| §4 タグ / smoke セット | Task 1–2 | smoke セットの **機械的固定**が弱い（F3） |
| §4.1 skip 1 か所 | Task 1 | raw `@playwright/test` と extend 伝播が未解決（F2） |
| §4.3 suite モード | Task 3 | 実装疑似コードが未完成、シーケンス tooling 不足（F9/F5） |
| §5 CI PR smoke / push full / ci.sh full | Task 4 | ゲート順（`./scripts/run-e2e.sh` 残存）は妥当。`KONDATE_E2E_SUITE` 分岐は project-config の **順序テストを壊さない**（env のみ）。OK |
| §5.4 docs | Task 5 | local-development 中心。README 索引・release 前提の明記が薄い（F8/F11） |
| §6.2–6.3 storageState / setup | Task 7 | Spec dependsOn vs Plan shell 1 回が未収束（F1） |
| §6.4 seed onboarding | Task 6 | 必須カラム/参照実装/RED 条件が不足（F6） |
| §6.5 quota reset 縮小 | Task 8 | 方針は妥当。呼び出し列挙は grep 依存で取りこぼしリスク（許容範囲だが generation fixture 一覧を Files に列挙した方がよい） |
| §7.2 E2E GLOBAL limit | Task 9 | compose 分離は良い。製品 max=500 と運用推奨の混同防止コメントが要る（F7） |
| §7.3 truncate 廃止 | Task 10 | Task 9 後である順序は正しい |
| §7.4 workers / serial | Task 11 | `project-config` の workers:1 固定更新が欠落（F4）。serial 対象が薄い（F10） |
| §7.5 認証高速化 | Task 12 | 方式が実装時選択のまま（F10） |
| §7.7 CI cleanup | Task 13 | local-development-scripts 期待配列の CI 分岐が未記載（F5） |
| §8 成功指標 | Phase ゲート | 実測は人間/Verifier 依存で OK。flaky 指標が弱い（F10） |
| 非目的: 製品 limit 不変 | Task 9 tooling | 方向性 OK。通常 compose=20 固定を必須のまま維持すること |
| 非目的: shots | 対象外 | OK |
| acceptance-matrix 22+8 | 原則維持 | owning title 不変なら更新不要で OK。smoke 薄さの運用前提が不足（F8） |
| CI privacy / DISABLE_TRACE | Task 4 維持 | OK（現行 ci.sh/ci.yml と一致） |
| `.gitignore` e2e/.auth/ | Task 7 | OK（現行に未収録なのを追加する形） |

**Task が invent しがちな箇所（再掲）:** Task 6 スキーマ、Task 3 shell 引数組立、Task 7 setup×二段実行、Task 12 認証方式。

## Positive notes

- **製品契約を触らない**方針が貫かれている（通常 `GLOBAL_DAILY_AI_LIMIT=20`、preflight 不変、OpenRouter は mock、trace 無効と privacy assert 維持）。
- 現状の直列理由（共有 AI 枠・Mailpit/GoTrue・race・単一 DB/lock）の整理が実装（`run-e2e.sh` コメント、auth fixture の毎回 truncate、compose.e2e のメール上限 1000）と一致している。
- Phase 分割とロールバック単位が明確で、Phase 1 を単独マージ可能単位にしているのは運用上よい。
- smoke から account-deletion を外す判断、UI onboarding を owning spec に残す判断、sharding を同一 DB で採用しない判断は健全。
- CI ゲート順テストは `./scripts/run-e2e.sh` の存在だけを見るため、`KONDATE_E2E_SUITE` の env 分岐自体は **順序契約と両立**する（Task 4 の方針は正しい）。
- `GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX = 500`（`shared/contracts/plan-quota.ts`）と E2E 推奨 500 の数値整合は取れている。
- タグ導入前の現行 `e2e/specs` にタグが無い状態を前提にした導入 Task になっている。

## Questions for human (optional)

1. **ブランチ保護:** PR の required check は smoke のみか、merge 前に full（push）成功を必須にするか。後者でない場合、F8 の #13 等を smoke に入れるべきか。
2. **Phase 2 の二段実行:** limit 20 の間は shell 二段維持でよいか。それとも Phase 2 の時点で E2E limit を先に上げ、単一 Playwright プロセス + project dependencies に寄せるか（F1 の選択）。
3. **Phase 3 目標 ≤10 分:** global 行ロックを許容した上での stretch goal でよいか。生成系を serial に寄せて UI のみ並列、でも完了条件を満たすとするか。
4. **smoke に MVP #13（history-regeneration）を含めるか** — e2e-only の成功枠二重消費防止であり、PR で拾う価値が高い。

---

## 改訂時の最小アクションリスト（実装前）

1. Spec §6.3 と Plan Task 7 を **同一の setup 起動モデル**に収束（F1）。
2. project フィルタを **config `grepInvert` または全 fixture/raw 移行の必須リスト**に固定（F2）。
3. smoke セットの node:test を **必須ファイル/本数固定**に強化（F3）。
4. Task 3/7/11/13 に **compose / local-development-scripts / project-config** の更新 Step を明示（F4/F5/F9）。
5. Task 6 に seed 必須エンティティと参照実装パスを固定（F6）。
6. Phase 3 リスクに global 行ロックと serial 対象拡大を追記（F7/F10）。
7. PR smoke ≠ acceptance 全量、を Spec/docs に明記（F8）。

PRIMARY_REVIEW_COMPLETE
