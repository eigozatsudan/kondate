---
name: run-ci-local
description: >
  .github/workflows/ci.yml と同じ検証パイプラインをローカルで順番に実行し、
  失敗したら原因を修正してから再実行する（失敗→修正→再実行サイクル）。
  GitHub 専用ステップ（checkout、失敗時 artifact、CI 用一時 .env の always 削除）はスキップする。
  /run-ci-local 実行時、または「ローカル CI」「CI をローカルで」「ci.yml と同じ」
  「GitHub Actions 相当」「フル CI をローカルで回す」と言われたときに使う。
---

# run-ci-local

`.github/workflows/ci.yml` の `verify` ジョブと同等の検証を、リポジトリルートでローカル実行する。
失敗時は自動で修正し、通過するまで（または打ち切り条件まで）再実行する。

## 方針

- **正本**: `.github/workflows/ci.yml`（手順・コマンド文字列を変えない。workflow が更新されたらこの skill も追従する）
- **補助正本（ローカル集約）**: `scripts/ci.sh` はゲート順の固定用。**食い違うときは ci.yml を優先**し、skill と ci.sh の差分は報告する（例: `ci.sh` だけが追加している tooling ファイル）
- **実行順**: 下記ステップを上から順に。**最初の失敗でそのパスを止め**、修正サイクルへ入る
- **スキップ（GitHub 専用）**:
  - `actions/checkout`
  - 失敗時 artifact アップロード（Playwright HTML / trace は載せない方針のまま）
  - `Tear down and remove ephemeral secrets`（`docker compose down --volumes` と `rm -f .env`）— ローカル開発環境を壊さない
- **GHA との意図的差分（ローカル）**:
  - GHA は `env.CI: "true"`。本 skill は**既定で `CI` を立てない**（`run-e2e.sh` が auth/app を restore し、作業ツリーを開発継続可能に保つ）
  - GHA の E2E は PR=`smoke` / push main=`full`。ローカル既定は **full**（`ci.sh` と同じ）。短縮するときだけ `KONDATE_E2E_SUITE=smoke`
  - **`CI=true` と `KONDATE_E2E_SKIP_RECREATE=1` の同時指定は禁止**（`run-e2e.sh` が exit 2）。本 skill でも併用しない
- **失敗時の切り分け**（修正前に推奨）: CI の `Show container health on failure` 相当
  ```bash
  docker compose ps -a
  docker compose logs --no-color --tail 80 supavisor || true
  docker compose logs --no-color --tail 80 app || true
  ```
- **コマンド連結禁止**: `AGENTS.md` に従い、Docker / ホストコマンドを `&&` や `;` で連結しない。**1 コマンド = 1 ツール呼び出し**
- **作業ディレクトリ**: リポジトリルート（`compose.yaml` がある場所）
- **破壊的操作**: ユーザーが明示しない限り、`.env` 削除・`docker compose down --volumes`・force push 等は行わない
- **コミット**: この skill では自動コミットしない（ユーザー依頼時のみ）

## 失敗 → 修正 → 再実行サイクル

パイプライン失敗時は報告だけで終わらせず、次を繰り返す。

```
実行 → 失敗 → 診断 → 修正（可能な場合）→ 再実行 → …
```

### 1. 診断

1. 失敗ステップ番号・名前・コマンド・終了コードを記録する
2. ログから**根本原因**を特定する（最初の error / FAIL 行を優先）
3. インフラ系（compose / health / provision）なら container health を取る
4. E2E 失敗時は次も見る（案 B 以降）:
   - full は **setup → mobile-chromium \|\| desktop-chromium 並列**（`run_playwright_mobile_desktop_parallel`）
   - 成果物は `test-results/{mobile,desktop}-chromium` と `playwright-report/{mobile,desktop}-chromium`（既定パスと混同しない）
   - 生成密集の timeout は AI 共有枠の**単一行ロック** residual の可能性（製品 limit を触らない）
5. 修正方針を短く述べてから着手する

### 2. 修正してよいもの / いけないもの

**修正してよい（コード・設定の欠陥）**

- lint / format / typecheck の違反
- テスト失敗の原因となる実装バグ、壊れた import、明らかな回帰
- 実行に必要なローカル前提の不足で、リポジトリ内の手順で直せるもの（例: provision の再実行、スタックの再 up）
- `db:types` 後の生成型差分で、**スキーマ変更に対応した正当な型更新**であることが明らかな場合（生成コマンド結果を採用）

**修正してはいけない（または即ユーザー確認）**

- テスト・lint ルールの無効化、アサーション削除、`eslint-disable` の安易な追加で「通すだけ」の対応
- 設計書・ロック契約・quota・origin・RLS・機密の緩和や仕様変更
  - 例: 製品 `compose.yaml` の `GLOBAL_DAILY_AI_LIMIT=20` 変更、E2E 専用 500 の製品面への持ち込み、per-test global AI truncate の復活、`workers` の調査なし CI 分岐
- 無関係ファイルの大規模リファクタ
- 依存関係の追加・削除・ダウングレード（ユーザー確認なし）
- シークレットのコミット、`.env` の削除・上書き生成（既存 `.env` がある場合）
- 原因不明のままの推測パッチ
- 同じ失敗が修正後も再現し、打ち切り条件に達した場合

原因が仕様判断・環境権限・外部サービス・ユーザーの意図的 WIP のときは、**修正せず停止して報告**する。

### 3. 再実行の範囲

| 失敗ステップ                              | 再実行の起点                                            |
| ----------------------------------------- | ------------------------------------------------------- |
| 1–6（env / compose / health / provision） | 失敗ステップから 19 まで                                |
| 7–14、16–19（テスト・監査・ビルド）       | **失敗したステップから** 19 まで                        |
| 15（db:types）                            | 型の正当更新後、15 の `git diff` から続行。不正なら停止 |
| 16（E2E）                                 | スタックが壊れていなければ 16 から。auth/app 異常なら 4 から |

- 修正が**前のステップの成果物に影響**する場合（例: 共有型・compose・env 契約・`run-e2e.sh` / Playwright config）は、影響を受ける最初のステップからやり直す
- 1 サイクルで直したあと、**残りの全ステップを最後まで通す**（途中成功だけで「CI 完了」としない）
- フルパスを最初からやり直す必要はないが、スタックを壊した修正をしたら 4 からやり直す

### 4. 打ち切り条件

次のいずれかでサイクルを止め、ユーザーに状況を渡す。

- **修正サイクル上限: 3 回**（失敗パス起算。3 回直しても同じ or 別箇所で止まりフル通過しない）
- 修正不可カテゴリに該当
- 修正方針が複数あり仕様判断が必要
- 同一エラーが修正後も変化なし（パッチが効いていない）

打ち切り時の報告に含めるもの: 失敗ステップ、試した修正の要約、残差分の有無、次にユーザーが決めるべきこと。

### 5. サイクル中の進捗表示

各周回で短く明示する。

- `cycle N/3: failed at step K (name) → fixing: …`
- `cycle N/3: re-running from step K`
- 最終: `local CI green after N fix cycle(s)` または `stopped after N cycles: …`

## 前提

1. Docker / Docker Compose が使えること
2. `.env` が無い場合のみ `./scripts/generate-local-secrets.sh` を実行する（既存 `.env` は上書きしない）
3. 既存スタックがあっても、CI 同様 `docker compose up -d --wait --wait-timeout 600` で揃える
4. E2E full は壁時計が長い（案 B で project 並列化済みでも setup + max(mobile, desktop) + 生成行ロック residual）。**step 16 は特に長い**想定で timeout を余裕をもって取る（GHA job 上限 90 分）

## 実行ステップ（この順・このコマンド）

各ステップの前に短いラベルを報告する（例: `[3/19] docker compose config`）。番号はスキップを除いたローカル用。

### 1. シークレット（`.env` が無いときだけ）

```bash
./scripts/generate-local-secrets.sh
```

### 2. 正規ローカル continuation origin の確認

```bash
set -a; . ./.env; set +a
test "$SERVER_SITE_ORIGIN" = "http://127.0.0.1:5173"
test "$VITE_AUTH_PROVIDER_MODE" = "oauth_mock"
test "$VITE_OAUTH_MOCK_ORIGIN" = "http://127.0.0.1:8788"
```

※ シェルでまとめてよいのはこの assert ブロックのみ（workflow と同じ heredoc 相当）。失敗時はどの変数が不一致かを報告。

### 3. Compose 設定

```bash
docker compose config --quiet
```

### 4. スタック起動（healthy 待ち）

```bash
docker compose up -d --wait --wait-timeout 600
```

### 5. oauth-mock ヘルス

```bash
curl --fail --silent --show-error http://127.0.0.1:8788/health
```

### 6. メンテナンス用 least-privilege ログイン

```bash
./scripts/provision-maintenance-role.sh
```

### 7. Local-safe Node script unit tests

Node 24 は directory 引数をモジュールとして解決するため、**明示 `.mjs` 列挙**（workflow と同一。欠落・追加があれば **ci.yml を正**として合わせる）。

```bash
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs tests/tooling/local-development-scripts.test.mjs tests/tooling/project-config.test.mjs tests/tooling/e2e-smoke-tags.test.mjs tests/tooling/e2e-ai-quota-parallel.test.mjs tools/e2e-function-server.test.mjs scripts/assert-privacy-logs.test.mjs scripts/verify-release-evidence.test.mjs scripts/verify-openrouter-models.test.mjs scripts/benchmark-paid-openrouter-models.test.mjs scripts/provision-maintenance-role.test.mjs scripts/csp-headers.test.mjs scripts/emit-deploy-headers.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs scripts/verify-acceptance-matrix.test.mjs
```

**列挙に含める E2E 関連 tooling（退行防止）**

| ファイル | 役割 |
| --- | --- |
| `tests/tooling/e2e-smoke-tags.test.mjs` | `@smoke` / `@mobile-only` 静的ガード |
| `tests/tooling/e2e-ai-quota-parallel.test.mjs` | per-test global AI truncate 禁止 + `workers: 2` + suite 開始 reset / parallel 関数 |
| `tests/tooling/local-development-scripts.test.mjs` | `run-e2e.sh` シーケンス（案 B: dual body signal・mobile 優先 exit 含む） |
| `tests/tooling/compose.test.mjs` | suite 分岐・parallel 関数・成果物 env pin 等 |

※ `scripts/ci.sh` が `eslint-primitive-rule.test.mjs` を追加している場合がある。**GHA 同等を厳密に再現するときは ci.yml 列挙のみ**。ローカルで ci.sh 完全一致が必要ならその 1 ファイルを追加してよいが、食い違いは報告する。

### 8. format:check

```bash
docker compose run --rm --no-deps app npm run format:check
```

### 9. lint

```bash
docker compose run --rm --no-deps app npm run lint
```

### 10. typecheck

```bash
docker compose run --rm --no-deps app npm run typecheck
```

### 11. Maintenance unit tests

```bash
docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/maintenance-env.test.ts netlify/functions/_shared/maintenance-db.test.ts netlify/functions/_tests/maintenance-cleanup.test.ts
```

### 12. 全 Vitest

```bash
docker compose run --rm --no-deps app npx vitest run
```

### 13. Maintenance DB integration

```bash
docker compose run --rm app npm run test:maintenance-db:integration
```

### 14. pgTAP (db-test)

```bash
docker compose --profile test run --rm db-test
```

### 15. 生成 DB 型の検証

```bash
docker compose run --rm app npm run db:types
```

```bash
git diff --exit-code -- src/shared/types/database.generated.ts
```

（2 コマンドに分ける。スキーマに対応した正当な差分なら生成結果を採用してから `git diff --exit-code` を再確認。意図不明なら修正サイクルに入れず停止）

### 16. E2E + プライバシーログ検証

環境変数を workflow / `ci.sh` と同じく付与する:

| 変数 | 値 | 意味 |
| --- | --- | --- |
| `LOCAL_MOCK_MODELS` | `mock/kondate-primary:free,mock/kondate-repair:free` | E2E は mock 経路に閉じる |
| `KONDATE_ASSERT_PRIVACY_LOGS` | `1` | Function ログの privacy assert |
| `PLAYWRIGHT_DISABLE_TRACE` | `1` | trace/video 無効（DOM・通信を残さない） |
| `KONDATE_E2E_SUITE` | 未設定 or `full`（既定）/ `smoke` | 下記スイート選択 |

**スイート選択（ローカル）**

| 目的 | 指定 | 実行モデル（`run-e2e.sh`） |
| --- | --- | --- |
| GHA push / release 相当（**skill 既定**） | 未設定 or `KONDATE_E2E_SUITE=full` | `setup` 1 回 → **mobile \|\| desktop 並列**（案 B）。AI 共有枠 reset は **suite 開始 1 回**のみ（中間 reset なし）。E2E 上限は `compose.e2e.yaml` の `GLOBAL_DAILY_AI_LIMIT=500` |
| GHA PR 相当（短縮） | `KONDATE_E2E_SUITE=smoke` | setup 省略（現状）→ **mobile のみ** + `--grep=@smoke`。desktop 段なし |
| 開発反復（任意・CI 禁止） | `KONDATE_E2E_SKIP_RECREATE=1` | 開始時 force-recreate 省略。**`CI=true` と併用不可** |

**既定コマンド（full）**

```bash
LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free KONDATE_ASSERT_PRIVACY_LOGS=1 PLAYWRIGHT_DISABLE_TRACE=1 ./scripts/run-e2e.sh
```

**smoke（PR 相当に寄せるとき）**

```bash
LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free KONDATE_ASSERT_PRIVACY_LOGS=1 PLAYWRIGHT_DISABLE_TRACE=1 KONDATE_E2E_SUITE=smoke ./scripts/run-e2e.sh
```

**E2E 失敗時の読み方（案 B）**

- ログに mobile / desktop の Playwright 出力が**交錯**し得る（2 process の list reporter）
- HTML / test-results は project 別に分かれる（`test-results/mobile-chromium` 等）。単一 `test-results/` だけを見ない
- `serial` は **process 内**のみ。生成密集は process 間でも AI 行ロックで待ち得る
- wrapper 多重は `.run-e2e.lock` で拒否。1 wrapper 内の mobile\|\|desktop は想定内
- ホストに `KONDATE_E2E_OUTPUT_DIR` / `KONDATE_E2E_HTML_REPORT` を export したままにしない（setup / 単 project の成果物パスがずれる）

**ログ節約**: full の生ログはファイルへリダイレクトし、`passed` / `failed` / 終了コードと失敗タイトルだけを会話に載せる。

### 17. npm audit（production、high 以上）

```bash
docker compose run --rm --no-deps app npm audit --omit=dev --audit-level=high
```

### 18. Browser build + 秘密スキャン

```bash
docker compose run --rm --no-deps app sh -c 'npm run build && npm run verify:browser-secrets -- --require-dist'
```

（この 1 ステップ内の `sh -c '… && …'` は workflow 通り。ホスト側でさらに `&&` 連結しない）

### 19. Netlify offline build + 秘密スキャン

```bash
docker compose run --rm --no-deps app sh -c 'npm exec --offline netlify -- build --offline --context deploy-preview && npm run verify:browser-secrets -- --require-dist'
```

## 完了報告

- **成功（修正なし）**: 全ステップ PASS。実行一覧を簡潔に（E2E が full か smoke かを明記）
- **成功（修正あり）**: 全ステップ PASS + 各 fix cycle で直した内容・変更ファイル・再実行起点
- **打ち切り**: 失敗ステップ、試行回数、実施した修正、未解決理由、ユーザーへの判断依頼
- いずれの場合もスタックは落さない（ローカル継続利用を優先）
- 自動コミットしない

## 注意

- ログが巨大なときはファイルにリダイレクトし、失敗行・末尾だけを読む（トークン節約）。全 suite の生ログを会話に貼らない
- workflow と skill のコマンドが食い違ったら **ci.yml を優先**し、skill をこのファイルで更新する
- `scripts/ci.sh` と `ci.yml` の tooling 列挙差があれば、skill は yml に合わせたうえで差分を 1 行報告する
- タイムアウト: 単一ステップが極端に長い場合（特に step 16 full E2E）は状況を報告し、ユーザーに継続可否を確認してよい（CI の job は 90 分）
- 「通すため」の仕様緩和より、**正しい修正**を優先する。迷ったら止めて聞く
- E2E を「速くする」ために製品 quota・RLS・workers 定数・中間 AI truncate を戻すことはしない
