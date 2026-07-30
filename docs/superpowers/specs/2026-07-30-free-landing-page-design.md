# こんだて日和 無料訴求ランディングページ（ログイン前 LP）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-30-free-landing-page-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Draft for user review**（ブレインストーム合意済み。実装計画は未作成） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`、Stripe/Free マトリクス `2026-07-29-paid-plan-stripe-design.md`（Free 機能の正本）、Plus LP `2026-07-30-plus-landing-page-design.md`（**対比・非混同**）、認証 `/login`・`RequireSession`・`RootEntryPage` |
| 人間合意 | 入口 = 未ログインの `/`；Plus は前面に出さない；中心機能 = 家族 / 献立 / 冷蔵庫；構成 A（ヒーロー+3カード+締め CTA）；トーン = アプリ既存 terracotta 継承 |

---

## Overview

未ログインの新規ユーザーが最初に見る画面が現状 **`/login` のみ**で、無料プランでできること（家族の年齢・アレルギー・苦手、予算・調理時間つき献立、冷蔵庫・食材リスト）が伝わらない。本設計は **未ログイン時の `/` を無料訴求マーケ LP** にし、モダンで画像多め・女性目線の UI で価値を伝えたうえで **`/login` へ誘導**する。

方針（人間合意）:

1. **入口**: 未ログインのトップ **`/`** が LP。ログイン済みの `/` は現状どおり `RootEntryPage`
2. **Plus 非前面**: 無料の価値だけ。比較表・価格・「Plus を見る」は置かない
3. **構成 A**: ヒーロー + **3 機能カード**（家族・献立・冷蔵庫）+ 締め CTA
4. **トーン**: 既存アプリ / Plus LP と同系の terracotta・warm cream。新カラー体系は持ち込まない。余白・丸み・平易日本語で女性目線を出す
5. **画像**: 生成イラスト 4 枚（ヒーロー 1 + カード 3）、同一オリジン静的 webp

課金・枠・アレルギー安全の正本は既存設計のまま。本設計は **未認証マーケ表示とルート分岐** のみ。

---

## Background & Motivation

| 領域 | 現状 | 痛み |
|------|------|------|
| 初回訪問 | 保護ルート → `/login`。価値説明なし | 「何のアプリか」がログイン前に伝わらない |
| ログイン画面 | 認証 UI 中心 | 家族・冷蔵庫などの無料強みが見えない |
| Plus LP `/plus` | 認証後・有料訴求 | 新規獲得用の無料 LP ではない |
| Free 機能 | アプリ内では充実 | マーケ面で未露出 |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | ルートは **未ログイン時の `/`**。専用 `/start` は作らない。`/login` は認証専用のまま残す |
| L2 | ログイン済み `/` は **`RootEntryPage` の契約を変更しない**（onboarding_status → welcome / planner） |
| L3 | 主 CTA は **「無料ではじめる」→ `/login`**。`returnTo` を付けない（既存どおり未指定時は `/welcome` 向き） |
| L4 | 副リンク「ログイン」も **`/login`**（同一でよい） |
| L5 | 中心カードは **家族 / 献立（予算・時間・好み）/ 冷蔵庫** の 3 枚のみ。履歴・買い物・緊急は本 LP のメインに載せない |
| L6 | **Plus・価格・トライアル・比較表は出さない** |
| L7 | 1 日成功 3 回などの **枠数字は前面に出さない**（「無料で使える」程度の定性表現のみ） |
| L8 | アレルギーについて **「安全」「絶対大丈夫」等の保証表現は禁止**（既存 safety 方針） |
| L9 | ビジュアルは **アプリ既存トーン継承**。ピンク／ラベンダー新体系は禁止 |
| L10 | イラスト 4 枚。同一オリジンのみ。個人情報・実在人物の特定描写なし。装飾画像の `alt` は空（Plus LP と同様） |
| L11 | LP は **AppShell / 下タブなし**（`/login` と同型の独立ページ） |
| L12 | 未ログインが `/planner` 等の保護ルートへ来た場合は **従来どおり** `/login?returnTo=…`。LP へ強制リダイレクトしない |

---

## Spec supersede（本設計が正になる箇所）

| 文書・実装 | 本設計 |
|------------|--------|
| `router.tsx` で `/` が `RequireSession` 子のみ | **`/` は公開ルート**。ゲートコンポーネントが auth を見て LP または `RootEntryPage` |
| 未ログインが `/` を開くと `RequireSession` → `/login` | **未ログイン `/` → 無料 LP**（ログイン強制しない） |
| 初回訪問の「顔」が `/login` のみ | **初回の顔は無料 LP**。ログインは CTA から |

**維持するもの**

- `/login` の Google / マジックリンク契約、`returnTo` sanitize、エラー state
- `RequireSession` の保護ルート挙動（`returnTo` 付き `/login`）
- ログイン済み `/` の `RootEntryPage` 振り分けロジック
- Plus LP `/plus`（認証後・有料。本 LP と混同しない）
- Free 機能のサーバ強制・枠・RLS・safety カタログ
- 本番デプロイ禁止 / push 禁止のプロジェクト制約

---

## Goals & Non-Goals

### Goals

- 未ログインの新規が **30 秒以内**に「家族に合わせて無料で献立を決められるアプリ」と理解できる
- 主行動 **「無料ではじめる」** で `/login` に到達できる
- モバイル 320px・44×44・横スクロールなし・日本語平易
- ログイン済みユーザーの既存導線を壊さない
- Plus LP のパターン（カード LP・静的 webp・専用 CSS）を踏襲しつつ **課金依存なし**

### Non-Goals

- Plus 訴求・Checkout・entitlement 分岐
- SEO 専用 SSR / OGP 専用インフラ（Vite SPA のまま。必要なら後続）
- 実スクリーンショット掲載（個人情報・環境差のためイラストのみ）
- 履歴・買い物・緊急・チラシをメインカード化
- 枠数字・attempt・短時間の利用者向け説明
- `/login` の UI 全面リデザイン（LP からの導線のみ）
- 本番デプロイ / `git push`

---

## Proposed Design

### ルーティング

```text
Public (no RequireSession):
  /login              → LoginPage（変更なし）
  /auth/callback      → AuthCallbackPage（変更なし）
  /                   → RootGatePage（本設計で新設）
                          ├ auth loading        → 短い確認メッセージ
                          ├ unauthenticated     → FreeLandingPage
                          └ authenticated       → RootEntryPage（既存）

RequireSession:
  /welcome, /planner, /pantry, ...  （/ をここから外す）
  /plus など
```

#### `RootGatePage`（名前は実装で固定してよい）

- 置き場: `src/features/auth/root-gate-page.tsx`（認証境界）または `src/features/landing/root-gate-page.tsx` + auth 利用
- **推奨**: `src/features/landing/root-gate-page.tsx` が `useAuth` を見て分岐。`RootEntryPage` は auth 配下のまま import
- `auth.status === "loading"`: `/login` や `RequireSession` と同トーンの「ログイン状態を確認しています…」
- `unauthenticated` または `session === null`: **`FreeLandingPage`**
- それ以外: **`RootEntryPage`**（既存。session 前提の profile クエリはそのまま）

#### 保護ルートとの関係

| アクセス | 結果 |
|----------|------|
| 未ログイン `/` | Free LP |
| 未ログイン `/planner` | `/login?returnTo=%2Fplanner`（従来） |
| ログイン済み `/` | `RootEntryPage` |
| ログイン済みが LP を見たい | 本スコープ外（非目標）。必要なら後続で `/about` 等 |

### 機能配置（ownership）

| 単位 | パス | 役割 |
|------|------|------|
| `FreeLandingPage` | `src/features/landing/free-landing-page.tsx` | マーケ UI |
| スタイル | `src/features/landing/free-landing-page.css` | LP 専用（グローバル破壊禁止） |
| コピー定数 | 同 TSX 内 export または `free-landing-copy.ts` | テスト exact 用 |
| アセット | `src/features/landing/assets/*.webp` | hero + 3 cards |
| ルート登録 | `src/app/router.tsx` | `/` を public + RootGate |
| ゲート | `src/features/landing/root-gate-page.tsx` | auth 分岐 |

**依存方向**

- `landing` → `auth`（`useAuth` のみ。gateway / continuation 非接触）
- `landing` ↛ `billing` / `features` のサーバ API / entitlement
- `router` → `landing` + 既存 `RootEntryPage`

Plus LP の `billing` 配下には置かない（課金機能ではない）。

### 画面レイアウト

モバイル 320 優先。1 カラム。主要操作 44×44。

```text
┌─────────────────────────────┐
│  こんだて日和（ロゴ/ワード） │
│  [ヒーロー画像]             │
│  今日の献立、家族に合わせて。│
│  （リード 1〜2 行）         │
│  [ 無料ではじめる ]         │
│  ログイン                   │
│                             │
│  ┌ カード: 家族          ┐ │
│  │ 画像 + 年齢・アレル…  │ │
│  └───────────────────────┘ │
│  ┌ カード: 献立          ┐ │
│  │ 画像 + 予算・時間…    │ │
│  └───────────────────────┘ │
│  ┌ カード: 冷蔵庫        ┐ │
│  │ 画像 + 食材リスト…    │ │
│  └───────────────────────┘ │
│                             │
│  短い締めコピー             │
│  [ 無料ではじめる ]         │
│  すでにアカウントがある方は │
│  ログイン                   │
└─────────────────────────────┘
```

- sticky CTA は任意。入れる場合は本文を隠さない余白のみ（下タブなしなので AppShell 考慮は不要）
- 戻るボタンは **不要**（未ログインの入口ページ。Plus LP の「戻る」契約は適用しない）

### コピー骨子（実装で一字句固定してよい）

| ブロック | 方向（案。実装時に定数化） | 禁止 |
|----------|---------------------------|------|
| ブランド | こんだて日和 | |
| h1 | 今日の献立、家族に合わせて。 | |
| リード | 無料で、家族の好みや食材に寄り添った献立づくり。 | 「AI が完璧に」「安全保証」 |
| 主 CTA | 無料ではじめる | 「今すぐ課金」「Plus」 |
| 副リンク | ログイン | |
| 家族カード見出し | 家族の好みを覚えられる | 「アレルギーでも絶対安心」 |
| 家族本文 | 年齢・苦手なもの・アレルギーを登録して、献立づくりに活かせます | 安全保証 |
| 献立カード見出し | 予算と時間に合わせて作成 | 枠回数の数字 |
| 献立本文 | 今日の予算や調理時間を指定して、一食の献立を作れます | attempt 語 |
| 冷蔵庫見出し | 冷蔵庫の食材から考える | |
| 冷蔵庫本文 | 食材リストを登録して、使い切りやすい献立につなげます | |
| 締め | まずは無料ではじめられます | Plus 誘導 |

文言の最終固定は実装 Task で定数 + unit テスト。上記は意味ロックであり、微調整は plan 内で可（L5–L8 を破らない範囲）。

### ビジュアル

| 項目 | 方針 |
|------|------|
| 色 | 既存 terracotta / cream / テキスト色。Plus LP CSS を参考に **landing 専用クラス** |
| カード | 丸み・薄い影または border。1 カラム縦積み |
| 画像 | やわらかいキッチン／食卓／家族の気配のイラスト（実在人物の特定なし） |
| タイポ | 既存本文サイズ帯。h1 はやや大きめだがモバイルで折り返し可 |
| 動き | 必須なし。過剰アニメ禁止 |

### データフロー

- **API 呼び出しなし**（entitlement / profile / generate 非接触）
- `useAuth` の status / session の有無のみ（ゲート）
- リンクは React Router `Link` または `navigate` で `/login`

### エラー・エッジ

| 状況 | 挙動 |
|------|------|
| auth loading | 短い確認 UI。LP を flash させない（ログイン済みユーザーが LP を一瞬見るのを避ける） |
| session あり | 必ず `RootEntryPage`。LP を出さない |
| `/login` からのブラウザ戻る | 未ログインなら再び LP（自然） |
| JS 無効 | 既存 SPA と同じ限界（本スコープで SSR しない） |

### アクセシビリティ

- ページに **h1 は 1 つ**
- CTA は `button` 相当の見た目 + `Link`、`min-h-11`（44px）
- 装飾 webp は `alt=""` + 必要なら `aria-hidden`
- コントラストは既存トークン準拠
- 横スクロールなし（320 CSS px）

### テスト

| 層 | 内容 |
|----|------|
| Unit | `RootGatePage`: loading / unauth → LP 文言 / auth → RootEntry 側（モック） |
| Unit | `FreeLandingPage`: h1・3 カード見出し・主 CTA の `href`/`to` が `/login`・Plus 文字列が **無い** |
| Router | `/` が `RequireSession` の外にあること（`router.test.tsx` 更新） |
| 既存 | `root-entry-page` / login / protected-routes の契約を壊していないこと |
| E2E | 本設計の **必須ゲート外**（人間が明示するまで defer 可）。入れるなら「未ログインで `/` を開き CTA で login 見出しが見える」程度の 1 本 |

### 検証（実装時）

- 対象 Vitest + `typecheck` + `lint` + `format:check`（Docker `app`）
- E2E 全体はゲート後

---

## 対比: Plus LP との境界

| | 無料 LP（本設計） | Plus LP |
|--|------------------|---------|
| 経路 | 未ログイン `/` | 認証後 `/plus` |
| 目的 | 獲得・無料価値 | 有料変換 |
| Checkout | なし | あり |
| entitlement | なし | あり |
| 画像 | 4 枚（無料機能） | 4 枚（Plus メリット） |
| 戻る | なし | あり（planner 等） |

---

## 実装順序（計画フェーズで Task 化）

1. `RootGatePage` + router で `/` を public 化（RED/GREEN: 未ログインで LP 骨格、ログインで RootEntry）
2. `FreeLandingPage` コピー・3 カード・CTA（画像プレースホルダ可）
3. イラスト 4 枚生成・配置・CSS 仕上げ
4. a11y / 回帰（router・auth テスト更新）
5. （任意・ゲート）E2E 1 本

---

## Risks & Mitigations

| リスク | 緩和 |
|--------|------|
| ログイン済みユーザーが LP を一瞬見る | loading 中は LP を出さない |
| `/` を public にしたことでテスト前提が壊れる | `router.test` / `root-entry` / `protected-routes` を同時更新 |
| アレルギーコピーが安全保証に見える | L8 固定 + レビュー観点 |
| Plus と無料 LP の資産混同 | ディレクトリ `landing/` vs `billing/`、ファイル名 `free-landing-*` |
| イラストのトーン不一致 | Plus LP と同系プロンプト・既存色 |

---

## Open questions

なし（ブレインストームでロック済み）。実装中にコピー微調整のみ plan 内で可。

---

## Approval

| 項目 | 状態 |
|------|------|
| §1 ルーティング・認証 | 人間 OK |
| §2 画面・コピー・ビジュアル | 人間 OK |
| §3 実装境界・テスト・非目標 | 人間 OK |
| 本書ファイルの人間レビュー | **待ち**（この文書） |
| 実装計画 | 本書承認後に `writing-plans` |
