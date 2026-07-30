# 初回家族設定: 複数登録可能のアテンション強化 設計書

- 日付: 2026-07-31
- 状態: 承認済み（実装計画待ち）
- 対象: `/onboarding`（`HouseholdOnboardingPage` / `HouseholdOnboardingForm`）
- 関連: `2026-07-22-guided-planner-optional-household-design.md`（家族設定任意・1人完了で `complete`）

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
3. 既存の onboarding 契約（任意、1人完了で `complete` 可、skip 可、安全カタログ・API 境界）を壊さない。

## 3. 非対象

- 家族設定画面（`household-settings-page`）の大幅改修
- `onboarding_status` の意味変更、必須登録人数の引き上げ（1人未満を必須にはしない）
- DB / RPC / Netlify Functions の契約変更
- Welcome 画面や planner 対象ステップの大規模変更
- グローバルデザインシステムの新規コンポーネントライブラリ導入

## 4. ユーザーフロー

```text
[welcome 等] → /onboarding
  ├─ 下書きなし: 開始 CTA（既存）
  └─ 下書きあり: 1人目フォーム
        ├─ 上部 callout（新規・常時）
        ├─ フィールド入力（既存）
        └─ 「この家族の設定を完了する」
              ↓ completeMember 成功
        【次アクション画面】（新規・自動遷移しない）
              ├─ 主 CTA: 献立を始める → setProgress(complete) → /planner
              ├─ 副 CTA: 続けて家族を追加 → createDraft → 同じフォームへ
              └─ tertiary: あとで設定する（アイデアから始める）→ setProgress(skipped) → /planner
```

再訪・リロード:

- `complete` メンバーが1人以上あり draft なしで `/onboarding` に来た場合も、同じ次アクション画面を表示する（既存の「完了済み人数 + 追加 / 完了」UI を本仕様の次アクションに統合・置換する）。
- すでに `profiles.onboarding_status === "complete"` の利用者が `/onboarding` に直接来た場合のルーター挙動は現行のまま（本設計でガードを新設しない）。画面を開ければ次アクション相当 UI を出してよい。

## 5. UI 仕様

### 5.1 入力中 callout（draft 表示中）

- 配置: **eyebrow / h1 の直後、進捗「設定済み項目 n / 3」の前**。最初のビューポートに入り、スクロールなしで見える位置とする。
- 見た目: 既存のカード／注意枠トークンを再利用した**目立つ枠**（背景色・左ボーダー等。新規色トークンは必須にしない）。`role="status"` で読み上げ可能。装飾だけの非テキスト情報に依存しない。
- 文言（固定）:

  - 見出し: `まずは1人分から登録しましょう`
  - 本文: `家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。`

### 5.2 次アクション画面（draft なし・complete メンバー ≥ 1）

- 見出し: `1人目の登録が完了しました`  
  - 2人目以降を完了して戻った場合: `登録が完了しました` とし、下に `N人の設定が完了しています。` を出す（N ≥ 1）。1人目完了直後（N === 1）は見出しを「1人目…」にし、人数行は任意（重複回避のため N === 1 では人数行を省略してよい）。
- 本文: `ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。`
- 操作（上から主→副→tertiary、いずれも min 44×44 CSS px）:

  | 優先 | 文言 | 動作 |
  | --- | --- | --- |
  | 主 | `献立を始める` | `setProgress("complete")` 成功後 `onDone()`（`/planner`） |
  | 副 | `続けて家族を追加` | 既存の draft 作成（`startHouseholdOnboarding` / `createDraft`）→ フォーム表示 |
  | tertiary | `あとで設定する（アイデアから始める）` | 既存 skip: `setProgress("skipped")` → `onDone()` |

- エラー表示は既存と同文言:
  - 完了失敗: `設定を完了できませんでした。通信を確認して再試行してください。`
  - スキップ失敗: `スキップできませんでした。通信を確認して再試行してください。`
  - 追加開始失敗: 既存の開始失敗メッセージ

- 旧ラベルの扱い:
  - 次アクション画面の主 CTA は **`この家族の設定を完了する` を使わない**（1人目フォーム末尾の完了ボタン文言は現状維持）。
  - 次アクションの副 CTA は **`家族を追加` ではなく `続けて家族を追加`** に統一する。

### 5.3 1人目フォーム末尾

- 「この家族の設定を完了する」成功時の挙動のみ変更: **navigate / setProgress しない**。
- フォーム末尾の skip CTA は現状維持（未完了でもアイデア開始可能）。

## 6. 実装方針

### 6.1 変更ファイル（想定）

- `src/features/household/household-onboarding-page.tsx` — callout、complete 後の分岐、次アクション UI
- `src/features/household/household-onboarding-page.test.tsx` — 挙動・文言
- 関連 E2E があれば `e2e/specs/onboarding.spec.ts` 等を追随（存在する範囲のみ）

### 6.2 ロジック変更（要点）

現状（問題箇所）:

```text
completeMember 成功 → invalidate → finishOnboarding()  // setProgress(complete) + onDone
```

変更後:

```text
completeMember 成功 → invalidate → 画面を次アクション状態へ（navigate しない）
// finishOnboarding は「献立を始める」押下時のみ
// skipOnboarding は次アクション / フォーム双方の tertiary から
// 続けて追加は startMutation / createDraft
```

- `finishOnboarding` の責務は「`complete` にして onDone」に限定し、メンバー complete と結合しない。
- ローカル state で「今完了したばかり」フラグは必須にしない。`draft === null && completeMembers.length > 0` を次アクション条件とする。
- `completeMembers.length === 0 && draft === null` は現行の「家族設定を始める」画面のまま。

### 6.3 アクセシビリティ・モバイル

- 320 CSS px で横スクロールなし。
- タッチターゲット 44×44 CSS px。
- callout / 次アクション見出しはテキストで完結（色だけに依存しない）。
- 主 CTA を視覚的にも DOM 順でも先にする。

### 6.4 プライバシー・安全

- 新規の個人情報表示なし（表示名を次アクション見出しに出さない）。
- アレルギー安全保証の免責文は入力フォーム側で現状維持。次アクションに再掲は必須ではない。

## 7. テスト

### 7.1 ユニット / コンポーネント（必須）

1. draft 表示中に callout 見出し・本文が出る。
2. 「この家族の設定を完了する」成功後、`setProgress` / `onDone` が**呼ばれない**。
3. 次アクションに「1人目の登録が完了しました」「献立を始める」「続けて家族を追加」が出る。
4. 「続けて家族を追加」で `createDraft` が呼ばれ、フォーム（callout 付き）に戻る。
5. 「献立を始める」で `setProgress("complete")` と `onDone` が呼ばれる。
6. 「あとで設定する（アイデアから始める）」で `setProgress("skipped")` と `onDone` が呼ばれる。
7. 完了 API 失敗時は次アクションに留まらず（またはフォームに残り）、既存エラー表示になる — 現行の complete 失敗パスを壊さない。
8. 既存の validation toast / field error / skip / 読込失敗のテストは回帰として維持。

### 7.2 E2E（存在する範囲）

- オンボーディング完了が即 planner 前提のアサーションがあれば、次アクション経由に更新する。
- 新規フル E2E は本設計の必須条件にしない（ユニットで契約を固定する）。

### 7.3 検証コマンド（実装時）

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

## 8. 受け入れ基準

- [ ] 初回フォームに「まずは1人分から…」callout が見える。
- [ ] 1人目完了直後に自動で献立へ進まない。
- [ ] 次アクションから「続けて家族を追加」で2人目入力に入れる。
- [ ] 次アクションから「献立を始める」で `complete` + planner に進める。
- [ ] skip 経路が次アクションでも使える。
- [ ] DB/API 契約・RLS・quota に変更がない。
- [ ] フォーカスされたテストと typecheck / lint / format:check が通る。

## 9. リスクと緩和

| リスク | 緩和 |
| --- | --- |
| E2E / 他テストが「完了即 planner」前提 | 失敗するテストだけ追随。過剰な E2E 新設はしない |
| 次アクションを挟み手順が増える | 主 CTA を「献立を始める」にし、1 タップで従来相当に到達可能 |
| complete と setProgress の分離で状態不整合 | complete メンバーがいても status が in_progress のままでよい（既存契約: complete 遷移時に1人以上を検査）。再訪時も次アクションから complete できる |
| 文言が長い | type-small / 段落分割。320px で折り返し確認 |

## 10. 決定事項まとめ

| 項目 | 決定 |
| --- | --- |
| 方針 | 完了後は遷移せず次アクション画面を挟む（Approach A） |
| 入力中 | 上部 callout 常時表示 |
| 完了後 | 献立を始める + 続けて家族を追加 + skip |
| API/DB | 変更なし |
| 設定画面 | 本設計の必須変更対象外（案内文言でのみ言及） |
