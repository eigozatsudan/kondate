# 初回家族設定: 複数登録可能のアテンション強化 設計書

| 項目 | 値 |
|------|-----|
| 日付 | 2026-07-31 |
| 状態 | **改訂済み（敵対的レビュー反映）** — 実装計画待ち |
| 対象 | `/onboarding`（`HouseholdOnboardingPage` / `HouseholdOnboardingForm`） |
| 関連 | `2026-07-22-guided-planner-optional-household-design.md`（家族設定任意・1人完了で `complete`） |
| 敵対的レビュー | `docs/reviews/2026-07-31-onboarding-multi-member-attention-design-adversarial.md`（C-1〜C-3 / I-1〜I-7 を本改訂で吸収） |

## 1. 背景と問題

初回ログイン後の家族設定（`/onboarding`）では、1人目の「この家族の設定を完了する」成功後に、ただちに `setOnboardingStatus("complete")` と `/planner` 遷移が走る。

その結果:

- 1人しか登録していないのに献立作成が始まり、**複数人を登録できない**ように見える
- 「まずは1人でよい」「追加はあとからできる」という意図が UI 上で見逃されやすい
- 設計上は設定画面（`/settings` の家族設定）から複数追加可能だが、初回導線ではその事実が伝わらない

実装上、`draft === null` かつ `complete` メンバーが1人以上いるときの「家族を追加」「この家族の設定を完了する」UI は既にあるが、**1人目の draft 完了直後は `finishOnboarding` が即呼ばれる**ため、通常の成功経路ではその画面に留まらない。

## 2. 目的

1. 入力中から「まずは1人」「あとから家族を追加できる」を**見逃しにくい callout** で伝える。
2. 1人目完了後に献立へ飛ばさず、**次アクション画面**で「続けて家族を追加」と「献立を始める」を明示する。
3. 既存の onboarding 契約（任意、1人完了で `complete` 可、skip 可、安全カタログ・API 境界、`set_onboarding_status` 遷移表）を壊さない。

## 3. 非対象

- 家族設定画面（`household-settings-page`）の大幅改修
- 次アクション / callout から **`/settings` へのディープリンク**（案内は文言のみ。I-7）
- Welcome 画面の copy・レイアウト変更（中断後の welcome 再表示は §4.2 の残余リスクとして許容）
- `onboarding_status` の意味変更、必須登録人数の引き上げ（1人未満を必須にはしない）
- DB / RPC / Netlify Functions の契約変更（`complete`→`skipped` の許可追加もしない）
- planner 対象ステップの大規模変更
- グローバルデザインシステムの新規コンポーネントライブラリ導入（既存 `InlineNotice` 再利用）

## 4. ユーザーフローと状態

### 4.1 主フロー

```text
[welcome 等] → /onboarding
  ├─ 下書きなし・complete member 0: 開始 CTA（既存）
  ├─ 下書きあり: メンバーフォーム
  │     ├─ 上部 callout（completeMembers 数で文言分岐・§5.1）
  │     ├─ フィールド入力（既存）
  │     └─ 「この家族の設定を完了する」
  │           ↓ completeMember 成功（setProgress しない・navigate しない）
  │     【次アクション画面】
  │           ├─ 主 CTA: 献立を始める → （要時 setProgress complete）→ /planner
  │           ├─ 副 CTA: 続けて家族を追加 → createDraft → フォームへ
  │           └─ tertiary skip: profile が not_started|in_progress のときのみ
  │                 → setProgress(skipped) → /planner
  └─ 下書きなし・complete member ≥ 1: 次アクション画面（同上）
```

### 4.2 正規中間状態（C-2）

本設計は次を**正規の中間状態**として明示的に許容する。

| 項目 | 値 |
|------|-----|
| `household_members` | `status = complete` が 1 人以上 |
| `profiles.onboarding_status` | まだ `in_progress`（member complete だけでは `complete` にしない） |
| 画面 | 次アクション、または「続けて追加」後の draft フォーム |

**再入（タブ閉鎖・`/` 再訪）**

1. `root-entry-page`: `not_started | in_progress` → `/welcome`（現行どおり。本設計で変更しない）。
2. welcome: 「家族設定を続ける」→ `/onboarding`。
3. `/onboarding`: draft が無ければ**次アクション**、draft があればフォーム。登録済み member は消えない。
4. welcome の copy は本設計の対象外。中断後に welcome が再表示される違和感は **§9 の許容残余リスク**とする（welcome を直す場合は別設計）。

**受け入れ上の含意**: member complete 後にリロードしても次アクション（または draft）に復帰し、データが消えないこと。

### 4.3 再訪と profile status（C-1）

- `complete` メンバー ≥ 1 かつ draft なしで `/onboarding` に来た場合 → 次アクション UI（既存の「完了済み人数 + 追加 / 完了」UI を本仕様に統合・置換）。
- ルーターガードは新設しない。`profiles.onboarding_status === "complete" | "skipped"` の直接アクセスも次アクション相当を出してよい。
- **skip CTA と主 CTA の挙動は profile status で分岐する**（§5.2）。  
  RPC 許可遷移（変更しない正本）:

  | 現在 | 許可先 |
  |------|--------|
  | `not_started` | `in_progress`, `skipped` |
  | `in_progress` | `complete`, `skipped` |
  | `skipped` | `in_progress`, `complete` |
  | `complete` | 同一 status の冪等 return のみ（出口なし） |

  よって **`complete` → `skipped` は不可**。skip を常時出してはならない。

### 4.4 profile の読取（実装前提）

次アクションの CTA 分岐に `profiles.onboarding_status` が必要。現状 `HouseholdOnboardingForm` は members のみを読む。

- **追加**: 既存 `getProfile` + `householdKeys.profile(userId)`（welcome / planner と同型）で profile を取得する。
- 読取失敗時: skip を出さない（fail-closed）。主 CTA「献立を始める」と副「続けて家族を追加」は出し、主 CTA 押下時の `setProgress` 失敗は既存エラー文言。読取中は次アクション操作を disable してよい。
- **書き込み契約・RPC シグネチャは変更しない**。

## 5. UI 仕様

### 5.1 入力中 callout（draft 表示中）

- 配置: **eyebrow / h1 の直後、進捗「設定済み項目 n / 3」の前**。最初のビューポートに入り、スクロールなしで見える位置とする。
- 見た目: 既存 **`InlineNotice`**（`src/shared/ui/wizard/inline-notice.tsx`、`.inline-notice` / `.inline-notice-title` / `.inline-notice-body`）。新規色トークンは必須にしない。装飾だけの非テキスト情報に依存しない。
- **静的 callout に `role="status"` を付けない**（I-4）。ライブリージョンは動的更新向け。見出し付きの通常フローで十分。
- 文言は **`completeMembers.length` で分岐**（I-1）:

  | 条件 | 見出し | 本文 |
  |------|--------|------|
  | `completeMembers.length === 0`（初回1人目） | `まずは1人分から登録しましょう` | `家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。` |
  | `completeMembers.length ≥ 1`（2人目以降） | `続けて家族を登録できます` | `何人でも登録できます。登録が終わったら「献立を始める」で先に進めます。あとから設定の「家族設定」でも追加・編集できます。` |

- 設定への言及は**文言のみ**。`/settings` リンクは置かない（§3 / I-7）。

### 5.2 次アクション画面（draft なし・complete メンバー ≥ 1）

#### 見出し・本文

| N = completeMembers.length | 見出し | 人数行 |
|----------------------------|--------|--------|
| 1 | `1人目の登録が完了しました` | **常に** `1人の設定が完了しています。` を出す（I-2。E2E 再訪と一致） |
| ≥ 2 | `登録が完了しました` | `N人の設定が完了しています。` |

- 本文（共通）: `ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。`
- 設定リンクは置かない（文言のみ）。

#### 操作表（いずれも min 44×44 CSS px。pending 中は全操作 disable — I-6）

| 優先 | 文言 | 表示条件 | 動作 |
|------|------|----------|------|
| 主 | `献立を始める`（profile が既に `complete` の再訪では **`献立に戻る`** でも可。どちらか一方に実装で固定しテストも合わせる） | 常時 | **profile が `complete` のとき**: `setProgress` を省略して `onDone()` のみ（または冪等の `setProgress("complete")` 後 `onDone` — 実装はいずれか一方に固定）。**それ以外（主に `in_progress`）**: `setProgress("complete")` 成功後 `onDone()`。`skipped` 再訪で complete member がある場合は `setProgress("complete")` を試み、成功後 `onDone`（許可遷移） |
| 副 | `続けて家族を追加` | 常時 | `createDraft` / `startHouseholdOnboarding` → フォーム表示 |
| tertiary | `あとで設定する（アイデアから始める）` | **profile が `not_started` または `in_progress` のときだけ**（C-1） | `setProgress("skipped")` 成功後 `onDone()` |
| — | （skip 非表示） | profile が `complete` または `skipped`、または profile 未取得/失敗 | skip を DOM に出さない |

- フォーム末尾の skip（draft 編集中）は、従来どおり **常に表示してよい**（この時点の profile は通常 `in_progress`。万一 `complete` のまま draft を開いている場合は、押下で RPC 失敗し得るが、`start_household_onboarding` は `complete` を後退させないため draft 追加後も `complete` のまま — その場合フォーム skip も **profile が `in_progress`/`not_started` のときだけ表示**に揃える）。

#### フォーカス / アナウンス（I-5）

- 次アクション画面を表示したとき（member complete 成功後の切替、および初回マウントで次アクションのとき）:
  - 次アクションの **`h1` に `tabIndex={-1}` を付けて `focus()`** する。
  - 追加の `role="status"` アナウンスは必須にしない（見出しフォーカスで足りる）。

#### エラー文言（既存と同文）

- `setProgress("complete")` 失敗: `設定を完了できませんでした。通信を確認して再試行してください。`
- `setProgress("skipped")` 失敗: `スキップできませんでした。通信を確認して再試行してください。`
- 追加開始失敗: 既存の開始失敗メッセージ
- `completeMember` 失敗: フォームに残り、既存の保存失敗表示（toast なしの status 行など現行どおり）

#### 旧ラベル

- 次アクション主 CTA に **`この家族の設定を完了する` を使わない**（フォーム末尾の完了ボタン文言は現状維持）。
- 次アクション副 CTA は **`家族を追加` ではなく `続けて家族を追加`**。

### 5.3 メンバーフォーム末尾

- 「この家族の設定を完了する」成功時: **`setProgress` しない・`onDone`/navigate しない**。query 更新後、次アクション条件が満たされれば次アクション UI へ。
- skip CTA: §5.2 のとおり **profile が `not_started` | `in_progress` のときだけ**。

## 6. 実装方針

### 6.1 変更ファイル（想定）

| ファイル | 内容 |
|----------|------|
| `src/features/household/household-onboarding-page.tsx` | callout 分岐、complete 後分岐、次アクション UI、profile 読取、CTA 条件、focus、pending |
| `src/features/household/household-onboarding-page.test.tsx` | §7.1 置換表どおり |
| `e2e/specs/onboarding.spec.ts` | **必須更新**（C-3 / §7.2） |
| （任意）他 E2E | onboarding 完了即 planner 前提があれば追随。フル新規 E2E は必須にしない |

`getProfile` / `householdKeys.profile` は既存。必要なら `HouseholdOnboardingApi` に `getProfile` を足してテスト注入可能にする。

### 6.2 ロジック変更（要点）

現状（問題箇所）:

```text
completeMember 成功 → invalidate → finishOnboarding()  // setProgress(complete) + onDone
```

変更後:

```text
completeMember 成功 → invalidate → 次アクション表示（navigate しない・setProgress しない）
// 「献立を始める」→ finishOnboarding 相当（status に応じて setProgress 省略可）
// skip → profile が not_started|in_progress のときだけ UI 表示
// 続けて追加 → createDraft
```

- `finishOnboarding` の責務は「必要なら `complete` にして onDone」に限定し、member complete と結合しない。
- 次アクション条件: `draft === null && completeMembers.length > 0`（ローカル「今完了した」フラグは必須にしない）。
- `completeMembers.length === 0 && draft === null` は現行の「家族設定を始める」画面のまま。

### 6.3 アクセシビリティ・モバイル

- 320 CSS px で横スクロールなし。
- タッチターゲット 44×44 CSS px。
- callout / 次アクション見出しはテキストで完結（色だけに依存しない）。
- 主 CTA を視覚的にも DOM 順でも先にする。
- 次アクション表示時に h1 へフォーカス（§5.2）。

### 6.4 プライバシー・安全

- 新規の個人情報表示なし（表示名を次アクション見出しに出さない）。
- アレルギー安全保証の免責文は入力フォーム側で現状維持。次アクションに再掲は必須ではない。

## 7. テスト

### 7.1 ユニット / コンポーネント（必須）— 置換表（I-3）

| 旧契約 | 新契約 |
|--------|--------|
| complete 成功で `setProgress("complete")` + `onDone` | complete 成功で **どちらも呼ばれない**。次アクション文言が出る |
| `setProgress` 失敗が completeMember 直列 | **「献立を始める」**押下時の `setProgress` 失敗で次アクションに残り、エラー表示。`onDone` なし |
| 既存 complete member のボタン「この家族の設定を完了する」 | 主 CTA **「献立を始める」**（または固定した「献立に戻る」） |
| （無し） | profile `complete` では **skip 非表示** |
| （無し） | profile `in_progress` では skip 表示、押下で `setProgress("skipped")` + `onDone` |
| （無し） | 1人目 callout / 2人目以降 callout の文言分岐 |
| （無し） | 次アクションに人数行 `N人の設定が完了しています。` |
| （無し） | 「続けて家族を追加」で `createDraft`、フォーム＋2人目 callout |
| （推奨） | 次アクション表示後、h1 がフォーカス可能（または focus されている） |

必須ケース（チェックリスト）:

1. draft・complete 0 で初回 callout 見出し・本文が出る。
2. 「この家族の設定を完了する」成功後、`setProgress` / `onDone` が呼ばれない。
3. 次アクションに「1人目の登録が完了しました」「1人の設定が完了しています。」「献立を始める」「続けて家族を追加」が出る。
4. profile `in_progress` では skip が出る。profile `complete` では skip が出ない。
5. 「続けて家族を追加」で `createDraft` が呼ばれ、2人目 callout 付きフォームに戻る。
6. 「献立を始める」で（要時）`setProgress("complete")` と `onDone` が呼ばれる。
7. skip 押下で `setProgress("skipped")` と `onDone` が呼ばれる（表示条件を満たすとき）。
8. `completeMember` 失敗時はフォームに残り、既存失敗表示。`setProgress("complete")` 失敗時は次アクションに残り、完了エラー表示。
9. 既存の validation toast / field error / 読込失敗のテストは回帰として維持。

### 7.2 E2E（必須: C-3）

**`e2e/specs/onboarding.spec.ts` を必須更新する。** 期待フロー:

1. welcome → 家族登録 → 開始 → 必須項目入力。
2. 「この家族の設定を完了する」→ **`/planner` に行かない**。次アクション（「1人目の登録が完了しました」または「1人の設定が完了しています。」）が見える。
3. 「献立を始める」→ `/planner`。ナビ可視。
4. 同意を独立保存する既存ステップは維持。
5. `/onboarding` 再訪 → `1人の設定が完了しています。` が見える。skip が**出ない**（profile `complete`）ことを確認してよい（推奨）。

- 他 E2E が onboarding 完了即 planner 前提なら存在する範囲で追随。
- 新規のフルジャーニー E2E 追加は必須にしない。

### 7.3 検証コマンド（実装時）

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

E2E を触った場合はホストで（例）:

```bash
./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts
```

（プロジェクトの e2e 起動手順に従う。）

## 8. 受け入れ基準

- [ ] 初回フォームに「まずは1人分から…」callout が見える。
- [ ] 2人目以降フォームでは「続けて家族を登録できます」callout（初回文言ではない）。
- [ ] 1人目完了直後に自動で献立へ進まない。
- [ ] 次アクションから「続けて家族を追加」で2人目入力に入れる。
- [ ] 次アクションから「献立を始める」で `complete`（要時）+ planner に進める。
- [ ] skip は profile が `not_started` / `in_progress` の次アクションでのみ使え、`complete` 再訪では出ない。
- [ ] member complete 後にリロードしてもデータが残り、次アクションまたは draft に復帰できる。
- [ ] `e2e/specs/onboarding.spec.ts` が次アクション経由のフローで通る。
- [ ] DB/API 契約・RLS・quota に変更がない。
- [ ] フォーカスされた単体テストと typecheck / lint / format:check が通る。

## 9. リスクと緩和

| リスク | 緩和 |
|--------|------|
| E2E が「完了即 planner」前提 | **`onboarding.spec.ts` 必須更新**（C-3）。他は失敗したものだけ追随 |
| 次アクションを挟み手順が増える | 主 CTA を「献立を始める」にし、1 タップで従来相当 |
| member complete 後 `in_progress` のまま中断 → welcome 再表示 | 正規中間状態として §4.2 で許容。welcome copy 変更は非対象の残余リスク |
| `complete` 再訪で skip が RPC 失敗 | skip を status 分岐で非表示（C-1） |
| 主 CTA を読まずに進むと1人のまま | 本設計の目的は「可能だと気づける」こと。主 CTA の並び替えは将来課題（M-3） |
| 文言が長い | `InlineNotice` + 段落。320px で折り返し確認 |
| profile 読取失敗 | skip 非表示（fail-closed）。主/副は維持 |

## 10. 決定事項まとめ

| 項目 | 決定 |
|------|------|
| 方針 | 完了後は遷移せず次アクション画面を挟む（Approach A） |
| 入力中 callout | `InlineNotice`。completeMembers 数で文言分岐。`role="status"` なし |
| 完了後 | 献立を始める + 続けて家族を追加 + **条件付き** skip |
| skip 表示 | profile `not_started` \| `in_progress` のみ |
| 中間状態 | `in_progress` + complete member ≥1 を正規許容。再入は welcome → 続ける |
| 人数行 | 常に `N人の設定が完了しています。` |
| profile 読取 | onboarding で `getProfile` 追加（RPC 変更なし） |
| 設定画面 | 文言案内のみ。ディープリンク非対象 |
| Welcome | 非対象（中断後再表示は残余リスク） |
| API/DB | 変更なし |
| E2E | `e2e/specs/onboarding.spec.ts` 必須更新 |

## 11. 敵対的レビュー反映チェック

| ID | 内容 | 本改訂 |
|----|------|--------|
| C-1 | complete 済み skip 失敗 | §4.3 / §5.2 表示条件・操作表 |
| C-2 | 中間状態・再入未規定 | §4.2 |
| C-3 | E2E 必須 | §7.2 / §8 |
| I-1 | 2人目 callout | §5.1 分岐表 |
| I-2 | 人数行省略 | 常時表示に固定 |
| I-3 | 単体置換表 | §7.1 |
| I-4 | role=status 誤用 | InlineNotice・status 禁止 |
| I-5 | フォーカス | §5.2 h1 focus |
| I-6 | pending | 操作表・全 disable |
| I-7 | 設定リンク | 非対象・文言のみ |
| M-1 | トークン名 | InlineNotice 固定 |
| M-2 | 完了 API 曖昧さ | §7.1-8 で member / setProgress 分離 |
| M-3 | 主 CTA 残余 | §9 |
