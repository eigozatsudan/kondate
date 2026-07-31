# Adversarial Review: 対象外食事 copy + 追加前ダイアログ (implementation)

**Branch:** feat/unsupported-diet-copy-clarity @ c6a1363  
**Stance:** adversarial product + safety + a11y + test holes  
**Date:** 2026-07-31  
**Range:** `9ef6c9e..c6a1363`  
**Authorities:** design r2, design-time adversarial (I1–I7), plan Tasks 1–4

## Summary

実装は設計 r2 の本線（共有 copy・追加前 dialog・親質問3種別スコープ・個人向け非対応主文・settings present 説明・E2E 必須経路追随・enum/DB 不変）をほぼ字義どおり満たす。旧入力面文言は `src/features/household/**` でゼロ、OK で status を `present` にしない、settings は `creatingDraftRef` で single-flight を担保。

**残る実害候補は onboarding 側の single-flight が `isPending` のみで、settings の ref ガードと非対称な点。** 設計 §5.3.9 / §9 が要求する「OK 連打で createDraft を二重に呼ばない」を、onboarding は同期ガードなしで満たしきれない。

| 重大度 | 件数 |
|--------|------|
| Critical | 0 |
| Important | 1 |
| Minor | 4 |

**Verdict: Request changes**（I-1 の onboarding single-flight を settings と同型の同期 ref にするまで）

---

## Design r2 absorption check (I1–I7)

| ID | Design requirement | Code status | Evidence |
|----|-------------------|-------------|----------|
| I1 | 親質問を3種別スコープ + 直下にアレルギー／苦手ヘルプ常時 + validate/未確認語揃え | **Implemented** | `unsupported-diet-copy.ts:6-20`; settings `household-settings-page.tsx:1608-1640`; onboarding `household-onboarding-page.tsx:850-887,946-947`; validate `household-onboarding-page.tsx:95-101` + schema `household-settings-schema.ts:22-35` |
| I2 | ダイアログ主文を個人向け非対応 / 他家族は可 | **Implemented** | `ADD_SCOPE_NOTICE_BODY` `unsupported-diet-copy.ts:28-29`; dialog body both pages; unit asserts 個人向け/他の家族向け |
| I3 | a11y: Escape・backdrop 非クローズ・trigger focus・single-flight・見出し契約 | **Partial** | role/dialog/aria-modal/aria-labelledby/h2、Escape effect、backdrop に onClick なし、focus 主ボタン+cleanup で trigger 復帰は両ページ実装。**onboarding single-flight は isPending のみ → I-1** |
| I4 | E2E 必須ファイル固定 + `confirmAddScopeNotice` | **Implemented** | `e2e/fixtures/household.ts`; auth/history/onboarding/settings/menu-domain-pantry 追随。旧 label ヒットなし |
| I5 | 旧文言ゼロは `src/features/household/**` のみ | **Implemented** | 旧「食べない食事はありますか」等は household 内ゼロ。年齢帯「離乳食完了後〜2歳」は別概念で正当残置 |
| I6 | onboarding local validate も共有定数 | **Implemented** | `household-onboarding-page.tsx:95-101` → `UNSUPPORTED_DIET_*_REQUIRED` |
| I7 | 空状態ヘルプをダイアログ前提に更新 | **Implemented** | `UNSUPPORTED_DIET_EMPTY_ADD_HELP`; settings empty `household-settings-page.tsx:1244` |

M1–M3（編集はフォーム説明頼み / ul·li / UI refresh 権威）は設計固定どおり。present fieldset 説明は settings に追加済み (`household-settings-page.tsx:1656`)。

---

## Attack scenarios & findings

### Critical

なし。

- enum / DB / medical-scope / 生成エラーキーは差分に含まれない。
- ダイアログ OK は `createDraft` / `startMutation.mutate` のみ。status を `present` に自動設定しない（settings `household-settings-page.tsx:766-769`、onboarding `household-onboarding-page.tsx:287-292`）。
- present 選択時の保存値は引き続き `weaning_food` 等の英語キー（unit 維持）。
- 新規の diet kind の console/telemetry ログなし。

### Important

#### I-1. Onboarding の追加前 OK が同期 single-flight を持たない

- **Scenario:** オンボーディングで「登録を続ける」を押すと dialog を先に閉じ、`startMutation.mutate()` する。`isPending` は React Query の再レンダー後にしか true にならない。cleanup で trigger（「家族設定を始める」/「続けて家族を追加」）へ focus が戻るが、その時点で trigger の `disabled={startMutation.isPending}` がまだ false の窓がある。連打・Enter リピート・ダイアログ消失直後の Space で `openAddScopeNotice` → 再度 OK すると **createDraft が二重**になり得る。settings は `creatingDraftRef` を `requestCreateDraft` 内で同期的に立て、`openAddScopeNotice` も同 ref を見る。
- **Evidence:**
  - onboarding: `household-onboarding-page.tsx:282-292`（guard は `startMutation.isPending` のみ）、`548-554` / `607-610`（trigger disabled も isPending）
  - settings 対比: `household-settings-page.tsx:755-764`（`creatingDraftRef` 同期）
  - 設計: §5.3.9 single-flight、§9「OK 連打でも createDraft / start は1回」
- **Impact:** 下書きメンバーが二重作成される。名簿ノイズ・sort_order ずれ・利用者が「なぜ2人？」と混乱。安全ゲート破壊ではないが、追加前 UX の契約違反。
- **Suggested fix:** settings と同型の `startingDraftRef`（または `createDraftInFlightRef`）を onboarding に置き、`confirmAddScopeNotice` / `openAddScopeNotice` の両方で同期チェック。`onSettled` で下ろす。unit で「登録を続ける」連打 → `createDraft` 1 回を固定。

### Minor

#### M-1. Onboarding に Escape / OK 連打の unit が無く、settings とのテスト非対称

- **Scenario:** settings は Escape で API 未呼び出しを固定（`household-settings-page.test.tsx` 「closes add-scope notice on Escape…」）。onboarding は cancel ボタンのみ。設計 §9 は Escape と OK 連打を明示。
- **Evidence:** onboarding tests: cancel のみ `household-onboarding-page.test.tsx:586-602`；Escape / double-OK なし。
- **Impact:** I-1 や Escape 退行を CI が検知しない（偽の安心）。
- **Suggested fix:** Escape で dialog 閉・`createDraft` 未呼出；OK 連打で 1 回、を onboarding に追加。

#### M-2. Onboarding cancel テストが dialog 閉鎖を assert しない

- **Scenario:** 「やめる」後に `createDraft` 未呼出のみ。dialog が残ってもパスし得る。
- **Evidence:** `household-onboarding-page.test.tsx:600-602` vs settings `1313-1314`（queryByRole dialog で閉鎖確認）。
- **Impact:** 低。実装は `setAddScopeNoticeOpen(false)` している。
- **Suggested fix:** settings と同様に dialog 非存在を assert。

#### M-3. E2E が「続けて家族を追加」経路を踏まない

- **Scenario:** 設計 §5.1 の3トリガーのうち、E2E 必須リストは onboarding 開始と settings 追加をカバー。次アクションの「続けて家族を追加」は unit のみ（`household-onboarding-page.test.tsx:575-583`）。`onboarding.spec.ts` はボタン可視まで。
- **Impact:** 本番 onboarding の第2メンバー追加で helper 未追随があっても E2E 緑のまま。現状 unit + 同一 dialog コンポーネント共有で緩和。
- **Suggested fix:** onboarding.spec に「続けて家族を追加」→ `confirmAddScopeNotice` → フォーム表示を1本追加（任意フォロー）。

#### M-4. Focus trap なし（削除確認と同型・設計上の残余）

- **Scenario:** `aria-modal="true"` だが Tab で背面へ抜けられる。削除確認も同型。
- **Evidence:** add-scope / delete とも `pantry-expired-dialog-backdrop` + 手動 focus のみ（`household-settings-page.tsx:777-816`, `1853-1894`）。
- **Impact:** SR/キーボード利用者の混乱。設計が「削除確認と同等」まで必須としており、trap 必須ではない。
- **Suggested fix:** 本チケット外。削除確認とまとめて focus trap を取るなら別タスク。

---

## Residual accepted risks

| 残余 | 内容 | 根拠 |
|------|------|------|
| 毎回ダイアログ | 該当なし多数派にも毎回 | 設計 §4 / §10 固定 |
| 編集 none→present | 追加時 dialog なし。フォーム present 説明頼み | 設計 §4 / §10 / M1。settings に `UNSUPPORTED_DIET_PRESENT_HELP` 追加済み |
| present でもフル入力 | アレルギー等を省略しない | 設計 §3 非目標 |
| planner / 緊急献立の旧表現 | 旅程用語のゆれ | 設計 §3 / §8.3 非目標 |
| 自己申告で「該当なし」 | 生成側で全ては防げない | 従来どおり |
| settings に unconfirmed ヘルプ行なし | onboarding のみ `UNSUPPORTED_DIET_UNCONFIRMED_HELP` 表示 | 設計 §8.2 は settings に present 説明追加を要求。unconfirmed 行は settings 既存 UI にも無かった |
| UI refresh 文書の旧文言 | docs に歴史として残る | 設計 §12 で本設計が入力面優先 |

---

## What was verified clean

| 観点 | 結果 |
|------|------|
| 共有 copy リテラル = 設計 r2 | `unsupported-diet-copy.ts` + lock test |
| schema + onboarding validate 同一メッセージ | schema import + onboarding validate 定数 |
| settings / onboarding ダイアログ copy ドリフト | 同一 `ADD_SCOPE_NOTICE_*` |
| 旧文言ゼロ (household) | grep: 旧親質問・旧 kind・旧 validate ヒットなし |
| E2E 必須ファイル | auth, history, onboarding, settings, menu-domain-pantry + helper |
| OK → present 自動設定なし | confirm は draft 作成のみ |
| 生成拒否・enum 不変 | 差分に safety/contracts/DB なし |
| Privacy | diet kind の新規ログなし |
| Backdrop click 非クローズ | backdrop に close handler なし |
| settings Escape / cancel / edit 非表示 | unit あり |
| 空状態ヘルプ | 確認ダイアログ前提の新文 |

---

## Verdict

**Request changes**

必須: **I-1** — onboarding に settings と同型の同期 single-flight（ref）を入れ、OK 連打で `createDraft` が1回であることを unit で固定する。

I-1 修正後は **Approve with nits**（M-1〜M-4）でよい。Critical はなし。安全ゲート（present 生成除外・enum・OK で present にしない）は健全。
