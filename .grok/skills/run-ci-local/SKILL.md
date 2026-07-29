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
- **実行順**: 下記ステップを上から順に。**最初の失敗でそのパスを止め**、修正サイクルへ入る
- **スキップ（GitHub 専用）**:
  - `actions/checkout`
  - 失敗時 artifact アップロード（この workflow には無いが、将来追加分も対象）
  - `Tear down and remove ephemeral secrets`（`docker compose down --volumes` と `rm -f .env`）— ローカル開発環境を壊さない
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
4. 修正方針を短く述べてから着手する

### 2. 修正してよいもの / いけないもの

**修正してよい（コード・設定の欠陥）**

- lint / format / typecheck の違反
- テスト失敗の原因となる実装バグ、壊れた import、明らかな回帰
- 実行に必要なローカル前提の不足で、リポジトリ内の手順で直せるもの（例: provision の再実行、スタックの再 up）
- `db:types` 後の生成型差分で、**スキーマ変更に対応した正当な型更新**であることが明らかな場合（生成コマンド結果を採用）

**修正してはいけない（または即ユーザー確認）**

- テスト・lint ルールの無効化、アサーション削除、`eslint-disable` の安易な追加で「通すだけ」の対応
- 設計書・ロック契約・quota・origin・RLS・機密の緩和や仕様変更
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

- 修正が**前のステップの成果物に影響**する場合（例: 共有型・compose・env 契約）は、影響を受ける最初のステップからやり直す
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

## 実行ステップ（この順・このコマンド）

各ステップの前に短いラベルを報告する（例: `[3/17] docker compose config`）。番号はスキップを除いたローカル用。

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

```bash
docker compose run --rm --no-deps app node --test tests/tooling/compose.test.mjs tests/tooling/local-development-scripts.test.mjs tests/tooling/project-config.test.mjs tools/e2e-function-server.test.mjs scripts/assert-privacy-logs.test.mjs scripts/verify-release-evidence.test.mjs scripts/verify-openrouter-models.test.mjs scripts/benchmark-paid-openrouter-models.test.mjs scripts/provision-maintenance-role.test.mjs scripts/csp-headers.test.mjs scripts/emit-deploy-headers.test.mjs scripts/preflight-production.test.mjs scripts/smoke-production.test.mjs scripts/verify-production-deploy.test.mjs scripts/verify-browser-secrets.test.mjs scripts/verify-acceptance-matrix.test.mjs
```

（workflow のファイル列挙と同一。欠落・追加があれば **ci.yml を正**として合わせる）

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

環境変数を workflow と同じく付与する:

- `LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free`
- `KONDATE_ASSERT_PRIVACY_LOGS=1`
- `PLAYWRIGHT_DISABLE_TRACE=1`

```bash
LOCAL_MOCK_MODELS=mock/kondate-primary:free,mock/kondate-repair:free KONDATE_ASSERT_PRIVACY_LOGS=1 PLAYWRIGHT_DISABLE_TRACE=1 ./scripts/run-e2e.sh
```

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

- **成功（修正なし）**: 全ステップ PASS。実行一覧を簡潔に
- **成功（修正あり）**: 全ステップ PASS + 各 fix cycle で直した内容・変更ファイル・再実行起点
- **打ち切り**: 失敗ステップ、試行回数、実施した修正、未解決理由、ユーザーへの判断依頼
- いずれの場合もスタックは落さない（ローカル継続利用を優先）
- 自動コミットしない

## 注意

- ログが巨大なときはファイルにリダイレクトし、失敗行・末尾だけを読む（トークン節約）。全 suite の生ログを会話に貼らない
- workflow と skill のコマンドが食い違ったら **ci.yml を優先**し、skill 更新を提案する
- タイムアウト: 単一ステップが極端に長い場合は状況を報告し、ユーザーに継続可否を確認してよい（CI の job は 90 分）
- 「通すため」の仕様緩和より、**正しい修正**を優先する。迷ったら止めて聞く
