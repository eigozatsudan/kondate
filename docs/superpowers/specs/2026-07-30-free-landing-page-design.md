# こんだて日和 無料訴求ランディングページ（ログイン前 LP）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-30-free-landing-page-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Review-ready**（1次・2次・敵対的レビュー反映済み。実装計画は未作成） |
| 関連 | MVP `2026-07-11-kondate-mvp-design.md`、Stripe/Free マトリクス `2026-07-29-paid-plan-stripe-design.md`（Free 機能の正本）、Plus LP `2026-07-30-plus-landing-page-design.md`（**対比・非混同**）、認証 `/login`・`RequireSession`・`RootEntryPage`・`AuthProvider` |
| 人間合意 | 入口 = 未ログインの `/`；Plus は前面に出さない；中心機能 = 家族 / 献立 / 冷蔵庫；構成 A（ヒーロー+3カード+締め CTA）；トーン = アプリ既存 terracotta 継承 |
| レビュー | R1: 1次 / 2次 / 敵対的（本ファイル §Revision Summary R1） |

---

## Overview

未ログインの新規ユーザーが最初に見る画面が現状 **`/login` 中心**で、無料プランでできること（家族の年齢・アレルギー・苦手、予算・調理時間つき献立、冷蔵庫・食材リスト）が伝わらない。本設計は **未ログイン時の `/` を無料訴求マーケ LP** にし、モダンで画像多め・女性目線の UI で価値を伝えたうえで **`/login` へ誘導**する。

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
| 初回訪問 | 多くの導線が保護ルート → `/login`。`/` も `RequireSession` 配下でログインへ | 「何のアプリか」がログイン前に伝わらない |
| ログイン画面 | 認証 UI 中心 | 家族・冷蔵庫などの無料強みが見えない |
| Plus LP `/plus` | 認証後・有料訴求 | 新規獲得用の無料 LP ではない |
| Free 機能 | アプリ内では充実 | マーケ面で未露出 |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | ルートは **未ログイン時の `/`**。専用 `/start` は作らない。`/login` は認証専用のまま残す |
| L2 | ログイン済み `/` は **`RootEntryPage` の契約を変更しない**（onboarding_status → welcome / planner） |
| L3 | 主 CTA は **「無料ではじめる」→ `/login`**。`returnTo` を付けない（既存どおり未指定時は `/welcome` 向き） |
| L4 | 副リンク「ログイン」も **`/login`**（同一でよい。`returnTo` なし） |
| L5 | 中心カードは **家族 / 献立（予算・時間・好み）/ 冷蔵庫** の 3 枚のみ（表示順この順）。履歴・買い物・緊急は本 LP のメインに載せない |
| L6 | **Plus・価格・トライアル・比較表は出さない** |
| L7 | 1 日成功 3 回などの **枠数字は前面に出さない**（「無料で使える」程度の定性表現のみ）。**「無制限」「何回でも」も禁止**（無料＝無制限の誤読防止） |
| L8 | アレルギー・食事安全について **「安全」「絶対」「保証」「安心です」等の保証・断定表現は禁止**（既存 safety 方針）。LP 全文（定数）にこれらの語を置かないことを unit で固定する |
| L9 | ビジュアルは **アプリ既存トーン継承**。ピンク／ラベンダー新体系は禁止 |
| L10 | イラスト 4 枚。同一オリジンのみ。個人情報・実在人物の特定描写なし。装飾画像の `alt` は空（Plus LP と同様） |
| L11 | LP は **AppShell / 下タブなし**（`/login` と同型の独立ページ） |
| L12 | 未ログインが `/planner` 等の保護ルートへ来た場合は **従来どおり** `/login?returnTo=…`。LP へ強制リダイレクトしない |
| L13 | **RootGate の置き場は 1 箇所に固定**: `src/features/landing/root-gate-page.tsx` のみ（`auth/` に二重実装しない） |
| L14 | RootGate の分岐は **下表 State matrix のみ**。`RootEntryPage` は **authenticated かつ session ≠ null のときだけ**描画（fail-closed） |
| L15 | sticky 下部 CTA は **採用しない**（ヒーロー CTA + 締め CTA の 2 箇所で足りる） |
| L16 | ログアウト後の着地は現状維持 **`/login?signedOut=1`**（アカウント削除も `/login?…`）。LP へは切り替えない |
| L17 | ブランド表示「こんだて日和」は **h1 にしない**。ページ唯一の h1 はヒーロー見出し |

---

## Spec supersede（本設計が正になる箇所）

| 文書・実装 | 本設計 |
|------------|--------|
| `router.tsx` で `/` が `RequireSession` 子のみ | **`/` は公開ルート**。`RootGatePage` が auth を見て LP または `RootEntryPage` |
| 未ログインが `/` を開くと `RequireSession` → `/login` | **未ログイン `/` → 無料 LP**（ログイン強制しない） |
| 初回訪問の「顔」が `/login` のみ | **未ログインで `/` を開いたときの顔は無料 LP**。ログインは CTA から |
| `router.test.tsx` の「`/` は RequireSession 配下」 | **`/` は RequireSession 配下にない**。祖先に `RequireSession` を含まないこと、および `RootGatePage`（またはその lazy 解決先）が登録されていることを正とする |

**維持するもの**

- `/login` の Google / マジックリンク契約、`returnTo` sanitize、エラー state、**認証済み時の `Navigate` to returnTo**
- `RequireSession` の保護ルート挙動（`returnTo` 付き `/login`）
- ログイン済み `/` の `RootEntryPage` 振り分けロジック（profile / onboarding_status）
- Plus LP `/plus`（認証後・有料。本 LP と混同しない）
- Free 機能のサーバ強制・枠・RLS・safety カタログ
- サインアウト / アカウント削除後の **`/login?signedOut=1` 等**（L16）
- E2E `authenticatedPage` がログイン後に `goto("/")` して `/welcome` を期待する流れ（**ログイン済み**のため RootEntry 継続で両立）
- 本番デプロイ禁止 / push 禁止のプロジェクト制約

---

## Goals & Non-Goals

### Goals

- 未ログインの新規がスクロールなし〜短いスクロールで「家族に合わせて無料で献立を決められるアプリ」と把握できる
- 主行動 **「無料ではじめる」** で `/login` に到達できる
- モバイル 320px・44×44・横スクロールなし・日本語平易
- ログイン済みユーザーの既存導線（`/` → RootEntry、保護ルート、logout → login）を壊さない
- Plus LP のパターン（カード LP・静的 webp・専用 CSS）を踏襲しつつ **課金・entitlement 依存なし**

### Non-Goals

- Plus 訴求・Checkout・entitlement 分岐
- SEO 専用 SSR / ルート別 `document.title` / OGP 専用インフラ（グローバル title「こんだて日和」のまま。必要なら後続）
- 実スクリーンショット掲載（個人情報・環境差のためイラストのみ）
- 履歴・買い物・緊急・チラシをメインカード化
- 枠数字・attempt・短時間の利用者向け説明
- `/login` の UI 全面リデザイン（LP からの導線のみ）
- ログアウト後着地を LP に変更すること
- 本番デプロイ / `git push`

---

## Proposed Design

### ルーティング

```text
Public (no RequireSession):
  /login              → LoginPage（変更なし）
  /auth/callback      → AuthCallbackPage（変更なし）
  /                   → RootGatePage（本設計で新設・公開）
                          └ 下表 State matrix

RequireSession:
  /welcome, /planner, /pantry, /plus, ...
  （`/` はここから外す）
```

### RootGate State matrix（L14・唯一の分岐）

`useAuth()` の `status` と `session` を使う。**上から最初に当てはまった行だけ**。

| 優先 | 条件 | 表示 |
|------|------|------|
| 1 | `status === "loading"` | `RequireSession` と同文: **「ログイン状態を確認しています…」** を `main.page-frame` 内。**FreeLanding も RootEntry も出さない**（ログイン済みユーザーへの LP flash 防止） |
| 2 | `status === "unauthenticated"` **または** `session === null` | **`FreeLandingPage` のみ** |
| 3 | それ以外（`status === "authenticated"` かつ `session !== null`） | **`RootEntryPage` のみ**（既存。profile クエリ契約は変更しない） |

禁止:

- loading 中に LP を出す（authenticated 復帰時のチラつき・誤解）
- `session === null` のまま `RootEntryPage` を出す（TQ `enabled: false` で「状態を確認しています…」に張り付く／誤分岐のリスク）
- `status` だけ見て session を無視する
- entitlement / profile API をゲートで呼ぶ

### `RootGatePage` 置き場と import（L13）

| 項目 | ロック |
|------|--------|
| パス | **`src/features/landing/root-gate-page.tsx` のみ** |
| 依存 | `useAuth`（`@/features/auth/use-auth`）、`RootEntryPage`（`@/features/auth/root-entry-page`）、`FreeLandingPage`（同 feature 内） |
| 禁止 | `auth/` への二重 RootGate、`billing/*` import、generate / pantry / household API 呼び出し |

`router.tsx` は `/` を public 配列側に置き、`element: <RootGatePage />` または薄い lazy で `RootGatePage` を載せる。  
**推奨バンドル**: `FreeLandingPage` は `React.lazy` / 動的 `import()` で Gate 内または route lazy により **別 chunk**（ログイン済みユーザーが毎回マーケ画像を落とさない）。`RootEntryPage` は現状どおり同期 import でも可（既存バンドル前提を大きく変えない）。

### 保護ルート・認証まわりとの関係

| アクセス | 結果 |
|----------|------|
| 未ログイン `/` | Free LP |
| 未ログイン `/planner` 等 | `/login?returnTo=…`（従来。**LP へは送らない** L12） |
| ログイン済み `/` | RootEntry → welcome / planner |
| ログイン済み `/login` | 既存どおり `Navigate` to returnTo（未指定なら `/welcome`） |
| ログイン後 `returnTo=/`（sanitize 許可済み） | `/` → RootGate → RootEntry（LP は出ない） |
| ログアウト | `/login?signedOut=1`（L16。LP ではない） |
| continuation 完了後 `returnTo=/` | 既存 `navigateTo` → `/` → RootEntry |

### 機能配置（ownership）

| 単位 | パス | 役割 |
|------|------|------|
| `RootGatePage` | `src/features/landing/root-gate-page.tsx` | auth 分岐のみ |
| `FreeLandingPage` | `src/features/landing/free-landing-page.tsx` | マーケ UI |
| スタイル | `src/features/landing/free-landing-page.css` | LP 専用プレフィックス（例: `.free-landing`）。グローバル破壊禁止 |
| コピー定数 | `free-landing-page.tsx` 内 export、または `free-landing-copy.ts` | テスト exact 用 |
| アセット | 下表の 4 ファイル名 | hero + 3 cards |
| ルート登録 | `src/app/router.tsx` | `/` を public + RootGate |
| テスト | `root-gate-page.test.tsx` / `free-landing-page.test.tsx` / `router.test.tsx` 更新 | 下記 Testing |

**依存方向**

```text
router → landing (RootGate) → auth (useAuth, RootEntryPage)
                            → free-landing-page (+ css, assets)

FreeLandingPage ↛ billing, pantry, household API, generate, entitlement
RootGate        ↛ billing, pantry, household API, generate, entitlement
```

（`RootEntryPage` 内部が household を触るのは既存どおり。Gate は「描画するかどうか」だけ。）

Plus LP の `billing/` 配下には置かない。

### 画面レイアウト

モバイル 320 優先。1 カラム。主要操作 44×44。**sticky CTA なし（L15）**。

```text
┌─────────────────────────────┐
│  こんだて日和（p/span。非 h1）│
│  [ヒーロー画像]             │
│  h1: 今日の献立、家族に合わせて。│
│  リード                     │
│  [ 無料ではじめる ] → /login│
│  ログイン → /login         │
│                             │
│  ┌ 1 家族                ┐ │
│  │ 画像 + コピー         │ │
│  └───────────────────────┘ │
│  ┌ 2 献立                ┐ │
│  │ 画像 + コピー         │ │
│  └───────────────────────┘ │
│  ┌ 3 冷蔵庫              ┐ │
│  │ 画像 + コピー         │ │
│  └───────────────────────┘ │
│                             │
│  締めコピー                 │
│  [ 無料ではじめる ] → /login│
│  すでにアカウントがある方は │
│  ログイン → /login         │
└─────────────────────────────┘
```

- 戻るボタンは **不要**（未ログインの入口。Plus LP の戻る契約は適用しない）
- 主 CTA は `Link`（`to="/login"`）または同等。**クエリを付けない**

### コピー骨子（意味ロック。実装で定数 + exact テスト）

| キー（実装定数名は英語 export 可） | 方向 | 禁止・注意 |
|----------------------------------|------|------------|
| ブランド | こんだて日和 | h1 にしない（L17） |
| h1 | 今日の献立、家族に合わせて。 | ページ唯一の h1 |
| リード | 無料で、家族の好みや食材に寄り添った献立づくり。 | 「AI が完璧」「安全保証」 |
| 主 CTA | 無料ではじめる | Plus / 課金語 |
| 副リンク | ログイン | |
| 家族見出し | 家族の好みを登録できる | 「絶対安心」系（L8） |
| 家族本文 | 年齢・苦手なもの・アレルギーを登録して、献立の条件に使えます | 保証語禁止。**「活かして安全に」等にしない** |
| 献立見出し | 予算と時間に合わせて作成 | 枠回数の数字 |
| 献立本文 | 今日の予算や調理時間を指定して、一食の献立を作れます | attempt 語 |
| 冷蔵庫見出し | 冷蔵庫の食材から考える | アプリ内ラベル「食材リスト」と矛盾する機能主張はしない（同一機能の通俗名として「冷蔵庫」は可） |
| 冷蔵庫本文 | 食材リストを登録して、使い切りやすい献立につなげます | |
| 締め | まずは無料ではじめられます | Plus 誘導 |

- 文言の字句微調整は plan 内で可。**L5–L8・L17 と「Plus 文字列ゼロ」は破らない**
- unit: LP レンダー結果のテキストに `Plus` / `plus` / `安全` / `絶対` / `保証` が **含まれない**（英字 Plus ブランド混入防止。`plus` は CSS クラス名を textContent に出さないこと）

### 画像（L10）

| 枚 | 用途 | ファイル（パス固定） |
|----|------|----------------------|
| 1 | ヒーロー | `src/features/landing/assets/free-hero.webp` |
| 2 | 家族カード | `src/features/landing/assets/free-benefit-family.webp` |
| 3 | 献立カード | `src/features/landing/assets/free-benefit-menu.webp` |
| 4 | 冷蔵庫カード | `src/features/landing/assets/free-benefit-pantry.webp` |

制約（Plus LP と同型）:

- 同一オリジンのみ（外部 CDN 禁止）
- 目安 **各 ≤ 150KB**、WebP、幅 100% + aspect-ratio で CLS 抑制
- 装飾: `alt=""`、必要なら `aria-hidden`
- トーン: 温かいキッチン／食卓。terracotta / cream と衝突しない。実在人物の特定・読める個人情報・アレルギー表示の断定を描かない
- 生成は実装フェーズ。差し替え可だが **パスと枚数はロック**

### ビジュアル

| 項目 | 方針 |
|------|------|
| 色 | 既存 terracotta / cream / テキスト。**landing 専用クラス**（`.free-landing…`） |
| カード | 丸み・薄い影または border。1 カラム縦積み |
| タイポ | 既存本文サイズ帯。h1 はやや大きめ、320px で折り返し可 |
| 動き | 必須なし。過剰アニメ禁止 |

### データフロー

```text
未ログイン訪問 /
  → RootGate loading 待ち
  → FreeLandingPage（API なし）
  → CTA Link /login
  → LoginPage（既存）
  → 成功後 returnTo 未指定 → /welcome（既存）

ログイン済み訪問 /
  → RootGate
  → RootEntryPage（既存 profile 分岐）
```

### エラー・エッジ

| 状況 | 挙動 |
|------|------|
| auth loading | matrix 行 1。LP / RootEntry なし |
| session なし | matrix 行 2。LP のみ |
| session あり | matrix 行 3。RootEntry のみ |
| `/login` からブラウザ戻る | 未ログインなら再び LP |
| getSession 一時 error（AuthProvider B-I6） | 直前 session 維持 → ゲートは session に追随。新規ロジック不要 |
| JS 無効 | 既存 SPA と同じ限界（SSR しない） |

### アクセシビリティ

- **h1 は 1 つ**（L17）
- CTA は見た目 primary/secondary + `Link`、`min-h-11`（44px）
- 装飾 webp は `alt=""`
- コントラストは既存トークン準拠
- 横スクロールなし（320 CSS px）
- カードリストは `ul`/`li` または見出し階層で機械可読に（Plus LP のカードリストと同程度）

### テスト

| 層 | 内容 |
|----|------|
| Unit `RootGatePage` | loading → 確認文のみ・LP 文言なし；unauth / session null → LP の h1；authenticated+session → RootEntry 側（モック子または既知テキスト） |
| Unit `FreeLandingPage` | h1・3 カード順（家族→献立→冷蔵庫）・主 CTA `to`/`href` = `/login`・副リンクも `/login`・**Plus / 安全 / 絶対 / 保証 が text に無い** |
| Router | **`/` の祖先に `RequireSession` が無い**；`/planner` 等は従来どおり `RequireSession` 配下；`/login` は public のまま |
| 回帰 | `root-entry-page` / `login-page` / `protected-routes` の既存契約を壊していないこと |
| E2E | 本設計の **必須ゲート外**（人間が明示するまで defer 可）。入れるなら「未ログインで `/` → 無料ではじめる → login の見出し」1 本。**既存 `authenticatedPage` の `goto("/")` → welcome はログイン済みのため維持される想定**を計画に明記 |

### 検証（実装時）

- 対象 Vitest + `typecheck` + `lint` + `format:check`（Docker `app`）
- E2E 全体はゲート後（人間指示）

---

## 対比: Plus LP との境界

| | 無料 LP（本設計） | Plus LP |
|--|------------------|---------|
| 経路 | 未ログイン `/` | 認証後 `/plus` |
| 目的 | 獲得・無料価値 | 有料変換 |
| Checkout / entitlement | なし | あり |
| 画像 | 4 枚（`free-*.webp`） | 4 枚（`plus-*.webp`） |
| 戻る | なし | あり |
| シェル | なし | AppShell 子 |

---

## 実装順序（計画フェーズで Task 化）

1. `RootGatePage` + router で `/` を public 化（RED: router 祖先・Gate matrix / GREEN）
2. `FreeLandingPage` コピー・3 カード・CTA（画像は後続でもプレースホルダ可だがパスは最終形へ）
3. イラスト 4 枚生成・配置・CSS 仕上げ（sticky なし）
4. a11y / 禁止語 / 回帰（router・auth テスト更新）
5. （任意・ゲート）E2E 1 本

---

## Risks & Mitigations

| リスク | 緩和 |
|--------|------|
| ログイン済みが LP を一瞬見る | matrix 行 1: loading 中 LP 禁止 |
| session なしで RootEntry | matrix 行 2: session null → LP。RootEntry 禁止 |
| `/` public 化で router テスト破綻 | supersede 表どおり assertion 更新を必須 |
| アレルギーコピーが保証に見える | L8 + 禁止語 unit + 家族本文を「条件に使う」トーンに固定 |
| Plus / 無料資産混同 | `landing/` vs `billing/`、ファイル名 `free-*` |
| マーケ chunk が全ユーザーに載る | FreeLanding を別 chunk（推奨） |
| E2E 誤修正 | 未ログイン LP とログイン済み `/` を混同しない（fixtures コメント更新可） |

---

## Open questions

なし（ブレインストーム + R1 レビューでロック済み）。実装中のコピー微調整のみ plan 内で可（ロック違反は不可）。

---

## Approval

| 項目 | 状態 |
|------|------|
| §1 ルーティング・認証 | 人間 OK |
| §2 画面・コピー・ビジュアル | 人間 OK |
| §3 実装境界・テスト・非目標 | 人間 OK |
| R1 レビュー反映 | **済**（下記） |
| 本書の人間最終確認 | **待ち** |
| 実装計画 | 人間最終確認後に `writing-plans` |

---

## Revision Summary R1（1次・2次・敵対的）

実施: 設計全文 + `router.tsx` / `RequireSession` / `AuthProvider` / `RootEntryPage` / `login-page` / `sanitizeReturnPath` / E2E `authenticatedPage` / Plus LP 設計との境界を突合。

### 1次レビュー（仕様整合・実装曖昧さ）

| ID | 深刻度 | 指摘 | 処置 |
|----|--------|------|------|
| P1 | Important | RootGate 置き場が auth / landing の両論 → 二重実装リスク | **L13** で `landing/root-gate-page.tsx` のみに固定 |
| P2 | Important | 分岐が「unauthenticated or session null / else」と雑で session 無し RootEntry があり得る | **L14 + State matrix** で fail-closed を表形式ロック |
| P3 | Important | `router.test` の「`/` は RequireSession 配下」が obsolete と明示不足 | **Spec supersede** に新 assertion を明記 |
| P4 | Important | 依存「landing ↛ features」が RootEntry 経由と矛盾し得る | **依存方向図**で FreeLanding/Gate の禁止と RootEntry 内既存依存を分離 |
| P5 | Minor | sticky CTA「任意」で実装ブレ | **L15 不採用** |
| P6 | Minor | ブランドと h1 の二重見出しリスク | **L17** |
| P7 | Minor | 画像パス・CLS・サイズ未ロック | Plus 同型の **画像表**を追加 |
| P8 | Minor | 状態「Draft」のまま | **Review-ready** へ |

### 2次検証（1次の深掘り・実行時）

| ID | 判定 | 内容 | 処置 |
|----|------|------|------|
| S1 | CONFIRMED | TQ `enabled:false` 時に session 無し RootEntry がハングし得る | matrix で RootEntry 条件を厳格化（P2 と同一修正） |
| S2 | CONFIRMED | loading 文言を Login の「読み込み中…」と混同し得る | Gate は **RequireSession と同文**に固定 |
| S3 | CONFIRMED | E2E `goto("/")` は **ログイン後**なので RootEntry 維持で両立 | 維持表 + Testing に明記。誤って fixture を LP 期待に変えない |
| S4 | CONFIRMED | logout は `/login?signedOut=1` のままが正しい（LP にすると削除後メッセージが消える） | **L16** |
| S5 | PARTIAL | 「30 秒以内」は検証不能 | Goals を定性表現へ緩和 |
| S6 | CONFIRMED | `returnTo=/` は sanitize 許可済み → ログイン後 RootEntry で LP に戻らない | 関係表に追記 |
| S7 | CONFIRMED | FreeLanding を同期 import すると画像が全 session に載りやすい | 別 chunk 推奨をロック |

### 敵対的レビュー（濫用・誤認・境界）

| ID | 深刻度 | 指摘 | 処置 |
|----|--------|------|------|
| A1 | Important | 「アレルギーを…活かせます」が安全保証に読める | 家族本文を **「献立の条件に使えます」** に変更 + **L8 禁止語 unit** |
| A2 | Important | 保護ルートを LP に吸う実装が「親切」と誤って入り得る | **L12** 再強調 + 関係表 |
| A3 | Important | Gate バグで未ログイン RootEntry → 奇妙なエラー UI / 情報リーク懸念 | fail-closed matrix（P2） |
| A4 | Minor | 外部リンク・OGP なしでもフィッシング面は同一 origin CTA のみで十分 | 変更なし（非問題） |
| A5 | Minor | 枠を隠すと「完全無料無制限」誤読 | L7 の「無料で使える」定性 + 枠数字禁止を維持（無制限表現もコピー禁止に含む: 「何回でも」「無制限」を出さない） |

**擬陽性（修正しない）**

- 「SSR/OGP が無いとマーケ不可」→ Non-Goal。SPA 制約は既存。
- 「ログアウト後は LP にすべき」→ 削除・ログアウト通知が `/login` 前提（L16）。
- 「Plus をフッターに出せ」→ 人間合意で無料前面のみ（L6）。
- 「専用 `/start` の方がきれい」→ 人間が `/` を選択済み（L1）。

### 再レビュー（R1 反映後の自己チェック）

| 観点 | 結果 |
|------|------|
| プレースホルダ / TBD | なし |
| RootGate 二重定義 | L13 で解消 |
| session null × RootEntry | matrix で禁止 |
| router テスト supersede | 明記 |
| 安全コピー | L8 + 本文変更 + unit |
| Plus 境界 | 対比表・依存禁止で明確 |
| E2E / logout 回帰 | 維持表 + L16 |
| 内部矛盾 | 再読で重大な矛盾なし |

**残課題（実装計画へ）**: Task 分割、exact コピー定数名の最終決定、画像生成、任意 E2E 1 本のゲート判断。設計ロックの追加変更は不要。
