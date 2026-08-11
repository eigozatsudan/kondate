# 敵対的レビュー: E2E 実行時間短縮 Spec/Plan

**対象:**  
- Spec: `docs/superpowers/specs/2026-08-11-e2e-runtime-reduction-design.md`（package `spec.md`）  
- Plan: `docs/superpowers/plans/2026-08-11-e2e-runtime-reduction.md`（package `plan.md`）  
- 照合実装: `/home/dev/projects/kondate`（read-only）

**レビュー姿勢:** 設計を通したい著者バイアスを前提に、false green・CI が本番を守れない経路・quota/security 退行・並列 flaky・受け入れ穴を優先して突く。

---

## Summary

設計の大枠（E2E 緩和を `compose.e2e.yaml` に閉じる、製品 `compose.yaml` の `GLOBAL_DAILY_AI_LIMIT=20` を触らない、`@mobile-only` で a11y 二重実行を削る、smoke/full を `KONDATE_E2E_SUITE` で切る）は実装の現状と整合し、いくつかの攻撃（grep ゼロ件で exit 0、acceptance title の `${String(width)}` 破壊、compose.e2e が env を載せられない）は **反証または低リスク** と判定できる。

一方で **Critical が 2 件**ある。

1. **PR ゲートを smoke に落とすと、受け入れ E2E 所有の path（pantry / history-regen 等）がマージ前に走らない。** full は `push` to `main` の **マージ後** にしか走らない。ブランチ保護が PR チェックのみだと、壊れた full を積んだまま「CI 緑」で merge できる。
2. **Phase 2 の test ごと global truncate が残ったまま Phase 3 の `workers≥2` を入れると、共有 DB 上で予約カウンタが消える並列破壊が起きる。** Plan は順序を文章で禁じるが技術ゲートが無く、Task 11 の Files 一覧も tooling ピン更新を漏らしている。

Phase 1 単独でも (1) は発生するため、**現状のまま実装開始は BLOCK_WITH_CONDITIONS** とする。条件を満たせば段階実装は妥当。

---

## Attack scenarios validated or refuted

| # | 攻撃シナリオ | 判定 | 根拠（実装照合） |
| --- | --- | --- | --- |
| 1 | smoke 緑 → full 赤を main に載せ、本番相当が守られない | **成立（Critical）** | `.github/workflows/ci.yml` は `pull_request` と `push: branches: [main]`。Plan Task 4 は PR のみ `KONDATE_E2E_SUITE=smoke`。full はマージ後 push。PR 必須チェックが workflow 全体でも **PR 実行時の E2E は smoke だけ**。 |
| 2 | seed onboarding が UI 検証を飛ばし、onboarding 所有が drift | **部分成立（Important）** | 現行 `completedOnboardingPage` は UI で member + `/privacy`（`auth-fixture-excerpt.ts` / `e2e/fixtures/auth.ts`）。seed 化後も Spec は `onboarding.spec` / `full-journey` household を UI 所有に残す。ただし seed が `privacy_consents.notice_version` を現行 `privacyNoticeVersion`（`2026-07-29.v1`）で固定しないと生成ゲートが壊れ得る。Plan は「相当」止まりで version を固定していない。 |
| 3 | E2E を limit=500 にし、製品 20 のバグが E2E で永遠に見えない（quota theater） | **成立だが緩和済み（Important / residual）** | generate は `env.openRouter.globalDailyLimit` → `reserve_ai_generation` / `reserve_ai_repair_call` の `p_global_limit`（`generation-repository.ts`）。現状 E2E も fixture が `truncate private.ai_global_daily_usage` し **20 到達を避けている**。MVP #17 の global は unit/pgTAP 所有。500 は「E2E が 20 を証明する」幻想を強めるが、**新規に 20 証明を捨てる**わけではない。 |
| 4 | workers>1 で worker A が truncate、B の予約が消える | **Phase 順序を破ると成立（Critical）** | 共有表 `private.ai_global_daily_usage` を `resetGlobalAiQuotaForE2e` が全 truncate。認証 fixture / `seedGeneratedMenu` / shopping 生成が呼ぶ。Phase 3 は test ごと truncate 廃止が前提。Task 10 前に Task 11 をやると CI 限定 flaky。 |
| 5 | Admin/session 注入で PKCE/magic-link セキュリティ E2E が空洞化 | **部分反証 + residual** | Plan Task 12 は `oauth-mock` / `auth-callback` を UI path 維持。`auth-callback-security` / `oauth-mock` は `@playwright/test` 直 import で別経路。ただし現行 `authenticatedPage` が毎回 magic-link+Mailpit を踏むカバレッジは大幅減。magic-link 成功 path を setup 1 回に縮めるなら、少なくとも 1 本の Mailpit 成功 E2E を `@smoke` or full 固定で残す必要あり。 |
| 6 | `@mobile-only` で desktop の 916px 等レイアウト退行が沈黙 | **概ね反証** | `mobile-accessibility` は 320/375/430 を `setViewportSize` しており desktop project でも同じ幅の Chromium 再実行が主。`generation-recovery-results.spec.ts` は **両 project** で `[320, 390, 916]` ループを保持（smoke 対象の result details 含む）。desktop 専用レイアウトの穴は残るが Critical ではない。 |
| 7 | `--grep @smoke` が 0 件で exit 0、または全件実行 | **概ね反証** | lock は Playwright **1.61.1**。公式は `tag: '@fast'` + `npx playwright test --grep @fast`。`--pass-with-no-tests` は既定 off → 0 件は非 0 exit。全件誤実行はタグ未付与時に smoke が空振りする方向。Plan の静的ガードが「`@smoke` 文字列 ≥1」だけなのは弱いが false green の本命ではない。 |
| 8 | setup project が mobile/desktop 2 段で二重実行 | **成立しうる（Important）** | 現行 `run-e2e.sh` は project 未指定時 mobile → reset → desktop の **2 プロセス**。Plan Task 7 は shell 側 setup 1 回を推奨し `dependencies` 二重を避ける。実装が `dependsOn` のまま 2 段だと setup 2 回・`user.json` 上書き競合。 |
| 9 | `KONDATE_E2E_SKIP_RECREATE` が CI で有効 | **Plan 上は禁止、実装漏れで成立** | Task 13 は CI 同時指定で exit 2。tooling 固定が無いと env 事故で auth rate-limit / 古い app env のまま full が走る。 |
| 10 | acceptance `${String(width)}` が smoke 320 のみで verify 破壊 | **反証** | `verify-acceptance-matrix.mjs` は **ソース文字列の部分一致**。title は `` fit ${String(width)}px `` のまま残り、runtime が 320 のみ `@smoke` でも verify は通る。 |
| 11 | run-e2e lock と 1 プロセス 2 project の衝突 | **反証（現状）** | `.run-e2e.lock` は checkout 単位の多重 **wrapper** 禁止。1 wrapper 内の workers や 2 段実行は想定内。 |
| 12 | tooling が shell 文字列をピン留めし、Plan 変更で silent break / 赤 CI | **成立（Important）** | `tests/tooling/compose.test.mjs` が force-recreate / mobile→desktop / restore を正規表現固定。`local-development-scripts.test.mjs` の `expectedE2EInvocations` が argv 完全一致。`project-config.test.mjs` が `workers: 1` を固定。Task 11 の Files に project-config が無い。 |
| 13 | compose.e2e の force-recreate が GLOBAL limit を載せられない | **反証** | 現行も `compose.yaml` + `compose.e2e.yaml` で auth/app を force-recreate。e2e 側は既に `OPENROUTER_*` / `KONDATE_E2E_FUNCTION_SERVER` を上書き。`GLOBAL_DAILY_AI_LIMIT: "500"` を同経路で足せば app 再生成で読まれる。**現状 e2e には limit キー無し**（Task 9 で追加する前提は正しい）。 |
| 14 | project-filter を auth にだけ付け、素の `@playwright/test` に効かない | **限定成立（Minor〜Important）** | `foundation` / `oauth-mock` / `auth-callback-security` は base test 直 import。`@mobile-only` を付けなければ実害なし。filter を「全 e2e の単一入口」と称すると嘘。 |

---

## Findings (Critical/Important/Minor)

### Critical

#### C1. PR smoke のみでは受け入れ E2E 所有 path がマージ前に走らず、false green merge が可能

- **信頼度:** 95  
- **箇所:** Spec §5.3 / Plan Task 4; 実装 `.github/workflows/ci.yml` L3–6, L77–83; `docs/testing/acceptance-matrix.md`  
- **説明:**  
  smoke から明示除外される主な E2E 所有は:
  - **MVP #9** `menu-domain-pantry.spec.ts`（pantry CRUD / planner 復元）— smoke 0  
  - **MVP #13** `history-regeneration.spec.ts`（二重 success 消費禁止）— smoke 0  
  - **Notes** `account-deletion.spec.ts` — full のみ  
  - billing-plus — smoke 0（unit 寄せと明記）  
  full は `push` to `main` のジョブで走るが、GitHub の「必須ステータス」が **pull_request の verify** だけだと、マージ判定時点では smoke しか見ていない。main が後から赤でも、既に壊れたコードが main に載る。Spec §9 の「full を push ゲートに残す」は **事後検知** であり **merge 阻止** ではない。  
- **修正要求（いずれか必須）:**  
  1. **推奨:** PR でも full を残し、smoke は開発者ローカル / 任意 job に留める。または  
  2. PR: smoke 必須 + **merge queue / 保護ブランチで `push` full 成功を required** と運用文書と CODEOWNERS に固定（人間 sign-off 付き）。または  
  3. smoke に **受け入れ E2E 所有の最小セット**（少なくとも pantry 1・history-regen 1・account-deletion は重いなら staging-evidence へ正式移管）を入れ、matrix と PR 説明テンプレを更新。  
  「push で full」だけでは **BLOCK 解除条件を満たさない**。

#### C2. Phase 2 の global truncate 残存 × Phase 3 workers は共有枠破壊（並列 corruption）

- **信頼度:** 92  
- **箇所:** Spec §2.3, §7.3; Plan Task 8/10/11; 実装 `e2e/fixtures/reset-global-ai-quota.ts`, `auth.ts`, `history.ts` (`seedGeneratedMenu`), `shopping.ts`  
- **説明:**  
  `truncate private.ai_global_daily_usage` は **スイート全体の予約/送信カウンタ**を消す。workers≥2 で test A が truncate すると、test B が `reserve_ai_generation` で確保した global reserved が消え、枯渇・偽 red・稀に偽 green（枠が空に戻る）が起きる。Plan は Task 10 で per-test reset 廃止 → Task 11 で workers と順序付けているが:
  - 技術的ゲート（workers>1 なら truncate 呼び出し禁止の lint/tooling）が無い  
  - Task 11 Files に `reset-global-ai-quota` 残存 grep や `project-config` が無い  
  - エージェントが Phase を飛ばすと即災害  
- **修正要求:**  
  - Task 11 の完了条件に「`resetGlobalAiQuotaForE2e` / `ensureAiQuotaForGeneration` の test 本体・fixture 入口呼び出し 0（suite/shell 境界のみ）」を tooling または grep テストで固定  
  - `workers: 1` ピン（`project-config.test.mjs` L161）を **意図的に workers≥2 + 並列安全コメント**へ更新する Task を明示  
  - Phase 3 を 1 PR にまとめるか、workers 変更 PR で truncate 残存なら fail するチェックを入れる

---

### Important

#### I1. smoke セットが受け入れ行列の E2E 所有を意図的に薄くしている（C1 の中身）

- **信頼度:** 90  
- **箇所:** Spec §4.2; Plan Task 2  
- **説明:** full-journey / generation recovery / shopping は smoke に入るが、**pantry・history-regen・account-deletion** は full 専用。C1 の運用対策が無いと ship risk。unit がある pantry でも E2E 所有の「restored planner / all reviewed meals」は PR で消える。  
- **修正:** C1 の選択肢 2 または 3。少なくとも PR 説明テンプレに「smoke 非対象の matrix 行」チェックリストを必須化。

#### I2. seed `privacy_consents` の notice_version 未固定

- **信頼度:** 88  
- **箇所:** Plan Task 6; 実装 `shared/contracts/domain.ts` (`privacyNoticeVersion = "2026-07-29.v1"`), `src/features/privacy/privacy-api.ts`  
- **説明:** 生成・consent 判定は **現行 version 行**必須。seed が旧 version / 欠落 / 別カラム不足だと planner 到達後の生成が落ちる（false red）か、逆に UI 同意 UX を完全にバイパスしたまま「完了」扱いになる。onboarding UI 所有は残るが、**settings / shopping / history の completed fixture 経路は seed 品質が真実になる**。  
- **修正:** `seedCompletedOnboardingState` の契約に `notice_version: privacyNoticeVersion` を明示。seed 後に REST で current consent が読めること、service key を page に渡さないことをテスト。

#### I3. setup 二重実行と storageState 共有汚染

- **信頼度:** 85  
- **箇所:** Plan Task 7; 実装 `scripts/run-e2e.sh` L401–420（2 段実行）  
- **説明:** 推奨（shell で setup 1 回、mobile/desktop から `dependencies` 外し）は正しいが、代替（idempotent skip）は「新鮮さ」定義が曖昧。reused session を破壊的 test に誤適用すると他 test が偽 red/green。Spec の ephemeral リストは良いが Plan Task 7 の移行例が billing 表示系に偏り、**タグ強制（`@ephemeral-auth` 未指定なら reused 禁止 or その逆）がコード化されていない**。  
- **修正:**  
  - full の実行モデルを Task 7 で **1 方式に固定**し tooling で argv 列を固定  
  - destructive specs に `@ephemeral-auth` 必須の静的テスト（ファイル名 allowlist）  
  - `e2e/.auth/` を `.gitignore` + 「tracked なら fail」の tooling

#### I4. Admin/session 注入後の magic-link 成功 path カバレッジ縮小

- **信頼度:** 84  
- **箇所:** Spec §7.5; Plan Task 12; 現行 `authenticatedPage`  
- **説明:** cancel/expired/oauth は残るが、**成功 magic-link → session 確立**の多数回 E2E が消える。setup 1 回 + auth-recovery だけでは回帰の網が粗い。  
- **修正:** `@ephemeral-auth` または dedicated smoke 1 本で Mailpit 成功 path を固定。注入経路は「authenticated 既定」、UI path はタグで明示。

#### I5. tooling 文字列ピンと Plan の更新漏れ（silent ではなく赤 CI / 手抜き弱体化）

- **信頼度:** 90  
- **箇所:** `tests/tooling/compose.test.mjs` L437–462; `local-development-scripts.test.mjs` `expectedE2EInvocations`; `project-config.test.mjs` L161 (`workers: 1`)  
- **説明:** smoke 分岐・CI restore 短縮・workers 変更は **必ず**これらのテストを壊す。Plan Task 3 は「suite 文字列がある」程度で、**smoke 時の exact argv（`--project=mobile-chromium` + `--grep=@smoke`、desktop 段なし）**を `expectedE2EInvocations` 相当で固定していない。Task 11 は `workers: 1` ピン更新を Files に書いていない。  
  失敗モード: (a) 実装が赤 CI で止まる（安全だが計画不全）(b) 実装者がピンを緩めて回帰検出を失う（危険）。  
- **修正:** 各 Task の Files に該当 tooling を必須列挙。smoke/full の invocation ゴールデンを追加。workers 変更と同時に並列不変条件コメントを assert。

#### I6. `GLOBAL_DAILY_AI_LIMIT=500` は製品 max 一杯で「余裕」が無い

- **信頼度:** 80  
- **箇所:** Spec §7.2; `GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX=500`; preflight は 501 拒否  
- **説明:** 推奨 500 は製品 max そのもの。full 並列で外部送信見積が過少だと再び枯渇。suite 開始 reset 前提でも、見積ミスや日跨ぎ・二重実行で逼迫し得る。  
- **修正:** Plan コメントで「1 suite 最大外部送信 × safety factor」を数値固定。500 未満の切りの良い数でも可。max を触らない制約は維持。

#### I7. project-filter が auth 派生にしか乗らない

- **信頼度:** 82  
- **箇所:** Plan Task 1; specs の import 分岐  
- **説明:** `installProjectFilter` を auth にだけ付けると、将来 `@mobile-only` を foundation 系に付けたとき desktop でも走る。現状 mobile-accessibility は auth 経由なので Phase 1 は動く。  
- **修正:** Playwright の `test` を `e2e/fixtures/base.ts` 一箇所に集約するか、config の `grep` / project `testIgnore` で `@mobile-only` を project 側制御する（二重管理に注意）。

#### I8. Phase 順序・SKIP_RECREATE の fail-closed が弱い

- **信頼度:** 83  
- **箇所:** Spec §11; Plan Task 13  
- **説明:** 「Phase を飛ばすな」は運用依存。`KONDATE_E2E_SKIP_RECREATE=1` と `CI=true` の同時禁止は必須だが、Task 13 まで後回しだと途中 PR で誤用され得る。  
- **修正:** SKIP_RECREATE 導入と同時に `CI` 同時指定 exit 2 を tooling 化。workers 変更 PR に truncate 禁止チェック（C2）。

---

### Minor

#### M1. smoke タグ静的ガードが弱い

- 「`@smoke` が 1 件以上」は、誤って 1 本だけタグした PR を通す。必須ファイルリストを Plan が任意扱いしている。  
- **修正:** Spec §4.2 のファイル×最低本数を `e2e-smoke-tags.test.mjs` で固定。

#### M2. desktop a11y 削減は重複排除が主で、916 は別ファイルがカバー

- Critical にはしない。desktop 固有 CSS（Desktop Chrome 既定幅）の追加回帰が必要なら `@desktop-only` を別途。

#### M3. Plan の `build_playwright_args` 疑似コードが未完成

- Task 3 の `set -- "$@"; extra=; :` は実装者任せ。推奨形に寄せて argv ゴールデンとセットで書くべき。

#### M4. storageState コミット事故

- `.gitignore` は正しい。tracked 検知テストを I3 に含めると十分。

---

## Residual risks accepted only with human sign-off

以下は **人間が明示承認した場合のみ** 残してよい。

1. **PR は smoke、full は main push のみ** — 必須ステータスと merge queue の運用を文書化し、main 赤の revert SLA を決める（C1 の選択肢 2）。そうしないなら設計変更必須。  
2. **E2E で `GLOBAL_DAILY_AI_LIMIT=20` の枯渇 UX を証明しない** — MVP #17 が unit/pgTAP 所有であることの再確認と、開発者向け「local 20 は compose up、E2E は 500」の docs。  
3. **Admin session 注入を ephemeral 既定にする** — magic-link 成功 E2E を最小本数に減らすこと。  
4. **account-deletion / billing を smoke から外し続ける** — 破壊的・重い path の full 依存。  
5. **workers=2 の flaky 残差** — 2 連続 green を Phase 3 ゲートにしているが、共有 mock/DB の未知競合は残り得る。  
6. **CI cleanup で auth/app restore 省略** — GHA が `down --volumes` する前提。ローカル `ci.sh` と挙動差を docs に明記。

---

## Verdict: BLOCK_WITH_CONDITIONS

**実装開始前に満たすべき条件:**

1. **C1:** PR マージ判定が full（または受け入れ E2E 所有を含む拡張 smoke + 保護ルール）を見る設計に直すか、人間が「main 事後 red 許容」を sign-off した運用を Spec に書く。  
2. **C2:** workers 導入と per-test global truncate 廃止を同一 fail-closed ゲートで結び、`project-config` の `workers: 1` ピン更新を Plan Files に含める。  
3. **I2/I3/I5:** seed の `privacyNoticeVersion` 固定、setup 実行モデルの単一化 + tooling ゴールデン、smoke/full argv と compose シーケンス更新を Task 定義に落とす。

条件 1–3 を Spec/Plan に反映したうえで Phase 1 から進めること。条件を満たさないまま Task 4（PR smoke）や Task 11（workers）をマージすることは **false green / 並列破壊** のリスクが許容できない。

---

ADVERSARIAL_REVIEW_COMPLETE
