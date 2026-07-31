# こんだて日和 Plus ランディングページ（LP）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/archive/superpowers/specs/2026-07-30-plus-landing-page-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Approved for implementation**（実装計画あり。2026-07-30 設計+計画の通常/敵対的再レビュー反映済み） |
| 関連 | Plus / Stripe `2026-07-29-paid-plan-stripe-design.md`（L3 価格・L10 ファネル・A3 kill）、設定 UI `PlanSettingsSection`、CTA `plus-cta.tsx` / flyer locked / flyer upsell、Checkout `billing-checkout.ts` |
| レビュー | M1–M5；R-A1〜；R-B1〜；**R-C1〜**（戻る referrer・note sibling・SURFACES_CLOSED_COPY 等） |

---

## Overview

Free ユーザーが「Plus を見る」を押したとき、現状は `/settings` のプラン節へ直接飛び、**価格と Checkout はあるがメリットの訴求が薄い**。本設計は専用ルート **`/plus`** にカード型 LP を置き、Plus でできること・メリット・金額をオシャレかつ平易に示し、その場から Stripe Checkout へ進める。

方針（人間合意）:

1. **アプローチ B**: ヒーロー + 3 メリットカード + Free 比較 + 価格 / Checkout（縦長マーケ一枚・Welcome スライドではない）
2. **Checkout は LP 上**（設定のプラン節も残す）
3. **生成イラスト**（ヒーロー 1 + カード 3）を同一オリジン静的アセットとして配置
4. **`BILLING_ENABLED=false` でも `/plus` を開く**（メリット・価格は見せる。Checkout は無効）

課金の正本・枠・品質・チラシのサーバ強制は **Stripe 設計のまま**。本設計は **表示と導線** のみを拡張する。

---

## Background & Motivation

| 領域 | 現状 | 痛み |
|------|------|------|
| 硬上限 CTA | `PlusHardLimitCta` → `href="/settings"` | 設定の一覧の中に埋もれ、Plus の価値が伝わらない |
| チラシ locked / 週間 upsell | 同様に `/settings` | 旗艦機能の文脈から離れる |
| 設定プラン節 | 価格・Checkout はある | メリット説明が 1 行程度。画像なし |
| kill switch | Checkout 閉 | それでも「何が Plus か」を知りたい導線が無い（本設計で LP は開く） |

### 人間と合意済みのロック（再導出禁止）

| # | 決定 |
|---|------|
| L1 | ルートは **`/plus`**。認証済み AppShell 子。下タブには載せない |
| L2 | UI は **カード型メリット LP**（ヒーロー・3 カード・比較・価格）。既存 terracotta / guided-planner トーンに合わせ、新カラー体系は持ち込まない |
| L3 | 「Plus を見る」ラベルは維持。着地を **`/plus`** に変更（`/settings` 直リンクをやめる） |
| L4 | Free かつ surfaces 開 かつ Checkout 可能状態: フル LP + Checkout。**surfaces 閉でも** 対象ユーザーには `/plus` フル LP（メリット・価格）を表示し Checkout のみ不可 |
| L5 | 価格表示は Stripe 設計 L3 固定: **月額 580 円（税込）/ 年額 5,800 円（税込・2か月分お得）**。数字を独自に変えない |
| L6 | 年額確認文・Stripe 遷移注記・「Plus をはじめる」は設定と **同一ソース**（複製禁止） |
| L7 | Checkout success 後の poll は **設定 `/settings?billing=success` の既存フローを維持** |
| L8 | cancel 後は **`/plus?billing=cancel`**（サーバ `cancel_url` を変更） |
| L9 | マーケ LP と管理短形を分ける。分岐は **State matrix** と **Checkout ブロック集合**に従う（下記） |
| L10 | トライアル宣伝は **初回限定トーン**。誰でも 7 日無料と断定しない |
| L11 | 生成イラスト 4 枚。同一オリジンのみ。アレルギー・個人情報・実在人物の特定描写なし |
| L12 | 比較表は **成功回数・品質モード・チラシ**のみ。attempt / 短時間枠の内部用語や第 2 残数は出さない（quota コピー簡素化と整合） |
| L13 | Checkout を出す前に、サーバが 409 にする状態を UI で先回りする（`CHECKOUT_BLOCKED_STATUSES`） |

---

## Spec supersede（本設計が正になる箇所）

| 文書・実装 | 本設計 |
|------------|--------|
| Stripe 設計 L10-1 着地「設定 or Checkout シート」 | **硬上限・チラシ locked・週間 upsell・品質ゲートの「Plus を見る」着地は `/plus`**。設定のプラン節は管理・Checkout 代替導線として残す |
| Stripe 設計 ファネル表 #1 / #4 | ボタンラベルは「Plus を見る」。**href/to = `/plus`**（#4 品質は本設計でリンク追加） |
| `plus-cta.tsx` / flyer CTA の `href="/settings"` | **`/plus`** |
| `billing-checkout.ts` の `cancel_url` → `/settings?billing=cancel` | **`/plus?billing=cancel`** |
| `success_url` → `/settings?billing=success` | **変更しない** |

**維持するもの**

- Stripe Checkout / Portal / Webhook 正本、entitlement 合成、A3 kill（Webhook 継続・枠 Free 強制・製品面閉）
- 価格 L3、trial 7 日・カード必須・`billing_trial_history` による再 trial 拒否
- `PlanSettingsSection` の設定内 Checkout / Portal（削除しない）
- Free 成功 3 等の枠数値（LP は説明のみ。比較表は `planQuota` 由来）
- soft 1 残コピー（L10-2）は押し売りリンクを増やさない（現状どおり文のみ）

---

## Goals & Non-Goals

### Goals

- Free ユーザーが Plus の **3 価値**（枠・品質モード・チラシ週間）と **価格** を 1 画面で理解できる
- その場で月額 / 年額を選び Checkout に進める（設定と同契約）
- kill 中でも価値説明ページとして `/plus` を開ける
- 既存 E2E / unit の「Plus を見る」ラベル契約を壊さない（href のみ更新）
- モバイル 320px・44×44・横スクロールなし・日本語平易
- Checkout がサーバで必ず失敗する状態で「Plus をはじめる」を見せない

### Non-Goals

- 価格・トライアル条件・Stripe Product の変更
- 複数有料ティア、IAP、従量
- trial 使用済みフラグの entitlement API 追加（サーバは既に trial を付けない。UI は初回限定トーンで吸収）
- success 後 poll の LP 移植
- 下タブへの Plus 追加
- Portal / 解約 UI の LP への完全移植（管理短形は最小 Portal または設定誘導）
- attempt / 短時間 / global 枠の利用者向け説明復活
- 本番デプロイ / push

---

## Proposed Design

### ルーティング

```text
AppShell children:
  ...既存...
  /plus  → PlusLandingPage（lazy 可）
```

- 親の認証ゲート配下（`/settings` と同様）。未ログインは既存どおりログインへ
- ユーザー ID は既存どおり `useAuth()`（または設定ページと同じ取得経路）。entitlement クエリは `useEntitlement(userId)`
- **シェル section（R-A2 確定）**:
  - `sectionForPath("/plus")` → **`"plus"`**（新規キー。`"settings"` に流用しない）
  - `sectionTitles.plus` = **`"Plus"`**（デスクトップ上部バー用。ページ h1 は LP 側「こんだて日和 Plus」）
  - 配色: settings と同系統のニュートラル chrome でよい（新色トークンは増やさない）
  - 下タブは path 不一致のためどれも `aria-current` にしない（意図どおり）
- **戻る（R-A3 + R-C1 確定）**:
  - ラベル「戻る」、`min-h-11`
  - **`history.length` は使わない**
  - 判定（どちらか満たせば `navigate(-1)`）:
    1. React Router の `location.key !== "default"`（SPA 内遷移）
    2. または `document.referrer` が **同一 origin**（生 `<a href="/plus">` のフルロード後でも、アプリ内から来ていれば -1 が使える）
  - どちらも満たさない（直打ち・外部・Stripe 以外の外部 referrer 等）→ **`navigate("/planner", { replace: true })`**
  - 根拠: Plus CTA の一部は Router 外 unit のため生 `a` のまま。フルロード後は常に `key === "default"` になるため、key 単独では「アプリ内から来た」を誤判定する

### 「Plus を見る」の更新箇所

| コンポーネント | 変更 |
|----------------|------|
| `PlusHardLimitCta` | `href` → `/plus`。コメントを「Checkout は LP / 設定」に更新 |
| `FlyerUpsellBanner` | 同上 |
| `FlyerWeeklyPanel` locked `Link` | `to="/plus"` |
| review 品質ロック hint（L10-4） | 「Plus を見る」→ `/plus` を **必須追加**（hint の近く。トグルは disabled のまま） |

生の `<a href>`（Router 外 unit 用）は既存方針を維持してよい。`Link` 化は任意で、必須ではない。

### Checkout ブロック集合（L13 / R-A1）

サーバ `billing-checkout.ts` が **409 `billing_already_entitled`** にする条件と UI を揃える。

```text
CHECKOUT_BLOCKED_STATUSES = { "trialing", "active", "past_due", "incomplete" }
```

（実装の `entitlement.status` 比較と同一集合。ここに無い `unpaid` / `paused` / `incomplete_expired` はサーバ list と合わせて残差 R5。）

**マーケ Checkout を出してよい**のは次をすべて満たすときのみ:

1. `plusEntitled === false`
2. `pastDueGrace === false`
3. `status` が `CHECKOUT_BLOCKED_STATUSES` に含まれない
4. `productSurfacesOpen === true`
5. entitlement 取得成功

`dbPlusEntitled` は現行 SQL では `plusEntitled` と同値のため、UI 分岐の主キーには **`plusEntitled` / `status` / `pastDueGrace`** を使う（サーバは `dbPlusEntitled` も見るがクライアント二重条件は不要）。

### State matrix（M1 / L9 / R-A1）

entitlement は `GET /api/billing/entitlement` のみ。クライアントはプランを主張しない。  
**上から最初に当てはまった行だけ**を使う。

| 優先 | 条件 | 表示 |
|------|------|------|
| 1 | loading かつ data なし | 「プラン情報を確認しています…」 |
| 2 | error かつ data なし | 「プラン情報を確認できませんでした。再読み込みしてください。」（設定と同トーン）。Checkout なし |
| 3 | `status === "past_due"` または `pastDueGrace === true` | **管理短形 A（支払い）**: `PAST_DUE_COPY`。surfaces 開 → Portal（`createPortalSession`）。閉 → 「設定へ」`/settings`。**マーケ・価格・Checkout なし** |
| 4 | `plusEntitled === true` | **管理短形 B（加入中）**: 「こんだて日和 Plus をご利用中です」相当 + 「設定へ」→ `/settings`。`status === "trialing"` なら `TRIAL_END_WARNING`（と trial 終了日があれば設定と同様）。**マーケ・Checkout なし** |
| 5 | `status === "incomplete"` | **管理短形 C（手続き中）**: 「お支払いの手続きが完了していません。設定から続きをご確認ください。」+ 「設定へ」。surfaces 開なら Portal も可。**マーケ・Checkout なし**（409 先回り） |
| 6 | 上記以外 + `productSurfacesOpen === true` | **フル LP** + Checkout 可 |
| 7 | 上記以外 + `productSurfacesOpen === false` | **フル LP**（メリット・価格は表示）+ Checkout **不可**（kill 表示） |

判定の禁止:

- `quotaPlan` だけで加入済みとしない（kill 中は entitled でも `quotaPlan === "free"`）
- `productSurfacesOpen` だけで加入済みとしない
- `plan === "plus"` 単独でマーケを隠す／出す（`plusEntitled` と status 系を正）
- `status === "incomplete"` なのにフル LP + Checkout（サーバ 409 と矛盾）

管理短形 B で kill（`productSurfacesOpen === false`）のとき: 契約中であることは出してよいが、**品質・チラシが今使えるとは書かない**。必要なら 1 行「一部機能は現在ご利用いただけません」程度（任意・推奨）。

### kill 中（surfaces 閉）の表示制約（M2）

フル LP 対象（matrix 6/7 の Free 系）に限り **開く**。ただし:

1. 価格ブロック先頭に設定と同文: **「お支払い管理は現在ご利用いただけません。」**
2. 「Plus をはじめる」は **disabled**（押下しても API 非呼び出し。必要なら同文を `role="alert"`）
3. ヒーローのトライアル煽り（「7日間無料でお試し」「今すぐ」等）は **surfaces 開のときだけ**。閉のときは中立（例: 「Plus でできること」）
4. 価格数字の表示は可。購入可能と誤解させない注記を価格ブロックに置く

### 画面レイアウト（Free フル LP）

モバイル 320 優先。1 カラム。主要操作 44×44。

```text
┌─────────────────────────────┐
│ ← 戻る                      │
│                             │
│  [ヒーロー画像]             │
│  こんだて日和 Plus          │
│  献立づくりに、余裕を。     │
│  （surfaces 開時のみ）      │
│  はじめての方は 7 日間お試し│
│  （カード登録あり）         │
│                             │
│  ┌ カード: 枠の余裕      ┐ │
│  │ 画像 + 1 日最大 10 回 │ │
│  └───────────────────────┘ │
│  ┌ カード: くわしく作る  ┐ │
│  │ 品質モード            │ │
│  └───────────────────────┘ │
│  ┌ カード: チラシ→1 週間 ┐ │
│  │ 旗艦                  │ │
│  └───────────────────────┘ │
│                             │
│  Free との違い（簡易表）    │
│  列は L12 のみ              │
│                             │
│  共有 CheckoutIntervalForm  │
│  （月/年・年額確認・注記・  │
│   Plus をはじめる）         │
└─────────────────────────────┘
```

任意: 下部 sticky の「Plus をはじめる」は surfaces 開かつ Checkout 可のときのみ。sticky が本文・固定下タブを隠さない余白を確保（下タブ高を見込む）。

#### 比較表（L12 ロック）

| 項目 | Free | Plus |
|------|------|------|
| 1 日の献立作成（成功） | `planQuota.free.successPerDay` | `planQuota.plus.successPerDay` |
| くわしく作る | なし | あり（回数に限りあり。詳細数字は `planQuota.quality` を使う場合のみ） |
| チラシから 1 週間 | なし | あり（週の上限は `planQuota.flyerWeekly` を使う場合のみ） |

- **出さない**: attempt 残、短時間枠、global、identity 台帳
- 表示文字列の数字は **`planQuota` import**。TSX に `3` / `10` の裸リテラルを書かない

#### コピー骨子（実装で一字句固定してよい。既存定数は流用）

| ブロック | 方向 | 備考 |
|----------|------|------|
| ヒーロー見出し | こんだて日和 Plus | h1（ページに唯一） |
| ヒーローリード | 献立づくりに、余裕を。 | |
| トライアル（surfaces 開） | **はじめての方は** 7 日間お試し（カード登録あり） | M3: 再 trial 不可を暗示。断定「誰でも 7 日無料」禁止 |
| 枠カード | Plus なら 1 日最大 10 回まで作成 | 硬上限 CTA と整合。10 は `planQuota.plus.successPerDay` から組み立て可 |
| 品質カード | 「くわしく作る」でより丁寧な献立（回数に限りあり） | 内部 attempt 語は使わない |
| チラシカード | チラシ写真から 1 週間の献立 | 画像は長期保存しない旨を小さく 1 行可 |
| 価格 | 月額 580 円（税込）/ 年額 5,800 円（税込・2か月分お得） | 設定と同一 |
| 年額確認 | `YEARLY_CONFIRM_COPY` | 共有必須 |
| 遷移注記 | `STRIPE_REDIRECT_NOTICE` | 共有必須 |
| CTA | Plus をはじめる | 共有必須 |
| cancel クエリ | お支払いをキャンセルしました | `?billing=cancel` 時 1 行。表示後 `replace` で query 除去可 |
| 短形 C | お支払いの手続きが完了していません… | incomplete 専用 |

### 共有 Checkout UI（M5）

**禁止:** LP と `PlanSettingsSection` で JSX / 文言を二重定義。

**必須:**

1. **コピー単一ソース** `src/features/billing/billing-ui-copy.ts`（新規）  
   - 少なくとも `YEARLY_CONFIRM_COPY` / `STRIPE_REDIRECT_NOTICE` / `PAST_DUE_COPY` / `PORTAL_BUTTON_LABEL` / `TRIAL_END_WARNING` をここに置く  
   - 加えて kill / surfaces 閉の **`SURFACES_CLOSED_COPY`** = `"お支払い管理は現在ご利用いただけません。"`（設定と LP で一字同一。現状設定に直書きされている文を移す）  
   - `plan-settings-section.tsx` は **re-export** して既存 import パスを壊さない（循環依存禁止）
2. **フォーム** `src/features/billing/checkout-interval-form.tsx`  
   - props: `disabled?`（surfaces 閉）、`pending?`、`onSubmit: (interval: "month" | "year") => void | Promise<void>`  
   - 定数は **`billing-ui-copy` のみ**から import（`plan-settings-section` を form が import しない — **循環依存禁止**）  
   - 内部: 価格リスト・月/年ラジオ・年額確認・注記・「Plus をはじめる」  
   - 年額未確認時は `onSubmit` を呼ばず、設定と同じエラー文を form 内 `role="alert"` で表示

`PlanSettingsSection` は未加入 + surfaces 開のときこのフォームを使うようリファクタ（挙動・テスト exact 維持）。

### Portal（管理短形 A / C）

- surfaces 開: `createPortalSession` → `window.location.assign`（設定と同じ）
- surfaces 閉: Portal ボタンは出さず「設定へ」のみ（Portal API も製品面 kill で閉じる前提）
- 失敗文: 設定と同じ「お支払い管理画面を開けませんでした。…」

### cancel_url（M4）

`netlify/functions/_shared/billing-checkout.ts`:

```text
success_url: `${origin}/settings?billing=success`  // 変更なし
cancel_url:  `${origin}/plus?billing=cancel`       // 本設計で変更
```

- Portal `return_url` は `/settings` のまま
- LP は mount 時に `billing=cancel` を読んで status を出し、`replace` で query を落としてよい（再訪で残らない）
- 設定側の `?billing=cancel` 専用 UI は本設計では新設しない（success poll のみ設定）

### 画像（L11）

| 枚 | 用途 | ファイル例 |
|----|------|------------|
| 1 | ヒーロー | `src/features/billing/assets/plus-hero.webp` |
| 2 | 枠カード | `plus-benefit-quota.webp` |
| 3 | 品質カード | `plus-benefit-quality.webp` |
| 4 | チラシカード | `plus-benefit-flyer.webp` |

制約:

- 同一オリジンのみ（外部 CDN 禁止。CSP と整合）
- 目安 **各 ≤ 150KB**、WebP 推奨、幅固定 + `height` / aspect で CLS 抑制
- 装飾的なら `alt=""`、意味があるなら短い日本語 alt
- トーン: 温かい食卓・料理のイラスト。アプリの terracotta / クリームと衝突しない
- 実在のアレルギー表示・個人情報・読めるチラシの個人店情報を描かない

生成は実装フェーズ（Imagine 等）。差し替え可だが **パスと枚数はロック**。

### データフロー

```text
Free（Checkout 可）ユーザー
  → 「Plus を見る」→ /plus
  → getEntitlement
  → State matrix → フル LP
  → CheckoutIntervalForm → createCheckoutSession({ interval })
  → Stripe Hosted Checkout
  → 成功: /settings?billing=success（既存 poll）
  → キャンセル: /plus?billing=cancel
```

### エラーハンドリング

| 事象 | UI |
|------|-----|
| entitlement 失敗 | alert + 再読み込み促し。Checkout 出さない |
| Checkout API 失敗（一般） | 設定と同じ: 「お支払い画面を開けませんでした。時間をおいてもう一度お試しください」 |
| `billing_already_entitled` | 上記一般文でも可。理想は entitlement 再取得して短形へ切替 |
| `billing_checkout_in_progress` | 「お支払い手続きが進行中です。しばらくしてからお試しください」（サーバ message と整合する固定文） |
| surfaces 閉でボタン押下 | API 非呼び出し + 閉鎖メッセージ |
| 年額未確認 | 設定と同じ: チェック促し |
| Portal 失敗 | 設定と同じ管理画面エラー文 |

`billing-api` は code を `Error.message` に載せる。LP / 共有 form 親は code を見て文言を分岐してよい（設定が一般文のままでも、LP は in_progress を分けることを **推奨**）。

### 品質ゲートリンク（S1）

- Free（`qualityModeLocked`）時、hint「くわしい AI での作成は Plus で使えます」の近くに「Plus を見る」
- `href`/`to` = `/plus`
- 44×44 タッチ。hint とリンクで accessible name を混同しない（リンク名は「Plus を見る」、hint は説明のまま）
- **配置ロック（R-C2）**: quality の `</label>` の **直後 sibling**、かつ idea の `role="note"`（§5.3）の **前**。  
  `role="note"` が `wizard-actions` の **直前 sibling** である契約を壊さない（note と wizard-actions の間に Plus リンクを挟まない）
- **硬上限 CTA と同時表示**され得る（review で Free かつ success 残 0）。どちらも `/plus` でよいが、**同一画面に同名リンクが 2 本**になる。unit は `getByRole` 単独ではなく `within(testId)` または `getAllByRole` で取る（計画 R-B2）

### 表示分岐 pure 関数（実装契約）

- `src/features/billing/plus-landing-view.ts` の `resolvePlusLandingView` が State matrix の **唯一の入口**
- `CHECKOUT_BLOCKED_STATUSES` を export し、`kind: "full"` の `checkoutEnabled` は  
  `productSurfacesOpen === true` **かつ** `status` が blocked 集合に含まれないこと  
  （incomplete 等が短形をすり抜けた場合のベルト＆サスペンダー）

### AppShell section CSS

- `sectionForPath("/plus") === "plus"` に加え、`src/styles.css` に  
  `[data-section="plus"] { --section-tint: #f6f6f4; }`（settings と同値）を **必須**  
  - 未定義だと `background: var(--section-tint)` が無効になり chrome が壊れる

---

## Testing

| 層 | 内容 |
|----|------|
| unit LP | Free+open: 3 メリット・価格・はじめる可；Free+closed: 閉鎖文・CTA 無効・トライアル煽りなし；past_due: マーケなし + PAST_DUE；entitled: 設定誘導・Checkout なし；**incomplete: マーケ/Checkout なし + 短形 C**；`?billing=cancel` メッセージ |
| unit 共有 form | 年額確認なしで checkout 呼ばない；月額で `onSubmit("month")` |
| unit CTA | PlusHardLimit / flyer upsell / flyer locked の href/to が `/plus` |
| unit 品質ゲート | Plus リンクが `/plus`（**必須**） |
| unit checkout サーバ | `cancel_url` が `/plus?billing=cancel`（既存 billing-checkout テストを更新） |
| unit PlanSettings | リファクタ後も価格・trial・past_due・Portal の既存 exact を維持 |
| unit shell | `sectionForPath("/plus") === "plus"`、タイトルキーが settings に誤らない |
| a11y | LP に h1 一つ、主要操作 44px。可能なら accessibility 経路に `/plus` |
| e2e | `billing-plus`: 「Plus を見る」可視維持；可能なら click → `/plus` 1 本。entitlement は `page.route` mock のまま |

---

## ファイル見込み

| 操作 | パス |
|------|------|
| 新規 | `src/features/billing/billing-ui-copy.ts`（共有コピー。設定は re-export） |
| 新規 | `src/features/billing/checkout-interval-form.tsx` (+ test) |
| 新規 | `src/features/billing/plus-landing-view.ts` (+ test) |
| 新規 | `src/features/billing/plus-landing-page.tsx` (+ `.css` / `.test.tsx`) |
| 新規 | `src/features/billing/assets/plus-*.webp` |
| 変更 | `src/app/router.tsx`、`app-shell.tsx`、`styles.css`（`[data-section="plus"]`） |
| 変更 | `plus-cta.tsx`、`flyer-upsell-banner.tsx`、`flyer-weekly-panel.tsx`、関連 test |
| 変更 | `plan-settings-section.tsx`（共有 form + copy re-export） |
| 変更 | `review-step.tsx`（品質 Plus リンク） |
| 変更 | `netlify/functions/_shared/billing-checkout.ts` + test |
| 変更 | e2e `billing-plus.spec.ts` 等 |

---

## 敵対的レビュー反映表

### 初回（M / S）

| ID | 深刻度 | 内容 | 本書の扱い |
|----|--------|------|------------|
| M1 | must | past_due をマーケに落とすな | 短形 A |
| M2 | must | kill 中の欺瞞表現 | kill 表示制約 |
| M3 | must | trial 再掲とサーバ不一致 | 初回限定トーン |
| M4 | must | cancel 着地 | cancel_url → `/plus?billing=cancel` |
| M5 | must | Checkout 二重実装 | 共有 form 必須 |
| S1 | should | 品質ゲートにリンクなし | **必須** |
| S2 | should | shell section | **`plus` キー確定**（settings 流用禁止） |
| S3 | should | 画像サイズ・CSP | 画像制約節 |
| S4 | should | 生 a vs Link | 維持可 |
| S5 | should | kill + DB Plus | plusEntitled 正 |
| S6 | should | 比較表マジックナンバー | planQuota + L12 |

### 再レビュー（通常 + 敵対的）採用

| ID | 深刻度 | 内容 | 修正 |
|----|--------|------|------|
| R-A1 | must | `incomplete` 等がフル LP + Checkout → サーバ 409 | `CHECKOUT_BLOCKED_STATUSES` + 短形 C |
| R-A2 | must | `sectionForPath` を settings にすると chrome タイトルが「設定」になる | section キー **`plus`** |
| R-A3 | should→lock | `history.length` で戻る判定は不可靠 | `location.key === "default"` なら `/planner` |
| R-A4 | should→lock | 比較表が attempt 用語を復活させ得る | L12 で列を固定 |
| R-A5 | should | Checkout エラー code 未分岐 | in_progress 等の推奨文言 |
| R-A6 | should | 品質リンクが「含む場合」と曖昧 | 必須に統一 |
| R-A7 | should | 管理短形の Portal 有無が薄い | Portal 節を追加 |
| R-A8 | info | soft 1 残にリンクを足すと押し売り | **非採用**（L10-2 維持） |

### 設計+計画合同レビュー（R-B）採用

| ID | 深刻度 | 内容 | 修正 |
|----|--------|------|------|
| R-B1 | must | form ↔ plan-settings の相互 import で循環依存 | `billing-ui-copy.ts` へ定数分離 |
| R-B2 | must | Free review で硬上限+品質が同名「Plus を見る」×2 → unit が壊れる | within / getAllBy を必須化 |
| R-B3 | must | `data-section=plus` に CSS が無いと tint 欠落 | settings 同色の `[data-section="plus"]` 必須 |
| R-B4 | should | `checkoutEnabled` が blocked status を再検査しない | full 時に blocked 集合を AND |
| R-B5 | should | design の form props 名 `onCheckout` と plan の `onSubmit` 不一致 | **`onSubmit` に統一** |
| R-B6 | should | cancel_url テストが架空 mock 名 | happy path の `sessionsCreate` 引数へ断言 |
| R-B7 | should | router.test に `/plus` が任意表記 | RequireSession 一覧へ **必須**追加 |
| R-B8 | info | vite-env の webp declare は `vite/client` で足りることが多い | typecheck 失敗時のみ追加 |

### 採用しなかった指摘（擬陽性・意図的非スコープ）

| 指摘 | 理由 |
|------|------|
| success も `/plus` にせよ | poll 契約は設定が正（L7）。P1 残差 |
| trial 使用済み API を P0 で追加 | 非目標。初回限定トーンで吸収 |
| kill 中は `/plus` を 404 に | 人間合意で kill 中も LP 表示 |
| Plus 加入者にマーケを見せよ | 変換済み。管理短形が正 |
| `dbPlusEntitled` を UI 主キーにせよ | 現行 SQL で `plusEntitled` と同値。status 集合で 409 を先回り |
| soft 1 残に「Plus について」必須 | L10-2 は押し売りしない。現状文のみを維持 |
| 価格の 580 を planQuota 化せよ | L5 の税込表示固定。枠数字だけ planQuota |
| 硬上限コピーの「10」を変数化せよ（既存 L10-1） | 本変更の必須ではない。カード/比較表は planQuota |
| success を LP に戻せ | L7 維持 |
| `history.length` で戻せ | 不可靠。R-C1 の key + same-origin referrer を正 |
| 全 CTA を即 Link 化せよ（必須） | unit Router 外方針あり。Link 化は任意、戻るは referrer で吸収 |

---

## Open Questions / 残差（P0 外）

| ID | 内容 | 扱い |
|----|------|------|
| R1 | trial 使用済みを entitlement で返し LP から 7 日文を消す | P1 |
| R2 | success 後も LP に戻し poll する | P1。いまは設定維持 |
| R3 | sticky CTA の要否 | 実装時 320px で判断。無しでも可 |
| R4 | 画像の最終ビジュアル | 実装時生成。枚数とパスはロック |
| R5 | `unpaid` / `paused` / `incomplete_expired` と Checkout 再作成 | サーバ list 範囲の既存残差。本 LP は blocked 集合をサーバ 409 と一致させるまで |
| R6 | 設定の Checkout も incomplete を UI 先回りするか | 本設計の必須は LP。設定側の同型ガードは望ましいが PlanSettings の追加スコープは任意 |

---

## 成功受け入れ（抜粋）

| シナリオ | 期待 |
|----------|------|
| Free + open + status none、「Plus を見る」 | `/plus`。メリット 3・価格・はじめる可 |
| Free + closed、`/plus` 直打ち | メリット・価格は見える。はじめる不可 + 閉鎖文。トライアル煽りなし |
| past_due 猶予内 | マーケなし。PAST_DUE + Portal または設定 |
| incomplete | マーケ/Checkout なし。短形 C |
| Plus active | ご利用中 + 設定へ。Checkout なし |
| Checkout キャンセル | `/plus?billing=cancel` で短い取消メッセージ |
| Checkout 成功 | `/settings?billing=success` で既存 poll |
| 年額未確認ではじめる | checkout 未呼び出し |
| chrome タイトル | `/plus` で「設定」にならない（Plus） |
| 設定プラン節 | リファクタ後も既存 unit / e2e の価格・CTA 契約を満たす |
| 品質ロック | 「Plus を見る」→ `/plus` |

---

## Implementation notes（計画作成時の指針）

1. RED: href 期待を `/plus` に更新するテスト、および LP の state matrix（**incomplete 含む**）から入る
2. `billing-ui-copy` + 共有 form → CTA href → cancel_url → view pure → LP+shell+CSS → 画像 → E2E
3. 検証: 対象 unit、`typecheck`、`lint`、`format:check`（Docker `app`）。billing-checkout の unit は functions 側の既存 runner に従う
4. コミットは Conventional Commits・日本語。push / PR / 本番デプロイはしない

---

## Changelog

| 日付 | 内容 |
|------|------|
| 2026-07-30 | 初版。方針 B + kill 中も `/plus` + 敵対的 M1–M5 / S1 |
| 2026-07-30 | 通常+敵対的再レビュー: R-A1 incomplete/409 先回り、R-A2 section `plus`、R-A3 戻る判定、L12 比較表、Portal/エラー/品質必須の明確化。擬陽性は非採用表へ |
| 2026-07-30 | 設計+計画合同レビュー R-B1〜: 循環依存解消、二重 Plus リンクのテスト契約、section CSS、onSubmit 統一、blocked の checkoutEnabled |
| 2026-07-30 | 再レビュー R-C1〜: 戻る判定（referrer）、品質リンク DOM 順序、SURFACES_CLOSED_COPY、比較表 unit |
