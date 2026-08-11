# 1次レビュー: Phase 2 E2E 短縮 実装

## Summary

対象は `33c10be..ab45e94`（Task 6–8: seed onboarding / setup+storageState / AI 枠 reset 範囲縮小）。

- `completedOnboardingPage` は DB seed に切替、UI onboarding は `onboarding.spec` / full-journey household が維持。
- setup project は `dependencies` なし。`run-e2e.sh` が setup を fail-closed で 1 回実行。
- `billing-plus` は `reusedCompletedPage`（表示・mock のみ）へ移行。破壊的系は ephemeral のまま。
- auth fixture 入口の truncate は削除。主要 generate 経路には `ensureAiQuotaForGeneration` を配置。

**ブロッキング:** seed の `household_members` が製品の complete 契約（`portion_size` / `spice_level` 必須）を満たしていない。生成 API の `requireCompleteMember` と `complete_household_member` RPC と不整合。現状の多くの生成テストは settings 再保存で偶然補っているが、seed の契約としては不十分で、再保存しない household 生成経路は `invalid_request` になる。

## Verdict: REVISE

## Findings

### Important

#### 1. seed の complete メンバーに `portion_size` / `spice_level` が無い  
**Confidence: 93**

- **File:** `e2e/fixtures/seed-onboarding.ts`（insert 付近 L55–65）
- **問題:**  
  `status: "complete"` で insert しているが `portion_size` / `spice_level` が null。  
  - 生成: `netlify/functions/_shared/generation-context.ts` の `memberFailure` / `requireCompleteMember` は両方が null なら `invalid_request`（U4-001 / H16）。  
  - UI 完了 RPC: `complete_household_member` は両方が NOT NULL を要求（`20260807000300_complete_member_require_portion_spice.sql`）。  
  - 旧 UI fixture（`completeMinimumOnboarding`）はフォーム既定（adult → regular/regular）を保存してから complete していた。  
  - Task 6 / Spec §6.4 は「実装スキーマに合わせる」「不足カラムは埋める」。DB CHECK は portion を complete 時に強制しないため insert は通るが、**生成可能な完了状態**にはなっていない。
- **現状の緩和:** full-journey / seedGeneratedMenu / ensureWheat / completeMinimumPlanner 等は settings 再保存で form 既定を書き戻しており、多くの経路は偶然緑になり得る。
- **残リスク:** seed 直後に household 生成する経路・shots・将来の薄いテストは偽 red。seed の意味（完了済み前提）が製品契約とずれる。
- **修正案:** adult 既定に合わせて seed に明示する。

```ts
portion_size: "regular",
spice_level: "regular",
// 必要なら defaultsForAgeBand("adult") と揃える ease / safety も
```

参照: `src/features/household/household-defaults.ts`（adult → regular/regular）。

#### 2. Spec §6.3 の「`e2e/.auth/` が tracked なら tooling fail」が未実装  
**Confidence: 86**

- **File:** `.gitignore` には `e2e/.auth/` あり。`tests/tooling/*` に同パスの tracked 検査なし（`project-config.test.mjs` の ignore 一覧にも未収録）。
- **問題:** Spec §6.3: *Gitignore: `e2e/.auth/`。tracked されていれば tooling で fail。*  
  storageState はセッショントークンを含む。gitignore だけでは force-add / 設定ミスを fail-closed にできない。
- **修正案:**  
  - tooling で `git ls-files e2e/.auth` が空であること、または `.gitignore` に `e2e/.auth/` が必須であることを assert。  
  - 可能なら `project-config` の ignore 共通リストへ追加。

### Minor（参考・≥80 未満のため非ブロッキング）

- **再生成ヘルパに `ensureAiQuotaForGeneration` が無い**（`regenerateWholeMenu` / `requestWholeRegeneration` / `requestDishRegeneration`）。Task 8 の「外部 AI 送信直前」文言には該当するが、workers=1・各テスト先頭の seed/ensure がある現状では GLOBAL 20 枯渇の実害は低い（同一テスト内 2–3 回程度）。Phase 3 前にヘルパへ寄せると安全。
- **`@ephemeral-auth` allowlist 静的テスト**は Spec §6.3 に記載あるが §6.6 完了条件外。現状破壊的 spec は `session-auth` を使っておらず実害なし。
- **`completeMinimumPlanner` の ensure がウィザード前**にあり「送信直前」より早い。workers=1 では問題になりにくい。

## Spec §6.6 checklist

| 条件 | 判定 | 根拠 |
| --- | --- | --- |
| setup + storageState が緑（≥1 ファイル reused） | **実装上 OK（実行 grean は本レビュー未計測）** | `billing-plus.spec.ts` → `reusedCompletedPage`。`auth.setup.ts` + `session-auth.ts` + shell setup 1 回 |
| completed onboarding seed が `completedOnboardingPage` 既定 | **部分** | seed 経路は正しいが portion/spice 欠落（Finding 1） |
| UI onboarding が owning spec でカバー | **OK** | `onboarding.spec.ts` は UI のまま。full-journey household も settings 実操作 |
| 非生成 test が fixture 入口で truncate しない | **OK** | `authenticatedPage` / `completedOnboardingPage` / `ideaModePage` から truncate 削除 |
| full 実測が Phase 1 より改善・目安 ≤15 分 | **未検証** | 本レビューは静的。壁時計は別途 |
| flaky 増なし（2 連続 full green 推奨） | **未検証** | 同上 |

### フォーカス項目への回答

| # | 項目 | 結果 |
| --- | --- | --- |
| 1 | seed: privacyNoticeVersion / profile complete / member complete / no service key on page | privacy は `privacyNoticeVersion`（`2026-07-29.v1`）使用。profile は `complete` + `onboarding_completed_at`。member は status complete だが **portion/spice 欠落**。service key は `.env` のみ・page 非渡与 **OK** |
| 2 | completedOnboardingPage が seed / UI path 維持 | **OK** |
| 3 | setup without dependsOn / run-e2e always setup first / gitignore | **OK**（tooling tracked 検査は未） |
| 4 | storageState 汚染 / ephemeral 隔離 | billing-plus は mock 表示のみ・削除確定なし。account-deletion 等は auth.ts のまま **OK** |
| 5 | ensure は生成直前のみ / auth fixture に truncate なし | **OK**（主要 generate 経路）。再生成ヘルパは未 |
| 6 | Missing ensure → global flaky | 初回 generate ヘルパ/spec は概ねカバー。**再生成のみ**ギャップ（実害は現状低） |
| 7 | setup failure fail-closed | `run_playwright --project=setup \|\| return $?` **OK** |
| 8 | billing-plus reused 正しさ | 表示 + route mock、共有ユーザでも DB 課金状態を汚さない設計 **OK** |

## Positive notes

- Spec §6.3 の実行モデルを正しく実装: Playwright `dependencies` なし、shell が setup を 1 回、`--project=setup` のみの二重起動回避、setup 失敗で後続を走らせない。
- `privacyNoticeVersion` を contracts から参照し、ハードコード複製を避けている。
- service role を page に渡さず JWT `sub` で user_id を取るパターンは `acceptance.ts` と整合。
- auth fixture から AI 枠 truncate を外し、生成直前へ寄せた方針は Phase 2 §6.5 と一致。
- `billing-plus` 移行範囲が「表示系のみ」に限定され、破壊的テストを storageState に載せていない。
- tooling（`compose.test.mjs` / `local-development-scripts.test.mjs`）が setup 前置シーケンスを固定している。
- UI onboarding owning path を seed に置き換えていない。

---

PRIMARY_REVIEW_COMPLETE
