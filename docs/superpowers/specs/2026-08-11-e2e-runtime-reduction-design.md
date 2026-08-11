# E2E 実行時間短縮 設計

**日付:** 2026-08-11  
**状態:** 草案（実装前）  
**適用面:** Playwright E2E（`e2e/`）、`scripts/run-e2e.sh`、CI（`.github/workflows/ci.yml` / `scripts/ci.sh`）、E2E 用 Compose override（`compose.e2e.yaml`）、受け入れマトリクス表記の整合  
**関連分析:** ローカル adversarial quality pass ログで full suite が mobile ≈14 分 + desktop ≈15 分（合計 ≈30 分 Playwright 本体）

## 1. 目的と非目的

### 目的

ローカルと CI の E2E 壁時計を、**製品の安全契約（quota・Auth・RLS・決定論的 mock）を壊さずに**段階的に短縮する。

| フェーズ | 主な手段 | 目標壁時計（目安） |
| --- | --- | --- |
| **Phase 1** | タグ・project 役割分担・PR スモーク | PR smoke: **≤12 分** / full（両 project）: **≤22 分** |
| **Phase 2** | storageState・seed onboarding・quota reset 範囲縮小 | full: **≤15 分** |
| **Phase 3** | E2E 専用枠戦略・workers 並列・認証注入 | full: **≤10 分**（workers≥2 で green 安定時） |

目標は **目安**であり、ハードウェア差で前後する。受け入れは「相対短縮 + flaky 非増 + ゲート契約維持」で判定する（§7）。

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
- skip 実装は **1 か所**に集約する（`e2e/fixtures/project-filter.ts` または auth base の `beforeEach`）。spec ごとに `test.skip` を散らさない。

### 4.2 `@smoke` 固定セット（Phase 1）

PR の壁時計目標を守るため、smoke は **おおむね 12〜18 本 × mobile 1 project** に収める。  
次を **最低限** 含める（title は実装の exact title。幅付きは 320 の 1 本だけ smoke）:

| 領域 | Spec ファイル | 含める内容（方針） |
| --- | --- | --- |
| 基盤 | `foundation.spec.ts` | 全 test |
| OAuth mock | `oauth-mock.spec.ts` | success 1 本 + cancel 1 本（ファイルが 2 本なら両方） |
| Full journey | `full-journey.spec.ts` | household + idea の **両方**（受け入れの主 path） |
| Auth callback | `auth-callback-security.spec.ts` | cancel と expired の **2 本**（残りは full） |
| Auth recovery | `auth-recovery.spec.ts` | same-browser の **1 本** |
| Generation | `generation-recovery-results.spec.ts` | recovery 系 **1 本** + result details **1 本** |
| Shopping | `shopping-list.spec.ts` | protected rows **1 本** |
| Shopping race | `shopping-list-races.spec.ts` | idempotency または safety change **1 本** |
| History safety | `history-safety-change.spec.ts` | auto revalidate **1 本** |
| Onboarding | `onboarding.spec.ts` | 全 test（1 本） |
| Settings | `settings.spec.ts` | member CRUD **1 本** |
| Mobile a11y | `mobile-accessibility.spec.ts` | **320px の household wizard+result のみ** |
| Account deletion | `account-deletion.spec.ts` | **full のみ**（smoke に入れない。重い・破壊的） |
| Billing | `billing-plus.spec.ts` | smoke **0 本**（unit / 設定表示は RTL に寄せ済みのものが多い。full で担保） |
| Menu pantry | `menu-domain-pantry.spec.ts` | smoke **0 本**（full。必要なら Phase 1 後に 1 本追加検討） |
| History regen | `history-regeneration.spec.ts` | smoke **0 本**（full） |

**変更手続き:** smoke セットを増減する PR は (1) 本表を更新 (2) 実測時間が PR 目標を超えないこと (3) 外した path が full または unit/pgTAP で覆われていることを PR 説明に書く。

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

### 5.3 CI

| トリガ | E2E |
| --- | --- |
| `pull_request` | `KONDATE_E2E_SUITE=smoke` で `./scripts/run-e2e.sh` |
| `push` to workflow 対象ブランチ | full（現行と同じ env + `./scripts/run-e2e.sh`） |
| `scripts/ci.sh` | **full 既定**（ローカル release ゲート）。`KONDATE_E2E_SUITE=smoke` で短縮可と `docs/local-development.md` に記載 |

`project-config.test.mjs` の共有ゲート順は、両方に `./scripts/run-e2e.sh` が残る限り維持する。workflow 内の条件分岐で引数だけ変えてよい。

### 5.4 ドキュメント

- `docs/local-development.md`: smoke / full / 焦点実行のコマンド表。
- `README.md` に 1 行ある場合は `./scripts/run-e2e.sh` と smoke の存在を追記してよい（過剰に長くしない）。
- acceptance-matrix: owning file/title が変わらない限り必須更新なし。変わったら同時更新。

### 5.5 Phase 1 完了条件

- [ ] 全 `@smoke` test にタグが付き、`KONDATE_E2E_SUITE=smoke` で mobile のみ・grep 一致だけが走る
- [ ] `mobile-accessibility` が desktop project で 0 実行
- [ ] PR workflow が smoke、push / `ci.sh` 既定が full
- [ ] tooling テスト（compose / run-e2e シーケンス / CI ゲート順）が緑
- [ ] full を 1 回以上計測し、Phase 0 比で短縮していること（または desktop a11y 削減分の説明）

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

### 6.3 setup project

`playwright.config.ts` に setup project を追加する案:

```text
setup (依存なし) → mobile-chromium / desktop-chromium が setup に dependsOn
```

- setup は **1 worker** で magic-link 1 回（または Admin で session 相当を確立）し、`e2e/.auth/user.json`（gitignored）へ `storageState` を書く。
- 通常 project は `storageState` を読む fixture を opt-in で使う。
- setup 失敗時は suite 全体 fail（fail-closed）。

**Gitignore:** `e2e/.auth/` を ignore。秘密・本番トークンを置かない（ローカル GoTrue のみ）。

### 6.4 completed onboarding の seed

| 現状 | 変更後 |
| --- | --- |
| UI: 家族設定開始 → 1 人目 → privacy | **既定:** service role / REST + 必要最小 SQL で profile・member・privacy_consents 等を投入し `/planner` へ |
| UI path の回帰 | `onboarding.spec.ts` と `full-journey` household が **UI 完了 path を所有**したまま残す |

seed ヘルパは `e2e/fixtures/` に置き、service role キーを page に渡さない（現行 `acceptance.ts` / history seed と同方針）。

### 6.5 global AI quota reset の範囲

| 現状 | 変更後 |
| --- | --- |
| `authenticatedPage` / `completedOnboardingPage` / `ideaModePage` の **毎回** truncate | **生成・外部 AI 送信を行う test の直前のみ**（明示ヘルパ `ensureAiQuotaForGeneration()`） |
| suite 境界の `reset-e2e-ai-quota.sh` | **維持**（mobile↔desktop 境界と日跨ぎ再実行） |

非生成 UI テストは PG truncate 往復をしない。  
誤って生成 test が reset を忘れ枠枯れする場合は **その test を red にし**、ヘルパ必須をコメントと review で担保する（自動検出は Phase 2 任意: 生成 URL を監視して未 reset なら fail は overkill ならやらない）。

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
| E2E override `compose.e2e.yaml` の app | **製品 max 以下の十分大きな値**（推奨 **500** = `GLOBAL_DAILY_AI_LIMIT_PRODUCT_MAX`、または full 並列に足りる最小の切りの良い数。Plan 実装時に「1 suite の最大外部送信見積 × safety factor」をコメントで固定） |
| 本番 / preflight | 変更しない |

**意図:** 並列実行中に worker 間で truncate しなくても枠枯渇しないようにする。  
**禁止:** アプリコードの製品 max 定義を「E2E のため」に上げること。ENV オーバーライドのみ。

### 7.3 truncate 戦略の再定義

Phase 2 の「生成前 reset」は、Phase 3 では:

- **既定:** E2E の高い `GLOBAL_DAILY_AI_LIMIT` の下では **suite 開始時と project 境界の reset のみ**（test ごと truncate 廃止）
- 並列 truncate は **禁止**（他 worker のカウンタを消す）
- どうしても isolation が要る場合は **ユーザ単位枠**に依存（新規ユーザは Phase 2 ephemeral で独立）し、global は触らない

### 7.4 workers と serial

| 設定 | Phase 3 目標 |
| --- | --- |
| `workers` | CI/local とも **2** から開始。安定後 3〜4 を検討（ホスト CPU 依存） |
| `fullyParallel` | **true** を目標。`@serial` describe は `test.describe.configure({ mode: "serial" })` |
| `@serial` 対象 | shopping-list-races の相互依存、同一 storageState ユーザを共有する describe、明示コメントがあるもの |

Mailpit / GoTrue:

- 並列 magic-link を減らすため、Phase 2 の storageState / Phase 3 の **Admin session 注入**を優先。
- 残る ephemeral magic-link は worker 数に対してレートに余裕があることを compose.e2e の既存引き上げと合わせて確認。

### 7.5 認証注入（Admin / session）

目標: ephemeral でも Mailpit を踏まずにログイン相当を確立するオプション。

| 方式 | 採用判断 |
| --- | --- |
| Supabase Admin `generateLink` / magiclink を API で取得しブラウザで開く | Mailpit より安定しうる。GoTrue 依存は残る |
| service role で user 作成 + ブラウザに session を注入（`page.addInitScript` / context storage） | 最速。実装コストと supabase-js セッション形状の固定が必要 |
| 現行 Mailpit | fallback。setup と少数 ephemeral のみ |

**採用:** Plan 実装時に **1 方式を選び**、他は追わない（YAGNI）。失敗時は fail-closed。

### 7.6 sharding（本 Phase の任意・既定オフ）

- 同一 DB への `--shard` は **採用しない**（共有状態）。
- 将来 CI で shard するなら **Compose project を shard ごとに分離**する別設計とし、本 Phase の完了条件に含めない。

### 7.7 force-recreate と CI cleanup（小改善）

| 項目 | 方針 |
| --- | --- |
| 開始時 force-recreate | 既定維持（auth カウンタ・E2E env）。`KONDATE_E2E_SKIP_RECREATE=1` は **開発反復用のオプトインのみ**。CI では使わない |
| CI 終了時の auth/app 復元 | GHA は直後に `docker compose down --volumes` するため、**CI 検出時は restore を短縮**してよい（Plan で `CI=true` 分岐）。ローカルは現行 restore を維持 |
| tooling テスト | recreate シーケンス断言を「CI 以外」または新シーケンスに合わせて更新 |

### 7.8 Phase 3 完了条件

- [ ] `compose.e2e.yaml` のみ高い `GLOBAL_DAILY_AI_LIMIT`、通常 compose は 20
- [ ] `workers ≥ 2` で full が 2 連続 green
- [ ] test ごとの global truncate が廃止（または serial 区間のみ明示）
- [ ] 認証の高速経路が ephemeral の過半数で使われている、または storageState + 残 Mailpit の方針が文書化されている
- [ ] full 実測が目安 ≤10 分、または workers とハードウェア上の限界を PR で説明
- [ ] 製品 preflight / 本番 env 契約のテストが依然緑

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
| smoke が薄く main だけ red | full を push ゲートに残す。smoke セット変更に表更新を必須化 |
| storageState 共有で偽 green / 汚染 | `@ephemeral-auth` 必須リスト。破壊的 test は setup を使わない |
| 並列で global 枠・Mailpit flaky | Phase 3 で limit 上書き + 認証注入。workers は 2 から |
| tooling テストが run-e2e 文字列に固定 | シーケンス変更時に `tests/tooling/*.mjs` を同時更新 |
| 受け入れ title 変更漏れ | verify-acceptance-matrix を CI で既に実行していることを利用 |

## 10. ファイル影響マップ（概略）

| パス | Phase | 変更概要 |
| --- | --- | --- |
| `playwright.config.ts` | 1–3 | tags 利用、setup project、workers、dependsOn |
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
