# ブラウザーエントリーポイント修復 設計

## 背景

Playwright MCP で `http://127.0.0.1:5173` を開くと、HTML のタイトルは取得できる一方、アクセシビリティスナップショットが空になる。ブラウザーコンソールには、Vite が `node:crypto` を外部化した後に `createHash` へアクセスしたエラーが記録される。

実行時の依存経路は次のとおり。

```text
src/main.tsx
  -> src/app/router.tsx
  -> src/features/emergency/emergency-menu-api.ts
  -> shared/emergency/filter-emergency-menus.ts
  -> shared/safety/validate-generated-menu.ts
  -> shared/safety/fingerprint.ts
  -> node:crypto
```

ブラウザー側が必要とする緊急献立レスポンスの Zod スキーマと、サーバー側だけで使う緊急献立フィルターが同じモジュールに置かれていることが根本原因である。ルーターの静的 import により、緊急献立画面を開いていない場合もサーバー専用依存がブラウザーバンドルへ混入し、アプリ全体の起動を妨げる。

## 目的

ブラウザーがサーバー専用コードを読み込まないモジュール境界を作り、既存の `/pantry` から `/login` へのフローと Playwright MCP のアクセシビリティスナップショット取得を復旧する。

## 採用方針

`shared/emergency/contracts.ts` を追加し、ブラウザーとサーバーが共有する Zod スキーマと推論型だけを配置する。

- ブラウザー側の API と画面は `@shared/emergency/contracts` から契約を import する。
- サーバー側のフィルターと Netlify Function も同じ契約を利用する。
- `filter-emergency-menus.ts` にはフィルタリング、fixture、安全検証などのサーバー処理だけを残す。
- 既存利用箇所への互換性が必要な型は、循環依存を生まない向きで再 export する。
- `fingerprint.ts` の同期 SHA-256、正規化、64桁16進表現は変更しない。
- ブラウザー用 crypto shim、新しい依存関係、遅延 import による症状回避は追加しない。

この方針は、契約を純粋な共有モジュールへ置く既存の `shared/contracts` パターンと一致する。サーバーの安全性に関わる指紋計算を弱めず、不要な処理をブラウザーへ配布しない。

## モジュール境界

`shared/emergency/contracts.ts` が import できるのは、Zod とブラウザー互換の純粋な共有契約だけとする。次の依存は禁止する。

- `filter-emergency-menus`
- `validate-generated-menu`
- `fingerprint`
- `node:*`
- Netlify または Supabase のサーバー専用クライアント

レスポンス契約は一か所だけを正本とし、ブラウザー側へ複製しない。これにより、サーバーが返すデータとブラウザーが検証するデータのずれを防ぐ。

## エラー処理と安全性

既存の Zod による fail-closed なレスポンス検証は維持する。契約分離後も、不完全な表示名、原材料表示確認との不一致、不正なIDなどは従来どおり拒否する。

安全条件の指紋はサーバー側の canonical JSON と SHA-256 を使い続ける。非暗号学的ハッシュや非同期 Web Crypto への置換は行わない。

## テスト

実装は RED、GREEN の順で確認する。

1. `shared/emergency/contracts.test.ts` を先に追加し、モジュールが存在しないため失敗することを確認する。
2. 完全な緊急献立レスポンスを新しい契約で parse できることを検証する。
3. 契約モジュールが禁止されたサーバー専用依存を import しないことを検証する。
4. 既存の `e2e/specs/foundation.spec.ts` を修正前に実行し、空画面と `node:crypto` エラーを RED として保存する。
5. 最小分離後、緊急献立関連の Vitest と同じ E2E を再実行し、見出しが表示されて `/login` へ遷移することを確認する。
6. Playwright MCP と新しい Codex セッションの両方でローカル画面のアクセシビリティスナップショットを取得し、外部URLが拒否されることを確認する。

## 変更範囲

変更対象は次に限定する。

- `shared/emergency/contracts.ts`
- `shared/emergency/contracts.test.ts`
- `shared/emergency/filter-emergency-menus.ts`
- 必要な既存テスト
- `src/features/emergency/emergency-menu-api.ts`
- `src/features/emergency/emergency-menu-page.tsx`
- `netlify/functions/emergency-menus.ts`
- `e2e/specs/foundation.spec.ts`
- Playwright MCP の実装計画と検証記録

DB、マイグレーション、指紋アルゴリズム、UI仕様、依存パッケージは変更しない。
