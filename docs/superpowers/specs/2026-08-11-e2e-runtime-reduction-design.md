# E2E 実行時間短縮 設計

**日付:** 2026-08-11  
**状態:** レビュー反映後（1次 / 敵対的 / 2次。実装前）  
**適用面:** Playwright E2E（`e2e/`）、`scripts/run-e2e.sh`、CI（`.github/workflows/ci.yml` / `scripts/ci.sh`）、E2E 用 Compose override（`compose.e2e.yaml`）、受け入れマトリクス表記の整合  
**関連分析:** ローカル adversarial quality pass ログで full suite が mobile ≈14 分 + desktop ≈15 分（合計 ≈30 分 Playwright 本体）  
**レビュー記録:**  
`docs/superpowers/reviews/2026-08-11-e2e-runtime-reduction-{primary,adversarial,secondary}.md`

## 1. 目的と非目的

### 目的

ローカルと CI の E2E 壁時計を、**製品の安全契約（quota・Auth・RLS・決定論的 mock）を壊さずに**段階的に短縮する。

| フェーズ | 主な手段 | 目標壁時計（目安） |
| --- | --- | --- |
| **Phase 1** | タグ・project 役割分担・PR スモーク | PR smoke: **≤12 分（必須）** / full: desktop a11y 0 + 相対短縮（**≤22 分は stretch**） |
| **Phase 2** | storageState・seed onboarding・quota reset 範囲縮小 | full: **≤15 分**（stretch） |
| **Phase 3** | E2E 専用枠戦略・workers 並列・認証注入 | full: **≤10 分**は stretch。必須は workers≥2 で 2 連続 green + 生成系 serial / UI 並列での相対短縮（§7.4・§9） |

目標は **目安**であり、ハードウェア差と global AI 行ロック（§9）で前後する。受け入れは「相対短縮 + flaky 非増 + ゲート契約維持」で判定する。

### 非目的

- 製品のリリースロック値（例: 本番推奨 `GLOBAL_DAILY_AI_LIMIT`、Free/Plus 個人枠）の恒久変更
- 受け入れマトリクス 22/22・8/8 行の削除や「unit に黙って置換」
- OpenRouter 実 API を E2E に載せる・mock 決定論を緩める
- `workers` を調査なしで上げる・race テストの timeout 短縮だけで速く見せる
- `docs/archive/` の旧設計で現行 suite を上書きすること
- E2E shots（`e2e/shots/` / `playwright.shots.config.ts`）の最適化（本計画の対象外。別作業）

## 2. 背景と現状

### 2.1 構成ロック（実装が正）

| 項目 | 現状 |
| --- | --- |
| ランナー | `./scripts/run-e2e.sh` → Compose profile `e2e` → `npx playwright test` |
| 設定 | `playwright.config.ts`: `workers: 1`, `fullyParallel: false`, retries local 1 / CI 2 |
| projects | `mobile-chromium`（iPhone SE）+ `desktop-chromium`（Desktop Chrome） |
| full 実行 | project 未指定時 **mobile 全件 → AI 枠 reset → desktop 全件**（`run-e2e.sh`） |
| AI 共有枠 | ローカル `GLOBAL_DAILY_AI_LIMIT=20`（`compose.yaml`）。fixture が `private.ai_global_daily_usage` を truncate |
| 認証 | ほぼ毎回 magic-link + Mailpit。`completedOnboardingPage` は UI で最低限 onboarding + privacy |
| 起動 | E2E 開始時 auth / app / mock を force-recreate。終了後 auth/app を通常構成へ復元 |
| ロック | checkout 単位 `.run-e2e.lock`（同一 worktree 並行 E2E 禁止） |

### 2.2 時間の内訳（観測）

両 project 合算のおおよその寄与（過去 full ログ）:

| 領域 | 寄与 |
| --- | --- |
| 直列 × 2 project | 壁時計のほぼ 2 倍 |
| `mobile-accessibility`（幅 3 × シナリオ 5 × 2 project） | ≈6 分 |
| shopping races / generation recovery / shopping | 各数分 |
| 認証 + onboarding fixture の毎回やり直し | 多くの「軽い」テストでも 7〜15 秒台 |

### 2.3 直列化が必要な理由（壊してはいけない不変条件）

1. **アプリ全体 AI 日次枠**は JST 日付・単一カウンタ。複数 worker が同時に truncate / 予約すると他テストを枯渇・偽 red させる。
2. **GoTrue メール送信レート**があり、並列 magic-link は flaky 源になる（compose.e2e で上限は引き上げ済みだが、無制限ではない）。
3. **race 系**は同一ブラウザ経路・household 変異・route abort を前提とし、共有 app 上の並列と相性が悪いものがある。
4. **単一 checkout / 単一 DB** 前提の wrapper と tooling テストがある。

よって短縮は「全部並列」ではなく、**測定可能な段階**で制約を外す設計にする。

## 3. 共通原則（全 Phase）

1. **実装と契約が正。** 製品 cap・RLS・safety の意味を E2E 高速化のために変えない。
2. **E2E 専用の緩和は `compose.e2e.yaml` / env / fixture に閉じる。** 本番 preflight や通常 `compose up` の既定を変えない。
3. **受け入れ owning test を動かす・間引くときは** `docs/testing/acceptance-matrix.md` と `scripts/verify-acceptance-matrix.test.mjs` を同じ PR で整合させる。
4. **ゲート順**は `scripts/ci.sh` と `.github/workflows/ci.yml` で共有抽出テストが通る形を維持する（E2E 呼び出しは常に `./scripts/run-e2e.sh` を含む）。
5. **決定論:** retry で race / helper 非決定性を隠さない（現行コメント方針を維持）。
6. **プライバシー:** CI では `PLAYWRIGHT_DISABLE_TRACE=1` と `KONDATE_ASSERT_PRIVACY_LOGS=1` を維持。
7. **計測:** 各 Phase 完了時に list reporter の suite 時間と（可能なら）ファイル別合計を記録し、目標との差分を PR 説明に書く。コミットに生ログや秘密を載せない。
8. **コマンド実行:** Node/npm 検証は Docker `app` 経由。E2E は `./scripts/run-e2e.sh`（host）。コマンド連結 `&&` はエージェント実行時の AGENTS 規約に従う。

## 4. タグとスイート契約

### 4.1 Playwright タグ（Phase 1 で導入）

Playwright ネイティブの `tag` を使う（`--grep @smoke` で選択）。

| タグ | 意味 | 付与規則 |
| --- | --- | --- |
| `@smoke` | PR / 日常の最短回帰。クリティカル path のみ | §4.2 の固定リストに含まれる test のみ |
| `@full` | full suite に含める（**既定**） | タグ省略時は full 扱い。明示 `@full` は可だが必須ではない |
| `@mobile-only` | `mobile-chromium` でのみ実行 | desktop では skip |
| `@desktop-only` | `desktop-chromium` でのみ実行 | mobile では skip |
| `@serial` | Phase 3 で worker 内 serial 必須 | Phase 1–2 では付与のみ可。実行意味は Phase 3 |
| `@ephemeral-auth` | 使い捨てユーザ必須（storageState 禁止） | Phase 2 以降。account-deletion / auth-* / 一部 race |

**ルール:**

- 1 test に複数タグ可（例: `@smoke` + 既定 full）。
- `@mobile-only` と `@desktop-only` を同時に付けない。
- **project skip の単一入口（必須）:** `playwright.config.ts` の project 定義で  
  - `mobile-chromium`: `grepInvert: /@desktop-only/`  
  - `desktop-chromium`: `grepInvert: /@mobile-only/`  
  に固定する（fixture `beforeEach` 分散や raw `@playwright/test` 漏れを避ける）。spec 内の散発 `test.skip` で project 役割を表現しない。

### 4.2 `@smoke` 固定セット（Phase 1）

PR の壁時計目標を守るため、smoke は **おおむね 14〜22 本 × mobile 1 project** に収める。  
次を **最低限** 含める（title は実装の exact title。幅付きは 320 の 1 本だけ smoke）。

**レビュー反映（C1 / 2次）:** e2e-only 受け入れ path を PR から完全に外さない。MVP #9 / #13 は各 **1 本** smoke に含める。

| 領域 | Spec ファイル | 最低本数 | 含める内容（方針） |
| --- | --- | --- | --- |
| 基盤 | `foundation.spec.ts` | 全 | 全 test |
| OAuth mock | `oauth-mock.spec.ts` | 2 | success + cancel（ファイルが 2 本なら両方） |
| Full journey | `full-journey.spec.ts` | 2 | household + idea |
| Auth callback | `auth-callback-security.spec.ts` | 2 | cancel + expired（残り full） |
| Auth recovery | `auth-recovery.spec.ts` | 1 | Google cancel / expired leftover |
| Generation | `generation-recovery-results.spec.ts` | 2 | recovery 1 + result details 1 |
| Shopping | `shopping-list.spec.ts` | 1 | protected rows |
| Shopping race | `shopping-list-races.spec.ts` | 1 | idempotency または safety change |
| History safety | `history-safety-change.spec.ts` | 1 | auto revalidate |
| History regen | `history-regeneration.spec.ts` | **1** | **二重 success 消費禁止（MVP #13 e2e-only）** |
| Menu pantry | `menu-domain-pantry.spec.ts` | **1** | **pantry CRUD / restored planner 系 1 本（MVP #9）** |
| Onboarding | `onboarding.spec.ts` | 1 | 全 test（1 本） |
| Settings | `settings.spec.ts` | 1 | member CRUD |
| Mobile a11y | `mobile-accessibility.spec.ts` | 1 | **320px household wizard+result のみ** |
| Account deletion | `account-deletion.spec.ts` | 0 | **full のみ**（重い・破壊的。Notes 所有） |
| Billing | `billing-plus.spec.ts` | 0 | full（表示は RTL バックアップ多） |

**機械的固定（必須）:** `tests/tooling/e2e-smoke-tags.test.mjs` が上表の **必須ファイル × 最低本数**をソース上の `@smoke` 付与から検証する。「`@smoke` が 1 件以上」だけでは不十分。セット変更 PR は (1) 本表 (2) 当該 tooling (3) 実測が PR 目標を超えないこと (4) 外した path の full/unit/pgTAP カバーを PR 説明に書く。

### 4.3 スイート実行モード

| モード | 環境変数 / CLI | 実効 Playwright 引数 |
| --- | --- | --- |
| **full**（既定） | `KONDATE_E2E_SUITE` 未設定 or `full` | 現行どおり。project 未指定なら mobile → reset → desktop。`@mobile-only` / `@desktop-only` を project ごとに skip |
| **smoke** | `KONDATE_E2E_SUITE=smoke` または明示 grep | `--project=mobile-chromium` + `--grep @smoke`（1 段のみ。desktop 段は走らない） |

実装方針（いずれか一方に固定。Plan でコード化する）:

- **推奨:** `run-e2e.sh` が `KONDATE_E2E_SUITE=smoke` を解釈し、内部で project/grep を付与する。呼び出し側が `--project` や `--grep` を既に渡している場合は **二重付与せず**、明示引数を優先する。
- 開発者は従来どおり  
  `./scripts/run-e2e.sh -- e2e/specs/foo.spec.ts --project=mobile-chromium`  
  で焦点実行できる（変更しない）。

## 5. Phase 1 — タグ・project 役割・CI レーン

### 5.1 ゴール

- タグと project フィルタが動き、full から **冗長な二重実行**を削る。
- PR は smoke、push（保護ブランチ）とローカル release 相当は full。
- 目標: PR ≤12 分、full ≤22 分（目安）。

### 5.2 project 役割分担

| テスト群 | mobile-chromium | desktop-chromium |
| --- | --- | --- |
| `mobile-accessibility` 全幅マトリクス（320/375/430） | **実行** | **skip**（`@mobile-only`） |
| foundation の viewport 適合 | 実行 | 実行（project 既定 device） |
| full-journey / generation / shopping / history / settings 等 | 実行 | 実行（回帰の desktop レイアウト差を残す） |
| `@desktop-only`（将来用） | skip | 実行 |

**受け入れ G7 / MVP #21:** owning は `mobile-accessibility` の width 付き title のまま。desktop で回していた同一マトリクスは **重複**であり、mobile project に寄せる。マトリクスの title パターンは変えず、実行 project だけ変える。

### 5.3 CI と merge ゲート（レビュー C1 反映）

| トリガ | E2E |
| --- | --- |
| `pull_request` | `KONDATE_E2E_SUITE=smoke` で `./scripts/run-e2e.sh`（§4.2 拡張 smoke） |
| `push` to workflow 対象ブランチ | **full**（現行 env + `./scripts/run-e2e.sh`） |
| `scripts/ci.sh` | **full 既定**（ローカル release ゲート）。`KONDATE_E2E_SUITE=smoke` で短縮可 |

**固定する運用前提（隠さない）:**

1. **PR green ≠ acceptance 全量 E2E。** smoke は早期シグナルであり、full suite と matrix 全 e2e owning の代替ではない。
2. **full は merge 後の `push` でも走る**が、それだけでは **merge 阻止にはならない**（事後検知）。  
   - 本設計の既定は **§4.2 拡張 smoke**（選択肢 B: e2e-only 重要 path を PR に残す）で merge-time の穴を縮小する。  
   - account-deletion / billing 全量 / a11y 全幅 / race 全量は **full / release** 依存のまま。  
   - リポジトリ外の GitHub branch protection で「PR の verify 必須」を付けることは推奨だが、**本 repo 内に protection 設定は無い**。運用で merge queue や push full 必須にする場合は `docs/local-development.md` に 1 行追記する。
3. **release / `scripts/ci.sh` / AGENTS 検証フローは full のまま**（`docs/testing/release-checklist.md` の `./scripts/run-e2e.sh` を smoke に差し替えない）。

`project-config.test.mjs` の共有ゲート順は、両方に `./scripts/run-e2e.sh` が残る限り維持する。

### 5.4 ドキュメント

- `docs/local-development.md`: smoke / full / 焦点実行のコマンド表 + **「PR smoke ≠ acceptance 全量」**。
- `docs/README.md` の local-development 行に smoke/full を括弧追記してよい。
- `README.md` に 1 行ある場合は smoke の存在を追記してよい。
- acceptance-matrix: owning file/title が変わらない限り必須更新なし。変わったら同時更新。Notes に「#13 / #9 の 1 本は smoke、残り full」を 1 行足してよい。

### 5.5 Phase 1 完了条件

- [ ] §4.2 必須ファイル×最低本数が tooling で固定され、smoke が下限を満たす
- [ ] `KONDATE_E2E_SUITE=smoke` で mobile のみ・`@smoke` のみ（desktop 段なし）
- [ ] `mobile-accessibility` が desktop project で 0 実行（config `grepInvert`）
- [ ] PR workflow が smoke、push / `ci.sh` 既定が full
- [ ] tooling（compose / expectedE2EInvocations の smoke 分岐 / CI ゲート順 / smoke タグ）が緑
- [ ] docs に PR smoke ≠ acceptance 全量が書かれている
- [ ] full を 1 回以上計測し、desktop a11y 0 実行を確認（≤22 分は stretch）

## 6. Phase 2 — 認証再利用と seed

### 6.1 ゴール

magic-link + UI onboarding の固定費を減らし、full を **≤15 分**目安へ。

### 6.2 認証フィクスチャの二系統

| 系統 | 用途 | タグ / fixture 名 |
| --- | --- | --- |
| **A. ephemeral**（現行相当） | ユーザ isolation 必須 | `@ephemeral-auth` / 既存 `authenticatedPage` 系 |
| **B. reused session** | 読み取り中心・同一ユーザでよい UI | setup project の `storageState` + `reusedAuthenticatedPage` 等 |

**必ず ephemeral（storageState 禁止）:**

- `account-deletion.spec.ts`
- `auth-callback-security.spec.ts` / `auth-recovery.spec.ts` / `oauth-mock.spec.ts`
- household を破壊的に変える race（他 test とユーザ共有不可）
- 「新規ユーザの welcome 振り分け」そのものを検証する test

**reused 候補:**

- `billing-plus` の表示系
- `settings` の「completed fixture opens planner」
- shell / 幅チェックで **ユーザ状態を汚さない**もの
- generation で **毎回新規が必須でない**もの（ただし生成後の履歴汚染に注意 → 原則 ephemeral のままでも可）

Phase 2 では **無理に全部 B にしない。** 効果が大きい・汚染が少ないものから移す。

### 6.3 setup project（実行モデル固定・レビュー F1）

**採用モデル（1 方式のみ）:** Playwright の `dependencies: ["setup"]` は **使わない**。  
`run-e2e.sh` が shell で起動順を制御する（現行の mobile → desktop **2 プロセス**を Phase 2 でも維持するため）。

```text
# full（KONDATE_E2E_SUITE=full、--project 未指定）
run_playwright --project=setup          # 1 回だけ。storageState を e2e/.auth/user.json へ
run_playwright --project=mobile-chromium
reset-e2e-ai-quota.sh
run_playwright --project=desktop-chromium

# smoke
run_playwright --project=setup          # 1 回（reused fixture を使う smoke がある場合）
run_playwright --project=mobile-chromium --grep=@smoke
# desktop 段なし
```

- setup project: `testMatch` で `auth.setup.ts` のみ。**1 worker**。magic-link または Admin 経路で 1 ユーザを作り `storageState` を書く。
- mobile/desktop project: **setup に dependsOn しない**。reused fixture はファイルが存在するときだけ `storageState` を読む。
- setup 失敗時は suite 全体 fail（fail-closed）。
- **Gitignore:** `e2e/.auth/`。tracked されていれば tooling で fail。
- **`@ephemeral-auth`:** 破壊的 / auth 専用 spec は allowlist 静的テストで必須タグ。reused を誤適用しない。

### 6.4 completed onboarding の seed

| 現状 | 変更後 |
| --- | --- |
| UI: 家族設定開始 → 1 人目 → privacy | **既定:** service role / REST で完了状態を投入し `/planner` へ |
| UI path の回帰 | `onboarding.spec.ts` と `full-journey` household が **UI 完了 path を所有**したまま残す |

**seed 必須契約（レビュー F6 / I2）:**

- 参照: `e2e/fixtures/acceptance.ts` の admin パターン、`shared/contracts/domain.ts` の `privacyNoticeVersion`（現行値 **`2026-07-29.v1`** を seed の `privacy_consents.notice_version` に固定。契約が更新されたら実装に追随）。
- 最低: 対象 user の `profiles`（onboarding 完了相当）、`household_members` ≥1（allergy none 相当）、`privacy_consents` 現行 version 行。
- service role キーを page に渡さない。
- seed 直後: `/planner` に留まり welcome へ戻されないこと（焦点 E2E または fixture 内 assert）。

### 6.5 global AI quota reset の範囲

| 現状 | 変更後（Phase 2） |
| --- | --- |
| fixture 入口の **毎回** truncate | **生成・外部 AI 送信直前のみ** `ensureAiQuotaForGeneration()` |
| suite 境界の `reset-e2e-ai-quota.sh` | **維持** |

Phase 3 では test ごと truncate を **完全廃止**する（§7.3）。Phase 2 の間は workers=1 のままなので生成直前 reset は安全。

### 6.6 Phase 2 完了条件

- [ ] setup + storageState 経路が緑（少なくとも 1 ファイル以上が reused に移行）
- [ ] completed onboarding seed が `completedOnboardingPage` の既定経路
- [ ] UI onboarding が owning spec で依然カバー
- [ ] 非生成 test が fixture 入口で truncate しない
- [ ] full 実測が Phase 1 より改善、目安 ≤15 分
- [ ] flaky 増なし（同一 SHA で 2 連続 full green 推奨）

## 7. Phase 3 — 並列と E2E 専用枠

### 7.1 ゴール

共有枠と認証ボトルネックを **E2E 閉包のまま**外し、`workers ≥ 2` で full **≤10 分**目安。

### 7.2 E2E 専用 `GLOBAL_DAILY_AI_LIMIT`

| 面 | 値 |
| --- | --- |
| 通常 local `compose.yaml` | **20 のまま**（変更しない） |
| E2E override `compose.e2e.yaml` の app | **製品 max 以下**。初期値は **500**（`GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX`）可。compose.e2e コメントで「運用推奨 20 や本番推奨とは別。E2E 並列用の ENV 上書き。製品 max 一杯であり 1 suite 送信見積 × safety factor を超えないこと」を必須化 |
| 本番 / preflight | 変更しない |

**意図:** 並列中に truncate なしでも枠枯渇しにくくする。  
**禁止:** アプリの製品 max 定義を E2E のために上げる。ENV のみ。  
**quota theater residual:** E2E は limit=20 の枯渇 UX を証明しない（現状も fixture truncate で 20 到達を避けている）。MVP #17 は unit/pgTAP 所有。docs に「local 通常 20 / E2E は compose.e2e 上書き」を書く。

### 7.3 truncate 戦略と workers の fail-closed（レビュー C2）

Phase 3 では:

- **suite 開始時と project 境界（shell）の reset のみ**
- **test 本体・fixture 入口での `truncate private.ai_global_daily_usage` は 0**
- **workers > 1 を入れる PR では** tooling が次を fail-closed する:
  1. `ensureAiQuotaForGeneration` / `resetGlobalAiQuotaForE2e` の test/fixture 入口呼び出しが 0（shell スクリプト境界のみ許可）
  2. `playwright.config.ts` の `workers` が定数 2（または許可集合）であり、調査なしの `process.env.CI ? { workers: 1 }` パターンを復活させない（`project-config.test.mjs` を新契約へ更新）

Task 10（truncate 廃止）と Task 11（workers）は **同一 PR にまとめる**か、workers 変更 PR で (1) が red なら merge 不可。

### 7.4 workers と serial

| 設定 | Phase 3 目標 |
| --- | --- |
| `workers` | **2**（定数）。安定後 3〜4 は別 PR |
| `fullyParallel` | **true** |
| `@serial` 必須候補 | `shopping-list-races.spec.ts` 全体、同一 storageState を共有する describe、`history-safety-change` で Realtime/focus が相互依存する場合、生成が密集する describe |

**global 行ロック residual（F7）:** `private.ai_global_daily_usage` の単一行 `FOR UPDATE` により、limit を上げても **予約はアプリ全体で直列化**され得る。workers≥2 の短縮は主に **非生成 UI** で効く。生成重い file は serial / 低並列を許容する。≤10 分未達時の主因候補に行ロックを挙げる。

Mailpit / GoTrue: storageState と §7.5 の高速経路で並列 magic-link を減らす。

### 7.5 認証注入（方式固定）

**採用方式（1 つのみ）:** Supabase Admin **`generateLink`（magiclink）で URL を取得しブラウザで開く**。Mailpit を踏まない。GoTrue 依存は残る。

- session 形状の手注入（`addInitScript`）は **採用しない**（YAGNI・セッション drift リスク）。
- **現行 Mailpit 成功 path** は setup または `@smoke` / full 固定で **最低 1 本**残す（auth 成功回帰の網を消さない）。
- `oauth-mock` / `auth-callback-security` / cancel・expired は **UI path 維持**（高速化しない）。
- 失敗時は fail-closed（フォールバックで Mailpit に黙って戻さない。setup 失敗は suite 失敗）。

### 7.6 sharding（本 Phase の任意・既定オフ）

- 同一 DB への `--shard` は **採用しない**（共有状態）。
- 将来 CI で shard するなら **Compose project を shard ごとに分離**する別設計とし、本 Phase の完了条件に含めない。

### 7.7 force-recreate と CI cleanup（小改善）

| 項目 | 方針 |
| --- | --- |
| 開始時 force-recreate | 既定維持。`KONDATE_E2E_SKIP_RECREATE=1` は **開発反復用のみ**。**`CI=true` と同時指定は exit 2**（導入 Task で tooling 固定。Task 13 まで遅延しない） |
| CI 終了時の auth/app 復元 | GHA は直後に `down --volumes` するため CI 時は restore 短縮可。ローカルは現行 restore |
| tooling テスト | `expectedE2EInvocations` と compose 正規表現を新シーケンスに合わせて更新 |

### 7.8 Phase 3 完了条件

- [ ] `compose.e2e.yaml` のみ高い `GLOBAL_DAILY_AI_LIMIT`、通常 compose は 20（tooling 固定）
- [ ] per-test global truncate 0 の tooling が緑
- [ ] `workers: 2` + `fullyParallel: true` で full が **同一 SHA 2 連続 green**
- [ ] generateLink 高速経路が ephemeral 既定、Mailpit 成功 path ≥1 本
- [ ] 生成系は serial 許容。短縮は UI 並列中心で説明可能
- [ ] ≤10 分は stretch。未達なら行ロック / ハードウェアを PR で説明
- [ ] 製品 preflight / 本番 env 契約テストが緑

## 8. 成功指標と回帰ガード

### 8.1 定量

| 指標 | 記録方法 |
| --- | --- |
| suite 壁時計 | Playwright list 末尾 `N passed (Xm)` |
| ファイル別 | 任意スクリプトまたは手集計。リポジトリに大きなログをコミットしない |
| flaky | 同一 SHA で full 2 連続。retry 消化が増えたら Phase を戻して原因調査 |

### 8.2 定性（必須維持）

- acceptance-matrix 22+8 と verify スクリプト
- privacy log assert（CI）
- openrouter-mock 決定論
- `.run-e2e.lock` の単一実行
- ユーザー向け文言・製品 quota の意味

### 8.3 ロールバック

各 Phase は独立して revert 可能にする:

- Phase 1: タグと CI 分岐のみ戻す
- Phase 2: fixture を magic-link + UI onboarding に戻す
- Phase 3: `workers: 1` / 通常 limit / truncate 復活

## 9. リスクと緩和

| リスク | 緩和 |
| --- | --- |
| PR smoke のみで merge-time に full が走らない | §4.2 拡張 smoke（#9/#13 各 1 本）+ §5.3 明示。full は push/release。account-deletion は full 依存 |
| storageState 共有で偽 green / 汚染 | `@ephemeral-auth` allowlist 静的テスト。破壊的 test は setup 不使用 |
| workers×test ごと truncate で枠破壊 | §7.3 fail-closed。Task 10+11 同一 PR または truncate 残存で workers 禁止 |
| global 行ロックで生成が直列 | §7.4: UI 並列中心、生成 serial、≤10 分は stretch |
| Mailpit / 並列 flaky | generateLink + storageState。Mailpit 成功 ≥1 本 |
| tooling 文字列ピン | 各 Task の Files に compose / local-development-scripts / project-config を必須列挙 |
| 受け入れ title 変更漏れ | verify-acceptance-matrix（既存 CI） |
| SKIP_RECREATE が CI で有効 | CI 同時指定 exit 2 + tooling |
| E2E limit 500 と製品 20 の混同 | compose.e2e コメント + docs。MVP #17 は unit/pgTAP |

## 10. ファイル影響マップ（概略）

| パス | Phase | 変更概要 |
| --- | --- | --- |
| `playwright.config.ts` | 1–3 | `grepInvert`、setup project（dependsOn **なし**）、workers、fullyParallel |
| `scripts/run-e2e.sh` | 1, 3 | suite モード、CI 時 cleanup 短縮 |
| `compose.e2e.yaml` | 3 | `GLOBAL_DAILY_AI_LIMIT` E2E 専用 |
| `.github/workflows/ci.yml` / `scripts/ci.sh` | 1 | smoke/full 分岐、ゲート順テスト追随 |
| `e2e/specs/*.spec.ts` | 1–2 | タグ、project filter、fixture 切替 |
| `e2e/fixtures/auth.ts` 他 | 2–3 | seed、storageState、quota reset 範囲、session 注入 |
| `e2e/fixtures/project-filter.ts` | 1 | **新規** mobile/desktop only |
| `e2e/.auth/` | 2 | gitignore 成果物 |
| `docs/local-development.md` | 1 | コマンド |
| `docs/testing/acceptance-matrix.md` | 必要時 | owning 変更時のみ |
| `tests/tooling/compose.test.mjs` 等 | 1–3 | シーケンス・env 断言 |
| `.gitignore` | 2 | `e2e/.auth/` |

## 11. 実装順序と依存

```text
Phase 1（タグ・CI・project 分担）
    ↓
Phase 2（storageState・seed・quota reset 縮小）  ※ Phase 1 のタグを前提に ephemeral をマーク
    ↓
Phase 3（E2E limit・workers・認証高速化）      ※ Phase 2 の枠 reset 方針を並列向けに再定義
```

- Phase を飛ばさない（Phase 3 の並列を Phase 1 なしで入れると skip/smoke 契約が曖昧になる）。
- 各 Phase 完了ごとに Conventional Commit（日本語）。人間が明示するまで **push / 本番 deploy しない**。

## 12. 用語

| 用語 | 意味 |
| --- | --- |
| full | 両 project（フィルタ後の全 test）。release / push ゲート |
| smoke | `@smoke` × mobile-chromium のみ。PR ゲート |
| ephemeral-auth | テストごとに新規ユーザ。storageState 不可 |
| global AI quota | `private.ai_global_daily_usage` + `GLOBAL_DAILY_AI_LIMIT` |

---

**次工程:** 実装 Plan は `docs/superpowers/plans/2026-08-11-e2e-runtime-reduction.md`。  
Task 実行は subagent-driven-development または executing-plans に従い、1 Task ずつ RED→GREEN→検証する。
