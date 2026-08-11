# docs — エージェント向け索引

このディレクトリの**運用ドキュメントだけ**を通常の正本として読む。  
実装済み MVP では **コードと契約が仕様の正**であり、過去の設計書・実装計画・レビュー記録は既定では読まない。

## 権威の優先順位（上ほど強い）

1. **実装** — `src/`、`netlify/functions/`、`shared/`、`supabase/migrations/`、`e2e/`、関連テスト
2. **ルートのエージェント指示** — `AGENTS.md`、`CLAUDE.md`、`SubAgents.md`
3. **この docs の運用文書**（下表）
4. **`docs/archive/`** — 配送履歴・敵対的レビュー・ゲート証跡。**既定では開かない**。  
   履歴調査や「なぜこうなったか」の考古学だけに使う。実装と食い違う場合は **実装を正**とする。

新しい機能や仕様変更の計画を人間が明示した場合に限り、そのセッション用に渡された plan/spec を読む。  
`docs/archive/superpowers/` を「現行スコープの正本」として再解釈・簡略化・部分採用しない。

## 通常読むもの（運用）

| 目的 | パス |
| --- | --- |
| ローカル開発・検証・Supabase refresh（E2E smoke/full） | [local-development.md](./local-development.md) |
| 運用管理コンソール（ローカル専用・閲覧のみ） | [admin/README.md](../admin/README.md)（詳細）。要約は [local-development.md](./local-development.md#運用管理コンソールローカル専用閲覧のみ) |
| 本番デプロイ（CLI 初回〜更新） | [deployment/README.md](./deployment/README.md) |
| Netlify / env / CSP / preflight | [deployment/netlify.md](./deployment/netlify.md) |
| Managed Supabase / Auth / migrate | [deployment/supabase.md](./deployment/supabase.md) |
| OpenRouter 有料 allowlist・ベンチ | [runbooks/openrouter.md](./runbooks/openrouter.md) |
| Stripe / Plus reconcile | [runbooks/billing-reconcile.md](./runbooks/billing-reconcile.md) |
| アカウント削除 | [runbooks/account-deletion.md](./runbooks/account-deletion.md) |
| リリースゲート | [testing/release-checklist.md](./testing/release-checklist.md) |
| 受け入れマトリクス | [testing/acceptance-matrix.md](./testing/acceptance-matrix.md) |
| DB アクセスマトリクス | [testing/database-access-matrix.md](./testing/database-access-matrix.md) |
| Google OAuth ステージング | [testing/google-oauth-staging.md](./testing/google-oauth-staging.md) |

製品概要・ローカル起動の要約はリポジトリ直下の [README.md](../README.md) を参照する。

## 読まないもの（既定）

| パス | 内容 |
| --- | --- |
| [archive/](./archive/) 全体 | 完了済み Plan/Spec、敵対的レビュー、bugfix 証跡 |
| `archive/superpowers/plans/` | 配送用 Task 計画（完了済みを含む） |
| `archive/superpowers/specs/` | 当時の設計書（実装と差分がある場合は実装優先） |
| `archive/reviews/` | 一次・二次・敵対的レビュー記録 |
| `archive/bugfix/` | ゲート証跡・モデル snapshot・closeout メモ |

正確な数値（quota、TTL、origin、モデル allowlist、予算 ms 等）は **コード上の契約**を見る:

- `shared/contracts/`（枠・budget・API 形）
- `shared/safety/`（安全カタログ・検証）
- `netlify/functions/_shared/` と各 Function
- `scripts/preflight-production.mjs` 等の運用検証

## 新しい設計・計画を書くとき

人間が新規 feature の design/plan を依頼した場合:

- 作業中の draft は `.superpowers/sdd/`（gitignored）か、人間が指定したパスに置く
- マージ後に履歴として残す必要があるものだけ `docs/archive/` 配下へ移す
- 運用手順が変わったら **この README の表にある運用文書**を更新する（archive だけに書かない）
