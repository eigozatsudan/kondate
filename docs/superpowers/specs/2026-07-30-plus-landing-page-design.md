# こんだて日和 Plus ランディングページ（LP）設計

| 項目 | 値 |
|------|-----|
| 文書 | `docs/superpowers/specs/2026-07-30-plus-landing-page-design.md` |
| 日付 | 2026-07-30 |
| 状態 | **Review-ready**（合意方針 B + 敵対的レビュー M1–M5 織り込み。ユーザーによる design doc レビュー待ち） |
| 関連 | Plus / Stripe `2026-07-29-paid-plan-stripe-design.md`（L3 価格・L10 ファネル・A3 kill）、設定 UI `PlanSettingsSection`、CTA `plus-cta.tsx` / flyer locked / flyer upsell |
| レビュー | セッション内敵対的レビュー（M1–M5 must_fix、S1–S6 should_fix）。本書がその反映版 |

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
| L4 | Free かつ surfaces 開: フル LP + Checkout。**surfaces 閉でも `/plus` フル LP（メリット・価格）は表示**し Checkout のみ不可 |
| L5 | 価格表示は Stripe 設計 L3 固定: **月額 580 円（税込）/ 年額 5,800 円（税込・2か月分お得）**。数字を独自に変えない |
| L6 | 年額確認文・Stripe 遷移注記・「Plus をはじめる」は設定と **同一ソース**（複製禁止） |
| L7 | Checkout success 後の poll は **設定 `/settings?billing=success` の既存フローを維持** |
| L8 | cancel 後は **`/plus?billing=cancel`**（サーバ `cancel_url` を変更） |
| L9 | 加入済み判定は設定に揃え、**マーケ LP と管理短形を分ける**（下記 State matrix） |
| L10 | トライアル宣伝は **初回限定トーン**。誰でも 7 日無料と断定しない |
| L11 | 生成イラスト 4 枚。同一オリジンのみ。アレルギー・個人情報・実在人物の特定描写なし |

---

## Spec supersede（本設計が正になる箇所）

| 文書・実装 | 本設計 |
|------------|--------|
| Stripe 設計 L10-1 着地「設定 or Checkout シート」 | **硬上限・チラシ locked・週間 upsell の「Plus を見る」着地は `/plus`**。設定のプラン節は管理・Checkout 代替導線として残す |
| Stripe 設計 ファネル表 #1 ボタン「設定 or Checkout シート」 | ボタンラベルは「Plus を見る」のまま。**href = `/plus`** |
| `plus-cta.tsx` / flyer CTA の `href="/settings"` | **`/plus`** |
| `billing-checkout.ts` の `cancel_url` → `/settings?billing=cancel` | **`/plus?billing=cancel`** |
| `success_url` → `/settings?billing=success` | **変更しない** |

**維持するもの**

- Stripe Checkout / Portal / Webhook 正本、entitlement 合成、A3 kill（Webhook 継続・枠 Free 強制・製品面閉）
- 価格 L3、trial 7 日・カード必須・`billing_trial_history` による再 trial 拒否
- `PlanSettingsSection` の設定内 Checkout / Portal（削除しない）
- Free 成功 3 等の枠数値（LP は説明のみ）

---

## Goals & Non-Goals

### Goals

- Free ユーザーが Plus の **3 価値**（枠・品質モード・チラシ週間）と **価格** を 1 画面で理解できる
- その場で月額 / 年額を選び Checkout に進める（設定と同契約）
- kill 中でも価値説明ページとして `/plus` を開ける
- 既存 E2E / unit の「Plus を見る」ラベル契約を壊さない（href のみ更新）
- モバイル 320px・44×44・横スクロールなし・日本語平易

### Non-Goals

- 価格・トライアル条件・Stripe Product の変更
- 複数有料ティア、IAP、従量
- trial 使用済みフラグの entitlement API 追加（サーバは既に trial を付けない。UI は初回限定トーンで吸収）
- success 後 poll の LP 移植
- 下タブへの Plus 追加
- Portal / 解約 UI の LP への完全移植（管理短形は設定誘導または最小 Portal）
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
- `sectionForPath("/plus")`: **`settings`**（シェル配色・タイトル文脈を設定寄りに。タブ「設定」は `aria-current` にしない — path 一致しないため非選択のまま。タイトル表示名は「Plus」または sectionTitles に `plus` を足す実装で「こんだて日和 Plus」）
  - 実装ロック: `sectionForPath` に `/plus` → `"settings"` を追加し、`sectionTitles.settings` 使用時でもページ h1 は「こんだて日和 Plus」を LP 側が持つ
- 戻る: `navigate(-1)`。履歴が無い / 外部直打ち相当は **`/planner`**

### 「Plus を見る」の更新箇所

| コンポーネント | 変更 |
|----------------|------|
| `PlusHardLimitCta` | `href` → `/plus`。コメントを「Checkout は LP / 設定」に更新 |
| `FlyerUpsellBanner` | 同上 |
| `FlyerWeeklyPanel` locked `Link` | `to="/plus"` |
| （should / 本設計に含む）review 品質ロック hint | 「Plus を見る」リンク → `/plus` を 1 本追加（L10-4 延長） |

### State matrix（M1 / L9）

entitlement は `GET /api/billing/entitlement` のみ。クライアントはプランを主張しない。

| 条件（上から優先） | 表示 |
|--------------------|------|
| loading かつ data なし | 「プラン情報を確認しています…」 |
| error かつ data なし | 「プラン情報を確認できませんでした。再読み込みしてください。」（設定と同トーン） |
| `status === "past_due"` または `pastDueGrace === true` | **管理短形 A**: `PAST_DUE_COPY` + surfaces 開なら Portal ボタン、閉なら設定リンク。**マーケ・価格・Checkout なし** |
| `plusEntitled === true`（上記以外） | **管理短形 B**: 「こんだて日和 Plus をご利用中です」相当 + 「設定へ」→ `/settings`。trial 中なら設定と同様 `TRIAL_END_WARNING` を出してよい。**マーケ・Checkout なし** |
| それ以外（Free）+ `productSurfacesOpen === true` | **フル LP** + Checkout 可 |
| Free + `productSurfacesOpen === false` | **フル LP**（メリット・価格は表示）+ Checkout **不可**（下記 kill 表示） |

判定の禁止:

- `quotaPlan` だけで加入済みとしない（kill 中は entitled でも `quotaPlan === "free"`）
- `productSurfacesOpen` だけで加入済みとしない
- `plan === "plus"` 単独でマーケを隠さない（`plusEntitled` / past_due 系を正）

### kill 中（surfaces 閉）の表示制約（M2）

Free フル LP は **開く**（合意）。ただし:

1. 価格ブロック先頭に設定と同文: **「お支払い管理は現在ご利用いただけません。」**
2. 「Plus をはじめる」は **disabled**（非表示より理由が伝わる）または押下しても API を呼ばず同文を `role="alert"` で再掲
3. ヒーローのトライアル煽り（「7日間無料でお試し」「今すぐ」等）は **surfaces 開のときだけ**。閉のときは中立見出し（例: 「Plus でできること」）
4. 価格数字の表示は可（情報提供）。購入可能と誤解させない注記を価格ブロックに置く

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
│  数値は planQuota 由来      │
│                             │
│  共有 CheckoutIntervalForm  │
│  （月/年・年額確認・注記・  │
│   Plus をはじめる）         │
└─────────────────────────────┘
```

任意: 下部 sticky の「Plus をはじめる」は surfaces 開かつ Free のときのみ。sticky が本文を隠さない余白を確保。

#### コピー骨子（実装で一字句固定してよい。既存定数は流用）

| ブロック | 方向 | 備考 |
|----------|------|------|
| ヒーロー見出し | こんだて日和 Plus | h1 |
| ヒーローリード | 献立づくりに、余裕を。 | |
| トライアル（surfaces 開） | **はじめての方は** 7 日間お試し（カード登録あり） | M3: 再 trial 不可を暗示。断定「誰でも 7 日無料」禁止 |
| 枠カード | Plus なら 1 日最大 10 回まで作成 | 硬上限 CTA コピーと整合 |
| 品質カード | 「くわしく作る」でより丁寧な献立（回数に限りあり） | サーバ quality 枠の詳細数字は出しすぎない。必要なら 1 日・月の上限を plan 定数から |
| チラシカード | チラシ写真から 1 週間の献立 | 画像は長期保存しない旨を小さく 1 行可 |
| 比較表 | Free / Plus の成功回数など | **マジックナンバー直書き禁止**。`planQuota` または共有表示ヘルパ |
| 価格 | 月額 580 円（税込）/ 年額 5,800 円（税込・2か月分お得） | 設定と同一 |
| 年額確認 | `YEARLY_CONFIRM_COPY` | 共有必須 |
| 遷移注記 | `STRIPE_REDIRECT_NOTICE` | 共有必須 |
| CTA | Plus をはじめる | 共有必須 |
| cancel クエリ | お支払いをキャンセルしました | `?billing=cancel` 時 1 行。永続バナーにしない |

### 共有 Checkout UI（M5）

**禁止:** LP と `PlanSettingsSection` で JSX / 文言を二重定義。

**必須:** 例 `src/features/billing/checkout-interval-form.tsx`（名称は実装計画で確定）:

- props: `disabled`（surfaces 閉・pending）、`onCheckout(interval)`、必要なら注入用
- 内部: 月/年ラジオ、年額時チェック、`YEARLY_CONFIRM_COPY`、`STRIPE_REDIRECT_NOTICE`、主ボタン
- 定数: `plan-settings-section` から export 済みのものを **import して再利用**（移動してもよいが単一ソース）

`PlanSettingsSection` は未加入 + surfaces 開のときこのフォームを使うようリファクタ（挙動・テスト exact 維持）。

### cancel_url（M4）

`netlify/functions/_shared/billing-checkout.ts`:

```text
success_url: `${origin}/settings?billing=success`  // 変更なし
cancel_url:  `${origin}/plus?billing=cancel`       // 本設計で変更
```

- Portal `return_url` は `/settings` のまま
- LP は mount 時に `billing=cancel` を読んで status を出し、`replace` で query を落としてよい（二重表示防止）

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

生成は実装フェーズ（Imagine 等）。デザイン確定後に差し替え可能だが **パスと枚数はロック**。

### データフロー

```text
Free ユーザー
  → 「Plus を見る」→ /plus
  → getEntitlement
  → フル LP
  → CheckoutIntervalForm → createCheckoutSession({ interval })
  → Stripe Hosted Checkout
  → 成功: /settings?billing=success（既存 poll）
  → キャンセル: /plus?billing=cancel
```

### エラーハンドリング

| 事象 | UI |
|------|-----|
| entitlement 失敗 | alert + 再読み込み促し。Checkout 出さない |
| Checkout API 失敗 | 設定と同じ: 「お支払い画面を開けませんでした。…」 |
| surfaces 閉でボタン押下 | API 非呼び出し + 閉鎖メッセージ |
| 年額未確認 | 設定と同じ: チェック促し |

---

## Testing

| 層 | 内容 |
|----|------|
| unit LP | Free+open: 3 メリット・価格・はじめる可；Free+closed: 閉鎖文・CTA 無効・トライアル煽りなし；past_due: マーケなし + PAST_DUE；entitled: 設定誘導・Checkout なし；`?billing=cancel` メッセージ |
| unit 共有 form | 年額確認なしで checkout 呼ばない；月額で `onCheckout("month")` |
| unit CTA | PlusHardLimit / flyer upsell / flyer locked の href/to が `/plus` |
| unit 品質ゲート | Plus リンクが `/plus`（本設計に含む場合） |
| unit checkout サーバ | `cancel_url` が `/plus?billing=cancel`（既存 billing-checkout テストを更新） |
| unit PlanSettings | リファクタ後も価格・trial・past_due・Portal の既存 exact を維持 |
| a11y | LP に h1、主要操作 44px、必要なら accessibility 経路に `/plus` |
| e2e | `billing-plus`: 「Plus を見る」可視維持；可能なら click → `/plus` 1 本。entitlement は `page.route` mock のまま |

---

## ファイル見込み

| 操作 | パス |
|------|------|
| 新規 | `src/features/billing/plus-landing-page.tsx` (+ `.css` / `.test.tsx`) |
| 新規 | `src/features/billing/checkout-interval-form.tsx` (+ test) |
| 新規 | `src/features/billing/assets/plus-*.webp` |
| 変更 | `src/app/router.tsx`、`app-shell.tsx`（sectionForPath） |
| 変更 | `plus-cta.tsx`、`flyer-upsell-banner.tsx`、`flyer-weekly-panel.tsx`、関連 test |
| 変更 | `plan-settings-section.tsx`（共有 form 利用） |
| 変更 | `review-step.tsx`（品質 Plus リンク） |
| 変更 | `netlify/functions/_shared/billing-checkout.ts` + test |
| 変更 | e2e `billing-plus.spec.ts` 等 |

---

## 敵対的レビュー反映表

| ID | 深刻度 | 内容 | 本書の扱い |
|----|--------|------|------------|
| M1 | must | past_due をマーケに落とすな | State matrix 管理短形 A |
| M2 | must | kill 中の欺瞞表現 | kill 表示制約 |
| M3 | must | trial 再掲とサーバ不一致 | 初回限定トーン；API 追加は非目標 |
| M4 | must | cancel 着地 | cancel_url → `/plus?billing=cancel` |
| M5 | must | Checkout 二重実装 | 共有 form 必須 |
| S1 | should | 品質ゲートにリンクなし | **本設計に含む** |
| S2 | should | shell section | `/plus` → settings 系 |
| S3 | should | 画像サイズ・CSP | 画像制約節 |
| S4 | should | 生 a vs Link | 既存生 a 方針維持可と明記（実装で Link 化は任意） |
| S5 | should | kill + DB Plus | State matrix で plusEntitled 正 |
| S6 | should | 比較表マジックナンバー | planQuota 由来 |

---

## Open Questions / 残差（P0 外）

| ID | 内容 | 扱い |
|----|------|------|
| R1 | trial 使用済みを entitlement で返し LP から 7 日文を消す | P1 |
| R2 | success 後も LP に戻し poll する | P1。いまは設定維持 |
| R3 | sticky CTA の要否 | 実装時に 320px 実機で判断。無しでも可 |
| R4 | 画像の最終ビジュアル | 実装時生成・差し替え。枚数とパスはロック |

---

## 成功受け入れ（抜粋）

| シナリオ | 期待 |
|----------|------|
| Free + open、「Plus を見る」 | `/plus`。メリット 3・価格・はじめる可 |
| Free + closed、`/plus` 直打ち | メリット・価格は見える。はじめる不可 + 閉鎖文。トライアル煽りなし |
| past_due 猶予内 | マーケなし。支払い更新導線 |
| Plus active | ご利用中 + 設定へ。Checkout なし |
| Checkout キャンセル | `/plus?billing=cancel` で短い取消メッセージ |
| Checkout 成功 | `/settings?billing=success` で既存 poll |
| 年額未確認ではじめる | checkout 未呼び出し |
| 設定プラン節 | リファクタ後も既存 unit / e2e の価格・CTA 契約を満たす |

---

## Implementation notes（計画作成時の指針）

1. RED: href 期待を `/plus` に更新するテストから入る、または LP の state matrix テストを先に書く
2. 共有 form 切り出し → PlanSettings 緑維持 → LP 実装 → cancel_url → 画像配置
3. 検証: 対象 unit、`typecheck`、`lint`、`format:check`（Docker `app`）。billing-checkout の unit は functions 側の既存 runner に従う
4. コミットは Conventional Commits・日本語。push / PR / 本番デプロイはしない

---

## Changelog

| 日付 | 内容 |
|------|------|
| 2026-07-30 | 初版。方針 B + kill 中も `/plus` + 敵対的 M1–M5 / S1 織り込み |
