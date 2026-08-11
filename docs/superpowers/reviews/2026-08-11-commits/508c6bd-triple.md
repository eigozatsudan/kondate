# Triple review: `508c6bd`

**SHA:** `508c6bdfd7dd8ebcdefb2f589c7cd2998fb63504`  
**Subject:** `feat(e2e): 完了 onboarding を DB seed で用意する`  
**Parent:** `33c10be`  
**Worktree:** `/home/dev/projects/kondate`  
**Diff authority:** `.superpowers/sdd/review-33c10be..508c6bd.diff`（commit 単体 package）  
**重点:** seed と safety（portion/spice・privacy・service role）

---

## 1次レビュー

### 要約

`completedOnboardingPage` の UI 完了ウィザード（家族登録 → privacy 同意）を、service role による DB seed（`seedCompletedOnboardingState`）に置き換える。UI 経路の所有は `onboarding.spec` / full-journey household に残す。AI 枠 truncate は fixture 入口に残置（Task 8 へ defer、コメント明記）。

### 変更面

| ファイル | 内容 |
| --- | --- |
| `e2e/fixtures/seed-onboarding.ts` | **新規** `seedCompletedOnboardingState` |
| `e2e/fixtures/auth.ts` | `completedOnboardingPage` → seed + 既存 `resetGlobalAiQuotaForE2e` |

### Spec / 契約チェック

| 項目 | 判定 | 根拠 |
| --- | --- | --- |
| service role を page に載せない | **OK** | `.env` 読取 + JWT `sub` のみ。`page.evaluate` へ key 非渡与 |
| privacy 現行 version | **OK** | `privacyNoticeVersion`（`2026-07-29.v1`）を contracts から import |
| profile complete + `onboarding_completed_at` | **OK** | update で両方設定。error 時 throw |
| member ≥1 complete（allergy none） | **部分** | `status=complete` + age/allergy/diet。**`portion_size` / `spice_level` 欠落** |
| seed 後 `/planner` 固定 | **OK（弱）** | URL + メインナビ。onboarding 完了の DB 再読取 assert は無し |
| UI onboarding 維持 | **OK** | `completeMinimumOnboarding` export 維持。owning spec 非改変 |

### Findings

#### Important

**I1. seed の complete メンバーに `portion_size` / `spice_level` が無い（生成契約と不一致）**  
**Confidence: 93**

- **Where:** `seed-onboarding.ts` insert（status complete, age adult, allergy/diet none のみ）
- **Why:**
  - DB CHECK（complete 時）は age + allergy + diet のみ → insert は成功する。
  - 製品 RPC `complete_household_member`（`20260807000300_complete_member_require_portion_spice.sql`）と生成 `requireCompleteMember` / `memberFailure`（`generation-context.ts` L151–153）は **両 non-null 必須**。null → `invalid_request`。
  - UI 完了経路は adult defaults（`household-defaults.ts` → regular/regular）を保存していた。seed は「完了済み」を名乗るが **生成可能 complete ではない**。
- **緩和:** 多くの生成 E2E は settings 再編集で form defaults を書き戻し偶然緑。
- **残リスク:** seed 直後に household 生成する薄い経路・将来テストで false red / 偽 confidence。
- **Fix:** insert に `portion_size: "regular"`, `spice_level: "regular"`（adult 既定）。

#### Minor

- **M1.** profiles `.update` が 0 行でも `error: null`（PostgREST）。magic-link 後 profile 前提。
- **M2.** `/planner` assert は session があれば not_started でも成立し得る（RequireCompletedOnboarding 撤去後）。
- **M3.** AI truncate が fixture 入口に残る — Task 8  defer として意図的。

### 重点（本コミット範囲）

| 焦点 | 結果 |
| --- | --- |
| storageState 競合 | **N/A**（本 diff に setup/storageState なし） |
| dependsOn 二重 setup | **N/A** |
| seed と safety | **I1**（意味的 incomplete）。privacy/service role は健全 |
| AI truncate 位置 | fixture 入口維持（Task 8 前の意図的状態） |

### 1次判定: **REVISE**

Critical 0。I1 は Phase 2 seed の意味を製品契約より弱めるため Important でブロック。

---

## 敵対的レビュー

### 攻撃シナリオ

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| A1 | service role が page / log / evaluate に漏れる | **反証** | Node 側 `.env` のみ。JWT から `sub` のみ |
| A2 | 旧 privacy version ハードコード → 生成後段失敗 | **反証** | contracts 定数参照 |
| A3 | seed 不完全 → 生成 `invalid_request` false red | **成立（I1）** | portion/spice null のまま complete |
| A4 | seed 失敗を握りつぶして false green | **概ね反証** | member/privacy insert と profile update は error throw。0 行 update は M1 |
| A5 | UI onboarding 回帰が消える | **反証** | owning spec / export 維持 |
| A6 | allergy none 固定で安全保証を暗示 | **反証** | allergy none は「未登録」相当の最低 seed。製品は保証しない。小麦付与等は生成ヘルパ側 |
| A7 | fixture 入口 truncate が非生成 test を汚染 | **現行 workers=1 では低 / Task 8 対象** | 本 commit は意図的に維持 |

### 敵対判定: **BLOCK_WITH_CONDITIONS**

必須: I1（portion/spice）。秘密漏洩・privacy 誤版・UI 経路削除は成立せず。

---

## 2次検証

| 主張 | 判定 | 根拠 |
| --- | --- | --- |
| I1 portion/spice | **CONFIRMED** | seed insert キー欠落 + generation-context + migration 三層一致。成人 defaults = regular/regular |
| service role 境界 | **CONFIRMED OK** | package + live パターン同一 |
| privacy version | **CONFIRMED OK** | `privacyNoticeVersion` |
| Critical 過大なし | **CONFIRMED** | 秘密・データ破壊ではなく契約不完全 |
| M1/M2 | **CONFIRMED Minor** | 実害は magic-link 後前提 / RequireCompleted 撤去で弱 assert |
| Task 初回レビュー「Spec PASS」 | **PARTIAL 上書き** | Task 6 brief の最低カラムは DB 最小に寄せていたが、Spec §6.4「実装スキーマに合わせる」+ 生成可能 complete が製品契約。I1 を後から Important とするのは妥当 |

### 2次最終: **FIX_THEN_OK**

- **必須:** I1 portion/spice  
- **defer:** M1/M2、AI truncate 移動（Task 8）

---

## 統合結論

| 軸 | 結果 |
| --- | --- |
| Critical | 0 |
| Important | 1（seed portion/spice） |
| Minor | 3 |
| **Verdict** | **REVISE / FIX_THEN_OK**（後続 `9ebfe82` で I1 修正） |

PRIMARY_ADVERSARIAL_SECONDARY_COMPLETE
