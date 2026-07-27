# 低価格有料 OpenRouter モデル導入 設計書

- 日付: 2026-07-26
- 状態: 実装中（Plan: `docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`）
- 対象: OpenRouter モデル許可規則、起動/デプロイ検証、利用上限、プライバシー説明、運用ゲート
- 改訂: 2026-07-26 コード突合レビュー（structured AND 維持、mock 判定信号、privacy ロールアウト、quota 相互作用、文書ギャップ）

## 1. 背景

### 1.1 観測事実（2026-07-26 ローカル実 API 検証）

本番相当の `menuResponseFormat`（strict JSON Schema + `provider.require_parameters: true`）と、アプリ固定の時間予算（1 試行 20s / Function 総予算 50s / processing stale 180s）の下で、次を確認した。

| 区分 | 結果 |
|------|------|
| 旧 free ID（例: `google/gemma-3-27b-it:free`） | Models API に存在せず。chat は 404「unavailable for free」→ UI は `model_unavailable`（「AIが混み合っています」） |
| 現行 free（例: `openai/gpt-oss-20b:free`） | 数秒〜数十秒で返ることもあるが、**スキーマを無視**した簡略 JSON が多く、アプリ検証を通らない |
| 現行 free（例: `google/gemma-4-26b-a4b-it:free`） | 形状は近いことがあるが **37–125 秒**級で、20s/50s 予算と両立しない |
| 台帳上の失敗 | `generation_timeout` が processing 開始から約 **180s**（stale 期限）で終端する事例。成功クォータは未消費 |
| 有料モデルの実測 | 検証用キーが **total limit 403** のため、本セッションでは有料 ID のレイテンシ/形状ベンチを完了できなかった |

結論: **現状の free のみ方針では、品質と速度を同時に満たして本番提供できない**。MVP 設計が先送りした「有料移行は運営方針決定後の別スコープ」に、本設計で着手する。

### 1.2 既存設計の関連箇所

`docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` は次を固定している。

- OpenRouter は Netlify Functions からのみ。`:free` 必須、有料 ID と `openrouter/auto` は起動・ビルド・デプロイ検証で拒否。
- 無料モデルがすべて使えなくても有料へ自動切替しない。
- 公開規模が無料枠を超える場合は自動移行せず、運営方針を決めてから別スコープで設計する（§18）。
- 構造化出力はデプロイ検証で確認する（§11.1）。現行コード契約は **`structured_outputs` と `response_format` の両方必須**（`scripts/openrouter-models-contract.mjs`、`verify-openrouter-models.mjs`）。

本設計はその「別スコープ」であり、§11 / §18 の free-only 判断を **明示的に改訂**する。構造化の AND 条件は **緩和しない**（§4.1.6 / §12-3）。

## 2. 目的と成功条件

### 2.1 目的（ユーザー決定）

- **第一目的**: 品質・速度の安定化により、AI 献立生成を本番提供可能な水準にする。
- コストは二次だが、暴走課金は防ぐ。
- 本番 `OPENROUTER_MODELS` は **有料 allowlist のみ**（free フォールバックなし）。

### 2.2 成功条件

1. 本番設定で `:free` と `openrouter/auto`（および同等ルーター）を起動時・デプロイ検証時・ランタイム前段で拒否する。
2. 許可モデルは OpenRouter Models API 上で **`structured_outputs` と `response_format` の両方**を `supported_parameters` に含み、単価上限を満たす。
3. 実装完了ゲート前に、候補から選んだ primary（と任意の repair 用 2 本目）が、**実 `menuResponseFormat` でレイテンシ合格かつアプリが受理する形状**を満たすことを記録する（合格基準は §4.4）。
4. 利用上限を有料向けに引き下げ、日次の外部送信件数を抑える。相互作用（成功×repair×attempt×global）を仕様として固定する（§5）。
5. プライバシー説明を有料モデル提供者送信に合わせて更新し、説明 version 更新後は再確認を要求する。ロールアウトと literal 不一致の見え方を定義する（§7）。
6. ローカル E2E/単体は従来どおり **openrouter-mock** で決定論的に通る。

### 2.3 非目標

- free → 有料の自動フォールバック、または有料 → free の自動フォールバック。
- `openrouter/auto` / `openrouter/free` / `openrouter/auto-beta` ルーターの採用。
- アプリ内での厳密な USD 課金計算・請求書連携。
- 1 試行 20s / 総予算 50s / stale 180s の緩和（時間予算は現行固定。有料モデル選定で 20s 内を満たす）。
- ユーザー課金（エンドユーザーから AI 利用料を徴収する機能）。
- モデル品質の人手評価パイプライン（初回は自動ゲート + スポット確認で足りる）。
- structured / response_format の **OR 緩和**（adversarial 由来の現行 AND を維持）。

## 3. 決定事項（Key Decisions の要約）

詳細は §12。

| 項目 | 決定 |
|------|------|
| 方針 | 有料 allowlist 置換（方式 A） |
| free | 本番・実 API 経路から排除。mock 専用例外のみ（§4.2） |
| 構造化 | **`structured_outputs` AND `response_format` の両方必須**（現行維持・緩和しない） |
| 単価上限 | prompt + completion の 1M 換算和 ≤ **$0.50**。request/cache 等は **判定に使わない**（§4.1.7） |
| クォータ | 成功 **3**/日、attempt **6**/日、全体初期 **20**/日。短期 4/600s 据え置き。**相互作用は意図的**（§5 / §12-4） |
| 時間予算 | 20s / 50s / 180s 据え置き |
| 候補 ID | 下記 3 本。Models API 機械フィルタ後、exact な順序付き構成を有料実測 |
| mock 判定信号 | **`OPENROUTER_BASE_URL` の exact mock URL のみ**（`SERVER_SITE_ORIGIN` / isLocal と混同しない） |
| コスト監視 | アプリは回数上限。OpenRouter キー hard $ limit を運用必須 |

## 4. モデル許可規則

### 4.1 `OPENROUTER_MODELS` の受理条件

カンマ区切り・前後 trim・空要素なし。順序は OpenRouter `models` 配列の優先順として維持する。

各 ID について:

1. 非空の明示モデル ID である。
2. ルーター ID ではない。拒否集合は少なくとも
   `openrouter/auto`、`openrouter/free`、`openrouter/auto-beta`。
3. **`:free` で終わらない**（実 API 経路。mock 例外は §4.2）。
4. リスト内で重複しない。
5. リストは 1 件以上。
6. デプロイ時（および `--remote` 検証時）OpenRouter Models API で ID が存在し、`supported_parameters` に
   **`structured_outputs` と `response_format` の両方が含まれる**。
   片方だけの ID は **拒否**する（現行 `verifyRemoteModels` と同一。本設計はこれを緩めない）。
7. 同 API の `pricing.prompt` と `pricing.completion` を数値化し、1 トークン単価 × 1e6 した値の **和**が **$0.50 以下**。
   - **ちょうど $0.50 は可**（`sum <= 0.5`）。
   - `pricing` 欠落、非数値、負値は fail-closed（拒否）。
   - `pricing.request` / `internal_reasoning` / cache 系フィールドは **本ゲートでは読まない・加算しない**（運用でキー hard limit が最終防壁。request 課金型を許可リストに載せる場合は別設計改訂）。

### 4.2 ローカル mock 例外とパーサ契約

#### 4.2.1 唯一の mock 経路信号

mock モデル（`:free` かつ `mock/` プレフィックス）を許すかの判定信号は **`OPENROUTER_BASE_URL` のみ**とする。

- 許可: 現行 `isExactLocalMockBaseUrl` と同一の exact URL
  `http://openrouter-mock:8787/api/v1`
  （protocol/host/port/path 完全一致、userinfo・query・fragment 禁止。既存 `openrouter.ts` の判定と鏡像）。
- **禁止の混同**: `SERVER_SITE_ORIGIN === http://127.0.0.1:5173`（`parseServerEnv` の `isLocal`）は **mock 例外の根拠に使わない**。
  ローカル origin でも `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` のときは有料規則のみ（`:free` 拒否）。

#### 4.2.2 パーサシグネチャ（言語化）

現行 `parseOpenRouterModels(value: string)` は base URL を知らない。mock 例外を入れるには **コンテキスト引数が必須**である。

全鏡像で次の契約に揃える（モジュール共有ではなく、現行どおり契約ファイルを正本とした鏡像でもよいが、**引数と規則文面は同一**）:

```ts
type OpenRouterModelsParseContext = {
  /** trim 済み・末尾スラッシュ除去前の raw でも可。判定前に exact mock URL 正規化規則を適用 */
  openRouterBaseUrl: string;
};

function parseOpenRouterModels(
  value: string,
  context: OpenRouterModelsParseContext,
): readonly string[];
```

| 呼び出し元 | 渡す `openRouterBaseUrl` |
|------------|---------------------------|
| `netlify/functions/_shared/env.ts` `parseServerEnv` | `result.data.OPENROUTER_BASE_URL`（既存の末尾 `/` 除去後でも、exact 比較前に同一正規化を共有） |
| `scripts/verify-openrouter-models.mjs` `parseConfiguredModels` | `env.OPENROUTER_BASE_URL`（未設定時は公式 URL 扱いで有料規則＝`:free` 拒否） |
| `scripts/preflight-production.mjs` `parseOpenRouterModels` | 本番 preflight は **常に公式 base** 前提。mock 例外は **到達不能**（`OPENROUTER_BASE_URL` が公式以外なら既存どおり production で既に失敗する経路を維持）。引数は公式 URL を明示渡しし、規則分岐を他と同一コードパスにする |

`scripts/openrouter-models-contract.mjs` は規則の正本文言を有料+mock 例外に更新し、accepted/rejected フィクスチャを両経路分そろえる。

#### 4.2.3 mock 受理条件（すべて必須）

1. `openRouterBaseUrl` が exact local mock URL。
2. 各 ID が `mock/` で始まる。
3. 各 ID が `:free` で終わる（現行 compose / secrets / CI の
   `mock/kondate-primary:free,mock/kondate-repair:free` と互換）。
4. 空・重複なし。
5. 単価上限・Models API リモート検証は **スキップ**（構造化は mock フィクスチャが保証）。

exact mock URL 以外では、`mock/` も `:free` も拒否する。

### 4.3 ランタイム（`openrouter.ts`）

`sendMenuGeneration` は `getServerEnv().openRouter.models`（パース済み）のみを送る。

**置き換えるガード**（`:free` 必須）:

- 設定 models が空、重複、または `openrouter/auto`（および §4.1.2 のルーター集合）を含む → `model_unavailable`
- 実 API 経路で `:free` を含む → `model_unavailable`
  （通常は env パースで既に落ちる。defense in depth）

**据え置くガード**（実装時に消してはならない）:

- 空リスト / 重複の再検査（現行 L117–119 相当の構造）
- 除外後 models が空 → `model_unavailable`
- timeoutMs 不正 → `generation_timeout`
- 応答 `model` が **今回送信した `models` 配列に含まれない** → `model_unavailable`（現行 L199 相当）
- `provider: { require_parameters: true }` は維持

有料 ID を送ることは正常系である。

### 4.4 候補ショートリストと実装完了ゲート

R1 Stage 1（2026-07-27）で固定した評価対象（snapshot + 意思決定記録:
`docs/bugfix/artifacts/r1-stage1-decision-record-2026-07-27.md`）:

1. `openai/gpt-oss-20b`
2. `inclusionai/ling-2.6-flash`
3. `mistralai/mistral-small-24b-instruct-2501`
4. `meta-llama/llama-3.1-8b-instruct`
5. `openai/gpt-4.1-nano`

手続きの正本: `docs/superpowers/specs/2026-07-27-openrouter-candidate-configuration-reslist-design.md`

#### 4.4.1 ベンチ前の機械フィルタ（必須順序）

有料 chat ベンチの前に Models API で各 ID を確認し、次のいずれかで **即除外**する（課金回数を減らす）:

- ID 不在
- `structured_outputs` または `response_format` の欠落（AND 不合格）
- §4.1.7 の単価上限超過または pricing 欠落

除外理由をゲート証跡に残す。残存 ID だけを §4.4.2 へ進める。

#### 4.4.2 レイテンシ/形状ゲート

§4.4.1 を通過した ID から、ship 候補となる **1～2 ID の exact な順序付き
`OPENROUTER_MODELS` 構成**を作る。構成ごとに、実 `menuResponseFormat`・
**本番 `buildGenerationMessages` が非 PII の固定入力から生成するプロンプト**・
`require_parameters: true` で **N = 10 単位**を実行する。配列の要素と順序が異なる構成の結果を流用してはならない。

**1 単位 = production service harness を通した本番 1 生成フロー**とする。harness は
`runGeneration` 相当の単調時計、pre-send guard、repository の
`markSent` / `reserveRepair` / finalize 遷移を含める:

harness は本番 DB / 本番 quota ledger へ書き込まない。`markSent` / `reserveRepair` / finalize の
本番と同じ遷移意味論を実装した隔離 in-memory/test repository を使い、**各単位の開始時に fresh ledger
へ初期化**する。1 単位内では成功 3 / attempt 6 / global 20 の判定意味論を維持する一方、構成間・単位間で
日次カウンタを累積させない。これにより quota 拒否をモデル品質 FAIL に混入させない。このベンチ上の隔離は
証跡採取方法だけの規定であり、本番の 3 / 6 / 20 ロックは変更しない。

- primary は当該 exact 構成の配列を `models` として 1 回送る。`composeCandidate` が
  `kind: "valid"` なら finalize し、単位成功とする。`kind: "conflict"` は
  `constraint_conflict` で終端し、repair しない。
- body / transport failure は次の優先順位で分類する。Abort/deadline が成立している場合、または最終の
  単調時計 elapsed が `timeoutMs` 以上の場合は、他の検出済みエラーより
  `OpenRouterCallError("generation_timeout")` を優先し、repair しない。byte cap 検出後の
  `reader.cancel()` 待機中に Abort した競合も `generation_timeout` とする。
- timeout が成立していない場合に限り、次の初回失敗を repair 適格とする:
  - HTTP 200 応答の body が byte cap を超えた場合、および JSON / response envelope schema /
    wire schema / wire→内部 adapter が不正な場合の
    `OpenRouterCallError("invalid_ai_response")`
  - materializer / validator の失敗を含む `composeCandidate(...).kind === "invalid"`
- raw envelope から取得できた `model` が当該送信の `models` 配列外なら
  `model_unavailable` とし、repair しない。この判定を response envelope schema 検査より先に行うため、
  response envelope schema が不正でも取得済み `model` が送信外なら `invalid_ai_response` ではなく
  `model_unavailable` とする。
- timeout が成立していない場合に限り、非 2xx、fetch の transport 失敗、
  Abort 以外の body stream 読取失敗、上記モデル不一致は `model_unavailable` とする。
  `generation_timeout` / `model_unavailable` / `constraint_conflict` は repair しない。
- repair 適格でも外部 repair 送信は最大 1 回とする。初回の実応答モデルが既知なら、
  exact 構成からその ID を除外した順序付き配列を repair の `models` とする。
  除外後にモデルが残らなければ repair を送らず単位失敗とする。初回の実応答モデルが不明なら、
  本番どおり除外せず exact 構成を repair の `models` とする。repair 後の invalid / conflict /
  call error は再 repair せず、単位失敗とする。

合格条件（すべて必須・緩和禁止）:

- 各送信の 20s 境界は、本番 `sendMenuGeneration` と同じく **`AbortController` を作成して
  `setTimeout` を開始した時点から、body 読取、JSON / response envelope / model 検査、
  wire parse、adapter を完了し、`finally` で timer を解除するまで**とする。timer 開始後の
  response format 選択など、fetch 前の処理も含める。各送信は HTTP 200 かつこのクライアント計測で
  20s 未満でなければならない。materialize / validate は 20s 境界に含めない。
- Abort timer だけに依存しない。timer 開始時刻を単調時計で記録し、body / JSON / response envelope /
  model / wire / adapter の処理完了直後かつ成功 return 前に最終 elapsed を検査する。
  `elapsed >= timeoutMs` なら `OpenRouterCallError("generation_timeout")` として fail-closed にする。
  同期 JSON/schema/adapter 処理中に Abort callback が発火できず、その後 `finally` が timer を解除する場合も
  超過を合格させない。この契約は本番 `openrouter.ts` と production service harness の双方に実装する。
  19,999ms は境界内、20,000ms は失敗とし、遅い JSON/schema/adapter と
  byte cap 検出後の `reader.cancel()` 待機中 Abort の競合をテストする。
- 50s 境界は handler の `requestStartedAt` から始め、context load、preflight、ledger、
  primary / repair、materialize / validate、finalize までを含める。単位は
  `FUNCTION_TOTAL_BUDGET_MS = 50,000` 内に終端しなければならない。
- primary と repair の**各送信前**に、本番と同じ
  `REQUIRED_SEND_BUDGET_MS = 22,000`（20s + `FINALIZE_RESERVE_MS = 2,000`）以上の残予算を要求する。
- `envelope.model` は、その送信で実際に渡した `models` 配列に含まれなければならない。
- 本番と同形の response schema + `aiGenerationResponseSchema`（wire 経由の場合はアダプタ適用後）
- `materializeAiGeneratedMenu` + `validateGeneratedMenu` 成功
- **10 単位すべて成功**

単なる fetch 2 回の elapsed 合計では合格にしない。証跡には、評価した exact 構成の配列順序、
単位内の各送信で渡した `models` 配列、各実応答モデル、除外モデル、初回成功 / repair 後成功 /
失敗の別、失敗コードを残す。**N=10 を通過した exact 構成だけ**を、その順序のまま
`OPENROUTER_MODELS` へ提案する。

最低限、次の構成を独立して評価する（評価順 = 推奨タイブレーク）:

1. `["openai/gpt-oss-20b"]`
2. `["inclusionai/ling-2.6-flash"]`
3. `["mistralai/mistral-small-24b-instruct-2501"]`
4. `["openai/gpt-oss-20b", "mistralai/mistral-small-24b-instruct-2501"]`
5. `["openai/gpt-4.1-nano", "openai/gpt-oss-20b"]`
6. `["inclusionai/ling-2.6-flash", "meta-llama/llama-3.1-8b-instruct"]`

単体 ID の合否を後から組み合わせたり、個別合格 ID から最大 2 本を選んだりしてはならない。
合格した exact 構成だけが、その順序を維持した `OPENROUTER_MODELS` の提案候補になる。

> 注: 2026-07-26 時点の検証キーは total limit 403 のため、このゲートは **キーにクレジットを載せた後**に実行する。設計承認とゲート通過は分離する。

## 5. 利用上限（クォータ）

### 5.1 新リリース固定値

| 環境変数 / 権威 | 現行 | 新値 | 意味 |
|-----------------|------|------|------|
| `USER_DAILY_AI_LIMIT` / SQL `p_user_limit` 固定 | 5 | **3** | 成功した生成の利用者日次上限（JST） |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` / SQL attempt 12 | 12 | **6** | OpenRouter へ送った HTTP の利用者日次上限 |
| `GLOBAL_DAILY_AI_LIMIT` / SQL global 上限帯 | 45 | **20** | アプリ全体の日次外部送信上限 |
| 短期窓 | 4 / 600s | **据え置き** | |
| 時間予算 | 20s / 50s / 180s | **据え置き** | |

`releaseLockedInteger`・`preflight-production.mjs` の exact 値検査・**SQL 内ハードコード**（例: `p_user_limit <> 5`、`>= 12` attempt、global `between 1 and 45`、CHECK 制約）を **同一リリース値へ同時更新**する。env だけ変えて SQL が 5/12 のまま残る状態は禁止。

### 5.2 成功 3 × attempt 6 × 全体 20 の相互作用（意図的）

現行意味論を変更しない前提:

- 1 回の生成フローは最大 **primary + repair の 2 外部送信**
- 送信済み attempt / global は **返却しない**
- timeout 後は repair しない

このとき:

| 事実 | 帰結 |
|------|------|
| 成功 3 回をすべて「毎回 repair あり」で達成しようとすると | attempt 消費 6 で **ちょうど日次 attempt 上限**。失敗や timeout が 1 回でも混ざると、成功 3 に届く前に attempt 上限に当たる |
| 成功のみ（repair なし）で 3 回 | attempt 3 で足りる。残り 3 は失敗・再試行用バッファ |
| 全体 20 / 利用者最大 attempt 6 | 理論上 **約 3〜4 アクティブ利用者/日**でアプリ全体上限に達し得る |

**本設計の判断（§12-4）: 露出抑制を優先し、3 / 6 / 20 を維持する。**
これは「常に成功 3 回を保証する」設計ではない。有料化直後の課金・濫用面を絞り、必要なら後続改訂で attempt を 8 等へ上げる。

UI は成功残と attempt 残の両方を既存 usage 投影で示す。attempt 上限時の既存メッセージ経路を維持する。

### 5.3 固定コピー更新箇所（確定）

「今日は5回利用しました…」は次の **2 箇所**（鏡像）を **3 回**へ更新する:

- `shared/contracts/generation.ts`（`issueMessages.user_daily_limit`）
- `netlify/functions/_shared/generation-service.ts`（failure copy 表）

その他「5 回」前提のテスト期待値・factories・compose 既定 env・deployment 表も追随する。

## 6. コストと運用

### 6.1 アプリの役割

- 回数上限のみで露出を制御する。
- token 単価からの USD 積算、予算アラート API、Stripe 連携は持たない。

### 6.2 運営の必須運用

1. OpenRouter ワークスペース/キーに **total credit hard limit** を設定する。
2. デプロイ前に `verify:openrouter:models --remote`（改訂後）と、§4.4 ゲート証跡を残す。
3. モデル停止や単価上昇で上限超過になった ID は env から外し再デプロイする。

### 6.3 概算コスト（参考・非規範）

1 生成あたり入力 5–15k + 出力 2–4k token 程度を仮置きすると、候補帯では **おおよそ $0.001–0.01/回** になりやすい。全体 20 送信/日でも月次は小さく抑えられる見込み。正確値はゲート実測の usage で更新する。

## 7. プライバシーと利用者説明

### 7.1 文面と version

有料モデルは OpenRouter 経由で **有料エンドポイント提供者**にプロンプトが渡り得る。

- AI 情報送信説明を「無料モデル提供者」前提から、「OpenRouter および設定されたモデルの提供者（有料を含む）」へ更新する。
- `privacyNoticeVersion`（現行 `shared/contracts/domain.ts` の `"2026-07-11.v1"`）を **新しい literal**（例: `"2026-07-26.v1"`）へ上げる。
- 当該定数は少なくとも次で `z.literal(privacyNoticeVersion)` として埋まっている:
  - `shared/contracts/generation.ts`（生成リクエスト等）
  - `netlify/functions/_shared/generation-context.ts`
- 単一の export を更新し、テスト・fixtures の旧 version 文字列を追随する。

### 7.2 同意状態への影響（意図的）

- `privacy_notice_acceptances` に保存された **旧 version の行はすべて「現行 version 未同意」**とみなされる（現行の version 一致検査の意味論どおり）。
- 全ユーザーが次回 AI 生成前に新説明の確認を求められる。**これは意図した再同意**であり、バグではない。設計・リリースノートに明記する。

### 7.3 ロールアウトとデプロイ非同期窓

Netlify はフロントと Functions を同一デプロイで差し替える想定だが、CDN/タブ残存により短時間の版ずれが起き得る。

| 状況 | 起きること | ユーザーに見える結果 |
|------|------------|----------------------|
| 新ブラウザ + 新 Function | 新 version で同意または再同意 → 生成可 | 正常。未同意なら説明画面 |
| 旧ブラウザバンドル（literal 旧）+ 新 Function（literal 新） | リクエスト body の `privacyNoticeVersion` が Zod literal 不一致 | **422 / バリデーション失敗**系。生成不能。再読み込み（新バンドル取得）を促す |
| 新ブラウザ + 旧 Function（稀・ロールバック中） | 新 version を旧 Function が拒否 | 同様に失敗。ロールバック完了または再デプロイまで生成不能 |
| 進行中の **auth-continuation**（TTL 300s） | continuation ペイロードに旧 version が載っている場合、復帰 POST が新 literal と不一致 | 認証継続フローが失敗し得る。ユーザーはログインし直し + 新説明確認が必要 |

**ロールアウト手順（必須）**

1. PR4（privacy）は **ブラウザと Functions が同一デプロイ単位で同時に新 version を載せる**こと。version だけ先行した Function 単体デプロイは禁止。
2. デプロイ直後のリリースノート/周知: 「AI 利用前に説明の再確認が必要」「生成エラー時はページを再読み込み」。
3. デプロイ後 300s は auth-continuation 不整合が残り得ることを運用が知る（自動マイグレーションはしない。fail-closed）。
4. 旧 version を受け入れる互換パーサは **追加しない**（二重意味論を避ける）。

「既存同意フローを流用」とは、画面遷移・保存テーブル・未同意ゲートの **機構**を再利用することであり、旧 version の暗黙継続を意味しない。

## 8. 実装境界

### 8.1 変更する

**コード・契約**

- `scripts/openrouter-models-contract.mjs`
- `scripts/verify-openrouter-models.mjs`（`parseConfiguredModels` シグネチャ + remote AND + 単価）
- `scripts/preflight-production.mjs`（parse 鏡像・quota exact 値）
- `netlify/functions/_shared/env.ts`（`parseOpenRouterModels(value, context)`・releaseQuota）
- `netlify/functions/_shared/openrouter.ts`（runtime ガード置換。§4.3 の据え置き項目を維持）
- SQL / マイグレーション: attempt 12・user limit 5・global 45 帯・関連 CHECK を 3/6/20 系へ
- `shared/contracts/generation.ts` の `releaseQuota` と `issueMessages.user_daily_limit`
- `netlify/functions/_shared/generation-service.ts` の同文言
- privacy: `shared/contracts/domain.ts` の `privacyNoticeVersion` と全参照・UI コピー
- `netlify/functions/_shared/openrouter.smoke.test.ts`（有料課金の注記・期待の `:free` 除去）
- compose / `generate-local-secrets` / CI env の quota 既定値
- 関連 Vitest・tooling・pgTAP

**ドキュメント（free-only / 5回 / Non-:free 受入を矛盾なく）**

- `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md`（§11.1, §18 および L381 / L383 / L661 / L668 / L678 相当）
- `docs/deployment/netlify.md`
- `docs/runbooks/openrouter.md`
- `docs/testing/release-checklist.md`
- `docs/testing/acceptance-matrix.md`（受入項目 19「Non-:free model config fails…」を有料規則に合わせて改訂）
- README / CLAUDE.md / 必要なら AGENTS.md

**acceptance-matrix と CI**

`scripts/verify-acceptance-matrix.mjs` は matrix 行とテスト title の対応を CI で検証する。
**matrix 改訂と、対応するテスト title 変更は同一 PR（PR2）に入れる。** PR1 で matrix だけ先に変えて CI を割ることは禁止。

### 8.2 変更しない

- generation ledger / HMAC / idempotency / RLS の骨格
- repair 最大 1 回・timeout 後 repair 禁止
- 緊急献立への導線（モデル障害時）
- browser から OpenRouter を呼ばない境界
- structured AND 条件の緩和

### 8.3 所有権

| 領域 | 所有者 |
|------|--------|
| モデル許可・検証スクリプト | サーバー/ツール |
| quota 定数（env + SQL） | サーバー + 契約/表示 |
| privacy コピー | 共有 contracts + UI |
| ベンチ証跡 | 運用/設計ゲート（リポジトリに生シークレットを置かない） |

## 9. テスト計画

1. **単体**: 新 parse 規則（有料 OK、実 API で `:free` NG、auto NG、重複 NG、単価超過 NG、mock 例外は exact mock URL のときのみ OK、isLocal だけでは mock 例外にならない）。
2. **verify スクリプト**: フィクスチャ Models API で **structured AND response_format** と pricing を検証。片方欠落は失敗。
3. **既存生成テスト**: mock 経路の回帰（形状・quota 数値更新に伴う期待値・SQL）。
4. **E2E**: mock のまま成功/失敗/timeout 文言。
5. **opt-in 実 API スモーク**（`openrouter.smoke.test.ts`）: 明示 env があるときのみ。**1 回あたり実費（有料）が発生する**ことをコメントと §6 運用に明記。`:free` 期待を有料 ID 期待へ更新。
6. **手動ゲート**: §4.4 の機械フィルタ結果 + N=10 表（API キーは載せない）。
7. **privacy**: 新 version literal、旧 version リクエスト拒否、再同意後の生成可。

## 10. リスクと緩和

| リスク | 緩和 |
|--------|------|
| 有料でも 20s 内に構造化が通らない | 完了ゲートで不合格なら ship しない |
| 単価改定で昨日まで合法の ID が拒否 | デプロイ検証で fail-closed |
| キー limit で本番全体停止 | キー limit 必須 + GLOBAL 20 |
| attempt 6 で成功 3 に届かない | §5.2 の意図的トレードオフ。usage UI で残数表示 |
| 全体 20 で数ユーザーで枯渇 | 露出抑制優先。監視で引き上げ判断 |
| privacy version デプロイずれ | 同一デプロイ単位・互換パーサなし・再読込案内 |
| free 時代の「混み合い」文言 | 本設計の主目的外。別 UX 設計候補 |

## 11. 検証サマリ（本設計の根拠）

### 11.1 free 実測

- free では速度または形状がアプリ制約と衝突。
- `generation_timeout` は成功回数非消費。attempt は送信済みなら消費され得る。

### 11.2 有料実測

- 未完了（key total limit）。レイテンシ/形状は **実装完了のブロッカー**。
- 構造化 AND・単価は Models API で機械判定可能（§4.4.1）。

## 12. Key Decisions

1. **品質・速度を第一目的**とし、free のみ方針を廃止する。
   根拠: free では 20s 予算とスキーマ適合を両立できない実測。

2. **本番は有料 allowlist のみ**（方式 A）。free/有料ハイブリッドは採用しない。
   根拠: フォールバックが free の遅延・不正 JSON を再導入するため。

3. **構造化検証は現行どおり AND を維持**する（`structured_outputs` **かつ** `response_format`）。
   根拠: `openrouter-models-contract.mjs` / `verify-openrouter-models.mjs` の adversarial 固定値。OR への緩和は根拠なき簡略化であり行わない。候補 3 本も AND 不合格なら機械フィルタで落とす。

4. **クォータ 3 / 6 / 20 を維持し、相互作用を仕様として受け入れる**。
   根拠: ユーザー選択の露出抑制。成功 3 = 毎回 repair 前提だと attempt 6 ちょうどでバッファがないこと、全体 20 が約 3〜4 ユーザー分であることは **既知の制約**であり、成功保証より課金・濫用抑制を優先する。時間予算は据え置き。

5. **承認済み shortlist（R1: 5 ID）から作る exact な順序付き構成（R1: 6 本）を、production service harness の N=10 単位で評価**する。
   根拠: 本番は primary + repair の最大 2 送信であり、個別 ID の合否を後から組み合わせても
   実際に ship する `OPENROUTER_MODELS` の挙動を証明できないため。

6. **mock 例外の信号は `OPENROUTER_BASE_URL` exact mock のみ**とし、`parseOpenRouterModels(value, { openRouterBaseUrl })` に全鏡像を揃える。
   根拠: 現行パーサは base を知らず、isLocal は別概念。3 実装 + 契約の不一致を防ぐ。

7. **プライバシー version を上げ、旧同意は無効化し、デプロイは同一単位・互換なし**とする。
   根拠: 送信先説明の変更。literal 埋め込みと continuation TTL 300s の不整合は fail-closed で受容する。

8. **単価ゲートは prompt+completion のみ、≤ $0.50（境界含む）。request/cache は無視**する。
   根拠: 低価格帯の誤設定防止と実装の単純さ。最終防壁はキー hard limit。

## 13. Open Questions

1. **有料キーの total limit 解除後のベンチ日程**
   - 担当: 運営者
   - ゲート: §4.4 不合格なら実装完了不可

2. **本番採用する最終 exact 順序付き構成**
   - N=10 を通過した exact 構成を、要素・順序を変えずに env 例と README へ反映する。
     個別 ID を再結合してはならない。

3. **MVP 本文の改訂を PR1 に含める範囲**
   - 推奨: PR1 で MVP §11/§18 と本ファイルを整合。acceptance-matrix のテスト title 連動は **PR2**（§14）

## 14. PR Plan

### PR1: 設計と MVP 本文の固定（コードの受入行列は変えない）

- 本ファイル。
- `2026-07-11-kondate-mvp-design.md` の free-only / クォータ記述を本設計へ整合。
- **含めない**: `acceptance-matrix.md` のテスト title 依存行の改訂のみ先行（CI 割れ防止）。
- 依存: なし。

### PR2: モデル契約・検証スクリプト・env パーサ・runtime・matrix

- 契約 / verify / preflight / `parseOpenRouterModels(value, context)` / openrouter runtime。
- mock 例外（exact base URL）。
- 単価 + structured **AND**。
- `docs/testing/acceptance-matrix.md` と **対応テスト title** を同一 PR で更新。
- `docs/deployment/netlify.md` / `docs/runbooks/openrouter.md` / release-checklist のモデル規則。
- 依存: PR1。

### PR3: クォータ 3/6/20（env + SQL + コピー + テスト）

- releaseQuota、preflight exact、**SQL/CHECK/RPC ハードコード**、compose/CI 既定。
- `今日は3回利用しました` の 2 鏡像。
- 依存: PR2 と同時でも可だが、SQL を含むため独立 review を推奨。

### PR4: プライバシー説明 version 更新

- version literal・文面・再同意・ロールアウト手順のテスト。
- ブラウザと Function の同一デプロイ制約を PR 説明に明記。
- 依存: PR1。PR2/3 と並列可。

### PR5: 有料ベンチ証跡と本番 env 例

- キーにクレジットを載せた後 §4.4 を実行。
- README の推奨 `OPENROUTER_MODELS` は、N=10 を通過した exact 順序付き構成を
  要素・順序不変で反映する。個別 ID を再結合してはならない。
- 依存: PR2。**ship の最終ゲート**。

各 PR は review 可能とし、PR5 のゲート不合格なら本番有効化しない。

## 15. 実装への引き渡し

次ステップは SuperPowers `writing-plans` により実装 Plan を起こすこと。

Plan は少なくとも次を Task 化すること:

1. MVP 設計書の矛盾解消（PR1）
2. モデル契約 RED/GREEN + matrix 同期（PR2）
3. quota env+SQL+コピー RED/GREEN（PR3）
4. privacy version とロールアウト（PR4）
5. 有料ベンチゲートと README（PR5）

実装セッションは **1 Task ずつ**、既存 CLAUDE.md / SubAgents フローに従う。
