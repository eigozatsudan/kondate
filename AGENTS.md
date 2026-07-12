# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React/Vite application, providers, styles, and browser tests.
- `shared/contracts/` holds domain and HTTP contracts shared by the client and server.
- `netlify/functions/` contains serverless API handlers; keep secrets and provider calls server-side.
- `supabase/migrations/`, `supabase/seed.sql`, and `supabase/tests/database/` define and test the database.
- `tools/` contains local OAuth/OpenRouter mocks and their tests; `tests/tooling/` tests project tooling.
- `e2e/specs/` is reserved for Playwright browser tests, while `docs/` stores design and implementation notes.

## Build, Test, and Development Commands

Use Node 24 (`engines` in `package.json`) and install dependencies with `npm ci`.

- `npm run dev` starts the Vite development server.
- `npm run build` runs TypeScript project checks and creates the production Vite build.
- `npm run lint`, `npm run format:check`, and `npm run typecheck` validate style, formatting, and types.
- `npm test` runs Vitest in watch mode; use `npx vitest run` for a one-shot CI-style run.
- `npm run e2e` runs Playwright tests against the configured local app.
- `docker compose up -d --wait` starts the local application/Supabase stack; `npm run db:reset` recreates it and `npm run db:test` runs pgTAP database tests.

## Coding Style & Naming Conventions

Use 2-space indentation, double quotes, semicolons, and Prettier formatting. Prefer strict, explicit TypeScript; avoid `any` and unsafe casts. Use `PascalCase` for React components/types, `camelCase` for variables/functions, and descriptive `*.test.ts`/`*.test.tsx` names. Use the configured `@/` and `@shared/` aliases where appropriate.

コード内のコメントは必ず日本語で書き、あとから人間がレビューしやすいように、背景・意図・制約を簡潔かつ具体的に説明する。コードから明らかな処理の説明や、古くなりやすい実装の逐語的な説明は避ける。

## Testing Guidelines

Add focused Vitest/React Testing Library tests beside the code they cover. Use Playwright for user flows and pgTAP for schema/RLS behavior. Run `npx vitest run`, `npm run e2e`, and relevant database tests before submitting changes; keep tests deterministic and update coverage-sensitive behavior when it changes.

## Commit & Pull Request Guidelines

コミットメッセージは必ず日本語で書き、Conventional Commits形式（例: `feat: 献立生成を追加`、`fix: 認証状態の復元を修正`、`chore: 開発設定を整理`）にする。件名は短く、変更内容が分かる表現にする。Pull Requestには変更内容、実行した検証コマンド、関連Issueや設計資料を記載し、UI変更にはスクリーンショットを添付する。データベースマイグレーション、環境変数、セキュリティへの影響、ローカルスタックの変更は明記する。

## Security & Configuration Tips

Never commit secrets or generated local credentials. Keep OpenRouter and service secrets in server-side environment variables; only publish the intended Supabase client configuration. Treat migrations and RLS policies as production-sensitive, and use the local Docker stack to validate schema changes.
