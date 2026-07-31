# Primary Review: 対象外食事 copy + 追加前ダイアログ

**Branch:** feat/unsupported-diet-copy-clarity @ c6a1363  
**Range:** 9ef6c9e..c6a1363  
**Stance:** primary design compliance + quality  
**Date:** 2026-07-31

## Summary

4 commits（copy 単一ソース → settings → onboarding → E2E）は設計 r2 / 実装計画の固定範囲に収まっている。確定文言は `unsupported-diet-copy.ts` に集約され、schema・onboarding ローカル validate・両 UI が同一定数を参照する。追加前ダイアログはトリガー3種すべてで `createDraft` / `startMutation` の前に入り、a11y は削除確認と同型（`role=dialog` / `aria-modal` / 見出し契約 / Escape / backdrop 非クローズ / 主ボタン focus / trigger 復帰 / 44px 系ボタン）。enum・DB・生成拒否は非変更。旧入力面文言は `src/features/household/**` に残っていない。

Household Vitest は独立報告どおり 131/131 @ HEAD。E2E 実行自体は本レビュー範囲外（静的追随は完了）。

**判定: Approved** — Critical / Important なし。

## Spec coverage matrix

| Design/plan requirement | Status | Evidence |
|---|---|---|
| §8.1 表示 copy 単一ソース | Met | [`unsupported-diet-copy.ts`](../../src/features/household/unsupported-diet-copy.ts) L6–38。schema / onboarding validate / 両 page が import |
| §6 親質問・直下ヘルプ・legend・kind 3語・present 説明 | Met | copy 定数と設計表が一致。settings L1609–1656 / onboarding L849–892 |
| §6 未確認・validate・導入文・空状態ヘルプ | Met | onboarding unconfirmed L946–947; schema L22/L35; intro L679; empty help settings L1244 |
| §6 status 表示語（該当なし/あり/未確認）据え置き | Met | 両 form の option 文言未変更 |
| §6 superRefine 矛盾メッセージ据え置き | Met | schema L42–43「対象外状態と項目を確認してください」 |
| I6 onboarding ローカル validate も共有定数 | Met | onboarding `validateOnboardingDraft` が `UNSUPPORTED_DIET_STATUS_REQUIRED` / `KINDS_REQUIRED` |
| §5.1 トリガー3種・編集では出さない | Met | settings 空/一覧「家族を追加」; onboarding「家族設定を始める」「続けて家族を追加」; 編集は dialog 非表示 unit あり |
| §5.1 OK=下書き作成のみ / やめる・Escape=ネットなし | Met | `confirm*` → draft only; cancel/Escape は setState のみ。unit: cancel + Escape (settings) / cancel (onboarding) |
| §5.1 毎回出す（スキップ設定なし） | Met | 永続フラグなし。開くたび `addScopeNoticeOpen` |
| §5.1 OK で status を present にしない | Met | confirm 経路に status 書込なし（コメントで §7 明示） |
| §5.2 ダイアログ確定文言 | Met | `ADD_SCOPE_NOTICE_*` が設計と同一。copy test で固定 |
| §5.3 a11y 1–10 | Met | backdrop + dialog + `aria-labelledby`/`h2` + `ul`/`li` + `min-h-11` + continue focus + trigger restore + Escape + no backdrop close + single-flight（settings: `creatingDraftRef`; onboarding: `isPending`） |
| §7 挙動不変（enum/生成拒否） | Met | kind キー `weaning_food` 等のまま unit 維持。domain/medical-scope/migration 非接触 |
| §8.2 変更対象ファイル固定 | Met | 13 files = 計画リスト + 新規 copy/test + household fixture。範囲外への拡散なし |
| §8.2 E2E ヘルパー集約 | Met | [`e2e/fixtures/household.ts`](../../e2e/fixtures/household.ts) `confirmAddScopeNotice`; auth/history/onboarding/settings/menu-domain-pantry が使用 |
| §9 旧文言ゼロ（household のみ） | Met | `食べない食事はありますか` 等の grep ヒットなし（本番・テスト期待） |
| §9 kind 保存値回帰 | Met | onboarding present→kinds `weaning_food` assert 維持 |
| Plan T1 schema メッセージ共有 | Met | copy.test schema safeParse で定数メッセージを検証 |
| Plan T2 settings ダイアログ + 文言 | Met | page + 拡張 unit（open/cancel/Escape/edit 非表示/createDraft 経路） |
| Plan T3 onboarding ダイアログ + 文言 | Met | page + unit（start cancel / next-action OK 後 createDraft） |
| Plan T4 E2E 必須ファイル | Met | 静的更新済み。実行は residual |

## Strengths

1. **文言の単一ソースが徹底**されている。Zod・onboarding ローカル validate・両 UI・E2E ラベルが同じ定数／部分一致に揃い、二重定義の再発余地が小さい。
2. **追加前ダイアログの責務分離**が設計どおり（入口＝個人向け非対応＋他家族は可＋名簿明示／フォーム＝該当あり＝この人向けは作れない）。present 説明を settings にも追加し、編集経路（ダイアログなし）の M1 リスクをフォームで担保。
3. **settings の single-flight** は既存 `creatingDraftRef` を再利用しており、OK 連打と作成中の再 open の両方に効く。
4. **テストが経路を押さえる**: createDraft が dialog OK 前に呼ばれないこと、cancel/Escape で API なし、編集で非表示、旧ラベル置換、schema 定数利用。E2E は必須ファイルを helper 経由で追随。
5. **スコープ規律**: `shared/`・Functions・DB・planner 拒否 copy に触れていない。

## Issues

### Critical

（なし）

### Important

（なし）

### Minor

#### M1 — onboarding の single-flight が `isPending` スナップショット依存  
**File:** `src/features/household/household-onboarding-page.tsx:287–292`  
**Confidence:** 82  

設計 §5.3-9 は「OK 連打で start を二重に呼ばない」を要求し、手段として `startMutation.isPending` を許容している。実装はその最小形:

```ts
if (startMutation.isPending) return;
setAddScopeNoticeOpen(false);
startMutation.mutate();
```

settings 側は同期 `creatingDraftRef` でガードしている（`household-settings-page.tsx:755–769`）。同一イベントループ内で主ボタンが二度発火した場合、onboarding は render スナップショットの `isPending === false` のまま二度 `mutate()` し得る。実ユーザの二度押しでは re-render 後に dialog が消えるため再現は稀だが、settings と非対称で、二重 draft の理論窓が残る。

**Suggested fix:** settings と同型の `startingDraftRef`（または confirm 先頭で同期セットする flag）を onboarding にも置き、`mutate` 前に立てる。

#### M2 — onboarding unit が settings より薄い（Escape・dialog 本文）  
**File:** `household-onboarding-page.test.tsx`（新規 it 付近 L389–406 相当）  
**Confidence:** 88  

settings は Escape で close・API なし、dialog 本文（個人向け／他家族向け）を assert。onboarding は「家族設定を始める → やめる → createDraft なし」と next-action の OK 経路のみ。実装の Escape effect（`household-onboarding-page.tsx:266–279`）は settings と同型だが、回帰ネットが片側だけ厚い。

**Suggested fix:** settings の Escape it と dialog 本文 assert を onboarding にも1本ずつ移植する（必須ではないが対称性が上がる）。

#### M3 — 追加前 dialog マークアップが settings / onboarding で二重  
**File:** `household-settings-page.tsx:777–816` / `household-onboarding-page.tsx:300–339`  
**Confidence:** 90  

計画は抽出任意としており仕様違反ではない。a11y 契約や文言バインドが2箇所にあり、将来の見出し契約変更時に片側漏れのリスクがある。

**Suggested fix:** 同ディレクトリに `AddScopeNoticeDialog` を切り、open/confirm/cancel/continueRef を props で渡す（フォローアップで可）。

## Open residual gates

| Gate | Status | Notes |
|---|---|---|
| Household Vitest | Pass (reported) | 131/131 @ HEAD（本レビューでは未再実行） |
| typecheck / lint / format:check | 実装セッション前提 | 本レビューでは未再実行 |
| E2E runtime（§8.2 必須 spec） | Deferred | fixture/spec 静的追随は完了。`./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts e2e/specs/settings.spec.ts`（必要なら menu-domain-pantry）は人間/Verifier 実行待ち |
| 旧文言ゼロ（e2e） | Pass (static) | `食べない食事はありますか` は e2e からも除去済み |
| enum/DB/medical-scope | N/A | 差分に含まれず |

## Verdict

**Approved**

Critical: 0 / Important: 0 / Minor: 3

設計 r2 の入力面・追加前ダイアログ・共有文言・E2E 静的追随は満たしている。M1–M3 はフォローアップ推奨の品質・対称性メモであり、マージブロックにはしない。E2E 実行結果だけ residual として残す。
