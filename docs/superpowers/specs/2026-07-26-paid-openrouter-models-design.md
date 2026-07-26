# 低価格有料 OpenRouter モデル導入 設計書

- 日付: 2026-07-26
- 状態: ユーザー承認済み（brainstorming セッション）
- 対象: OpenRouter モデル許可規則、起動/デプロイ検証、利用上限、プライバシー説明、運用ゲート

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

本設計はその「別スコープ」であり、§11 / §18 の free-only 判断を **明示的に改訂**する。

## 2. 目的と成功条件

### 2.1 目的（ユーザー決定）

- **第一目的**: 品質・速度の安定化により、AI 献立生成を本番提供可能な水準にする。
- コストは二次だが、暴走課金は防ぐ。
- 本番 `OPENROUTER_MODELS` は **有料 allowlist のみ**（free フォールバックなし）。

### 2.2 成功条件

1. 本番設定で `:free` と `openrouter/auto` を起動時・デプロイ検証時・ランタイム前段で拒否する。
2. 許可モデルは OpenRouter Models API 上で構造化出力対応（`response_format` または `structured_outputs`）であり、単価上限を満たす。
3. 実装完了ゲート前に、候補から選んだ primary（と任意の repair 用 2 本目）が、**実 `menuResponseFormat` で p95 &lt; 20s かつアプリが受理する形状**を満たすことを記録する。
4. 利用上限を有料向けに引き下げ、日次の外部送信件数を抑える。
5. プライバシー説明を有料モデル提供者送信に合わせて更新し、説明 version 更新後は次回 AI 生成前に再確認する（既存同意フローを流用）。
6. ローカル E2E/単体は従来どおり **openrouter-mock** で決定論的に通る。

### 2.3 非目標

- free → 有料の自動フォールバック、または有料 → free の自動フォールバック。
- `openrouter/auto` / `openrouter/free` ルーターの採用。
- アプリ内での厳密な USD 課金計算・請求書連携。
- 1 試行 20s / 総予算 50s / stale 180s の緩和（時間予算は現行固定。有料モデル選定で 20s 内を満たす）。
- ユーザー課金（エンドユーザーから AI 利用料を徴収する機能）。
- モデル品質の人手評価パイプライン（初回は自動ゲート + スポット確認で足りる）。

## 3. 決定事項（Key Decisions の要約）

詳細は §12。ユーザー承認済みの骨子:

| 項目 | 決定 |
|------|------|
| 方針 | 有料 allowlist 置換（方式 A） |
| free | 本番設定から排除。mock 専用例外のみ |
| 単価上限 | prompt + completion ≤ **$0.50 / 1M tokens**（Models API pricing） |
| クォータ | 成功 **3**/日、attempt **6**/日、全体初期 **20**/日。短期 4/600s は据え置き |
| 時間予算 | 20s / 50s / 180s 据え置き |
| 候補 ID | 下記 5 本。primary/repair 順序は有料実測後に確定 |
| コスト監視 | アプリは回数上限。OpenRouter キーの hard $ limit を運用必須 |

## 4. モデル許可規則

### 4.1 `OPENROUTER_MODELS` の受理条件

カンマ区切り・前後 trim・空要素なし。順序は OpenRouter `models` 配列の優先順として維持する。

各 ID について:

1. 非空の明示モデル ID である。
2. `openrouter/auto` およびそれと同等のルーター ID（少なくとも `openrouter/auto`、`openrouter/free`、`openrouter/auto-beta`）ではない。
3. **`:free` で終わらない**（本番・実 API 経路）。
4. リスト内で重複しない。
5. リストは 1 件以上。
6. デプロイ時（および `--remote` 検証時）OpenRouter Models API で ID が存在し、`supported_parameters` に `response_format` または `structured_outputs` を含む。
7. 同 API の `pricing.prompt` と `pricing.completion` を 1M トークン換算した和が **$0.50 以下**。pricing 欠落は fail-closed（拒否）。

### 4.2 ローカル mock 例外

次を **すべて**満たすときだけ、`:free` 終わりの mock ID を許可する。

- `OPENROUTER_BASE_URL` が既存の exact local mock URL と一致する（現行 `http://openrouter-mock:8787/api/v1` の判定と同一）。
- モデル ID が `mock/` プレフィックスを持つ（例: `mock/kondate-primary:free`）。
- 単価上限・Models API リモート検証は mock 経路ではスキップする（構造化は mock フィクスチャが保証）。

実 API URL（`https://openrouter.ai/api/v1`）では mock ID も `:free` も拒否する。

### 4.3 ランタイム

`sendMenuGeneration` は env 検証済みの models リストのみを送る。追加の「free 以外を送ってしまったら落とす」ガードは、**:free 禁止**と **auto 禁止**に置き換える。有料 ID を送ることは正常系である。

`provider: { require_parameters: true }` は維持する。

### 4.4 候補ショートリスト（順序未確定）

ユーザー指定の評価対象。実装完了前に有料キーでベンチし、**最大 2 ID**（primary + repair 用）を `OPENROUTER_MODELS` に載せることを推奨する（3 本以上も技術的には可だが、attempt 6/日を圧迫しやすい）。

1. `mistralai/mistral-small-3.2-24b-instruct`
2. `openai/gpt-oss-120b`
3. `google/gemma-3-27b-it`
4. `qwen/qwen3-30b-a3b-instruct-2507`
5. `meta-llama/llama-3.1-8b-instruct`

**実装完了ゲート（必須）**

各候補について、実 `menuResponseFormat`・日本語家庭献立プロンプト・`require_parameters: true` で N≥5 回:

- HTTP 200
- クライアント計測で **p95 レイテンシ &lt; 20s**
- 応答が `outcome: "success"` かつ `menu.dishes` がオブジェクト配列で、アプリの materialize/validate が通る形状（最低限: dish に `dishRef`, `role`, `position`, `name`, `description`, `cookingTimeMinutes`, `ingredients`, `steps`）

合格したものから primary / 次点を選ぶ。1 本も合格しない場合は実装を「完了」とせず、候補変更または別設計（時間予算改訂など）に戻る。

> 注: 2026-07-26 時点の検証キーは total limit 403 のため、このゲートは **キーにクレジットを載せた後**に実行する。設計承認とゲート通過は分離する。

## 5. 利用上限（クォータ）

リリース固定整数として次へ更新する（現行 `releaseLockedInteger` パターンを維持し、近傍値 silent default は禁止）。

| 環境変数 | 現行 | 新値 | 意味 |
|----------|------|------|------|
| `USER_DAILY_AI_LIMIT` | 5 | **3** | 成功した生成の利用者日次上限（JST） |
| `USER_DAILY_EXTERNAL_CALL_LIMIT` | 12 | **6** | OpenRouter へ送った HTTP の利用者日次上限 |
| `GLOBAL_DAILY_AI_LIMIT` | 45（初期） | **20** | アプリ全体の日次外部送信上限（運営がさらに下げられる既存方針は維持） |
| `USER_SHORT_WINDOW_EXTERNAL_CALL_LIMIT` | 4 | **4**（据え置き） | 600s タンブリング窓 |
| `USER_SHORT_WINDOW_SECONDS` | 600 | **600**（据え置き） | |
| `OPENROUTER_TIMEOUT_MS` | 20000 | **20000**（据え置き） | |
| `FUNCTION_TOTAL_BUDGET_MS` | 50000 | **50000**（据え置き） | |
| `AI_PROCESSING_STALE_SECONDS` | 180 | **180**（据え置き） | |

予約・消費・返却の意味論（成功枠のみ成功時消費、attempt/global は送信後は返却しない等）は変更しない。

UI 文言・設定説明・`GET /api/usage/today` の表示は新上限に追随する。ハードコードされた「1 日 5 回」等があれば 3 に更新する。

## 6. コストと運用

### 6.1 アプリの役割

- 回数上限のみで露出を制御する。
- token 単価からの USD 積算、予算アラート API、Stripe 連携は持たない。

### 6.2 運営の必須運用

1. OpenRouter ワークスペース/キーに **total credit hard limit** を設定する（本検証で 403 total limit に達した事実を、運用上の安全弁として継続利用する）。
2. デプロイ前に `verify:openrouter:models --remote`（改訂後）と、§4.4 のレイテンシ/形状ゲート証跡を残す。
3. モデル停止や単価上昇で上限超過になった ID は env から外し再デプロイする。

### 6.3 概算コスト（参考・非規範）

1 生成あたり入力 5–15k + 出力 2–4k token 程度を仮置きすると、候補帯（おおよそ prompt+comp が $0.10–0.40/1M 前後）では **おおよそ $0.001–0.01/回** になりやすい。全体 20 送信/日でも月次は小さく抑えられる見込み。正確値はゲート実測の usage で更新する。

## 7. プライバシーと利用者説明

有料モデルは OpenRouter 経由で **有料エンドポイント提供者**にプロンプトが渡り得る。

- AI 情報送信説明の文面を「無料モデル提供者」前提から、「OpenRouter および設定されたモデルの提供者（有料を含む）」へ更新する。
- 説明 **version を上げ**、既存ルールどおり未同意ユーザーは次回 AI 生成前に再確認する。
- ログに prompt・生 AI 応答・個人識別子を出さない現行禁止は維持する。

## 8. 実装境界

### 8.1 変更する

- `scripts/openrouter-models-contract.mjs` / `verify-openrouter-models.mjs` / `preflight-production.mjs`
- `netlify/functions/_shared/env.ts`（parse 規則・releaseQuota）
- `netlify/functions/_shared/openrouter.ts`（runtime ガード）
- 関連 Vitest・tooling テスト
- README / CLAUDE.md / 必要なら AGENTS.md の free-only 記述
- 利用者向けコピーと privacy 説明 version
- 本設計による MVP 設計書 §11 / §18 の追記または置換パッチ（同一 PR か後続 PR でよいが、矛盾した free-only 文面を残さない）

### 8.2 変更しない

- generation ledger / HMAC / idempotency / RLS
- repair 1 回・timeout 後 repair 禁止
- 緊急献立への導線（モデル障害時）
- browser から OpenRouter を呼ばない境界

### 8.3 所有権

| 領域 | 所有者 |
|------|--------|
| モデル許可・検証スクリプト | サーバー/ツール |
| quota 定数 | サーバー + 契約/表示 |
| privacy コピー | 共有 contracts + UI |
| ベンチ証跡 | 運用/設計ゲート（リポジトリに生シークレットを置かない） |

## 9. テスト計画

1. **単体**: 新 parse 規則（有料 OK、`:free` NG、auto NG、重複 NG、単価超過 NG、mock 例外 OK）。
2. **verify スクリプト**: フィクスチャ Models API で structured/pricing を検証。
3. **既存生成テスト**: mock 経路の回帰（形状・quota 数値更新に伴う期待値）。
4. **E2E**: mock のまま成功/失敗/timeout 文言。有料実 API は opt-in スモークのみ（現行方針踏襲、キーがあるとき 1 回）。
5. **手動ゲート**: §4.4 の 5 候補ベンチ表を issue または内部メモに残す（API キーは載せない）。

## 10. リスクと緩和

| リスク | 緩和 |
|--------|------|
| 有料でも 20s 内に構造化が通らない | 完了ゲートで不合格なら ship しない。時間予算緩和は別設計 |
| 単価改定で昨日まで合法の ID が拒否 | デプロイ検証で fail-closed。運用で ID 差し替え |
| キー limit で本番全体停止 | キー limit は必須だが、GLOBAL 20 と監視で早期検知 |
| free 時代の UI 文言「混み合い」が実態とずれる | 本設計の主目的外。必要なら別 UX 設計で `model_unavailable` の細分化を検討 |
| プライバシー再同意の離脱 | 既存 continuation フローを流用し、説明を平易な日本語に保つ |

## 11. 検証サマリ（本設計の根拠）

### 11.1 free 実測（キー利用可だった範囲）

- free 一覧は少数。structured 付きでも **速度または形状**がアプリ制約と衝突。
- `generation_timeout` は成功回数非消費。attempt は送信済みなら消費され得る（現行意味論）。

### 11.2 有料実測

- 未完了（OpenRouter key total limit exceeded）。
- 単価と structured フラグは Models API の一覧から取得済み。レイテンシ/形状は **実装完了のブロッカー**として残す。

## 12. Key Decisions

1. **品質・速度を第一目的**とし、free のみ方針を廃止する。
   根拠: free では 20s 予算とスキーマ適合を両立できない実測。
2. **本番は有料 allowlist のみ**（方式 A）。free/有料ハイブリッドは採用しない。
   根拠: フォールバックが free の遅延・不正 JSON を再導入するため。
3. **`:free` 必須規則を廃止**し、auto 禁止・structured 必須・**単価 ≤ $0.50/1M** を検証する。
   根拠: 低価格帯に閉じつつ誤って高額モデルを env に載せない。
4. **クォータを 3 / 6 / 20 に引き下げ**、短期窓と時間予算は据え置き。
   根拠: ユーザー選択。アプリ USD 計算なしで露出を抑える。
5. **候補 5 ID を評価対象とし、順序は有料実測後に確定**する。
   根拠: ユーザー指定リスト。未実測のまま primary をコード固定しない。
6. **mock のみ `:free` mock ID を許可**する。
   根拠: CI/E2E の決定論性と外部無料枠非消費を維持。
7. **プライバシー説明を更新し version を上げる**。
   根拠: 送信先が有料提供者を含み得るため。

## 13. Open Questions

1. **有料キーの total limit 解除後のベンチ日程**
   - 担当: 運営者
   - ゲート: §4.4 不合格なら実装完了不可
2. **primary / repair の最終 1–2 ID**
   - ベンチ後に env 例と README を更新
3. **MVP 本文の改訂パッチを同一 Plan に含めるか、設計追記コミットを先行させるか**
   - 推奨: 本設計を正とし、実装 Plan の Task 0 で MVP §11/§18 を矛盾なく更新

## 14. PR Plan

### PR1: 設計と仕様の固定

- 本ファイルを main に取り込む。
- `2026-07-11-kondate-mvp-design.md` の §11.1 / §18 を本設計に合わせて改訂（free-only 削除、有料 allowlist・新クォータへの参照）。
- 依存: なし。

### PR2: モデル契約・検証スクリプト・env パーサ

- `parseOpenRouterModels` / preflight / verify-openrouter-models / openrouter runtime ガード。
- mock 例外。
- 単価上限・structured リモート検証。
- テスト更新。
- 依存: PR1。

### PR3: クォータ定数と UI/API 表示

- releaseQuota 3/6/20。
- usage 表示・関連コピー・テスト期待値。
- 依存: PR2（env と同時でも可だがレビュー分割を推奨）。

### PR4: プライバシー説明 version 更新

- 説明文・version・再同意経路のテスト。
- 依存: PR1。PR2/3 と並列可。

### PR5: 有料ベンチ証跡と本番 env 例

- キーにクレジットを載せた後、§4.4 ベンチを実行。
- README の推奨 `OPENROUTER_MODELS` を合格 ID に更新。
- 依存: PR2。**ship の最終ゲート**。

各 PR は単独で review 可能とし、PR5 のゲート不合格なら本番有効化しない。

## 15. 実装への引き渡し

承認後の次ステップは SuperPowers `writing-plans` により
`docs/superpowers/plans/2026-07-26-paid-openrouter-models.md`（名称は実装時に確定）を起こすこと。

Plan は少なくとも次を Task 化すること:

1. MVP 設計書の矛盾解消
2. モデル契約 RED/GREEN
3. quota 定数 RED/GREEN
4. privacy version
5. 有料ベンチゲート（手動/スクリプト）と README

実装セッションは **1 Task ずつ**、既存 CLAUDE.md / SubAgents フローに従う。
