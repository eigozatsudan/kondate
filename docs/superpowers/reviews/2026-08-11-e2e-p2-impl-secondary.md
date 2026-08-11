# 2次検証: Phase 2 実装レビュー

**Scope:** commits `508c6bd` / `eb57b3a` / `ab45e94`（`33c10be..ab45e94`）  
**Inputs:** primary `/tmp/grok-1000/e2e-p2-primary-9b487a87.md` · adversarial `/tmp/grok-1000/e2e-p2-adversarial-9b487a87.md` · package + live `/home/dev/projects/kondate`  
**Role:** secondary verifier（read-only）。CONFIRMED / PARTIAL / REJECTED + live evidence。

## Summary

1次と敵対的の **Critical なし** 判定は妥当。セキュリティ退行（service role 漏洩・privacy 誤版・fixture 入口 truncate・`dependencies` 二重 setup・storageState の git 追跡）は **反証を再確認**した。

**唯一のハード must-fix** は双方が指摘する seed の `portion_size` / `spice_level` 欠落（製品の complete/generate 契約と不一致）。  
smoke の常時 setup は Spec の括弧条件に対する **残渣（短縮逆行）** として CONFIRMED だが、§6.6 完了条件外であり I1 と同等ゲートにはしない。  
再生成 ensure 欠落と tracked-auth tooling は Spec/契約ギャップとして CONFIRMED。後者は §6.3 明示のため優先度を上げ、前者は現行 suite 実害が低いため defer 可。

**最終:** **FIX_THEN_OK**（I1 必須。I4 は §6.3 準拠として同 PR 推奨。I2/I3 は defer 可）

---

## Cross-walk

| ID | 出典 | 主張 | 判定 | 根拠（live） |
| --- | --- | --- | --- | --- |
| **I1 / Pri#1** | Both | seed complete メンバーに `portion_size`/`spice_level` なし → 生成契約不一致 | **CONFIRMED** | 下記 Focus 1 |
| **I2** | Adv only | smoke が reused 未使用なのに setup 必須 | **CONFIRMED（Important residual）** / **PARTIAL on hard-gate** | 下記 Focus 2。事実は成立。§6.6 ブロッカーへの昇格は過大 |
| **I3 / Pri minor** | Both | 再生成ヘルパが `ensureAiQuotaForGeneration` なし | **CONFIRMED（residual）** | 下記 Focus 3。契約穴は実在。現行 flaky 実害は低い → Primary の Minor 寄りの重みが妥当 |
| **I4 / Pri#2** | Both | Spec §6.3 tracked `e2e/.auth` tooling fail 未実装 | **CONFIRMED** | 下記 Focus 4 |
| Adv M1 | Adv | profile update 0 行検知なし | **CONFIRMED Minor** | `.update(...).eq("user_id")` のみ。PostgREST は 0 行でも `error: null` |
| Adv M2 | Adv | `/planner` assert は onboarding 完了の弱証明 | **CONFIRMED Minor** | `RequireCompletedOnboarding` 撤去済み（`src/app/router.test.tsx`）。session があれば `/planner` 滞在可 |
| Adv M3 | Adv | 素 Playwright で setup 前提が DX 不親切 | **CONFIRMED intentional** | サポート経路は `./scripts/run-e2e.sh`。欠陥ではなく運用境界 |
| Adv M4 | Adv | reused 汚染ガード静的なし | **CONFIRMED residual** | Spec §6.3 `@ephemeral-auth` allowlist は未実装。現状 consumers は `billing-plus` 表示系のみ |
| Critical 過大 | 焦点 | Critical が盛られていないか | **REJECTED（過大なし）** | 双方 Critical 空。妥当 |
| Service role | Both positive | page 非経由 | **CONFIRMED** | `seed-onboarding.ts` は Node `.env` + JWT `sub` のみ |
| privacy version | Both positive | 契約定数 | **CONFIRMED** | `privacyNoticeVersion` import |
| fixture truncate 除去 | Both positive | auth 入口から削除 | **CONFIRMED** | `auth.ts` L49–50 / L60 / L72 |
| setup モデル | Both positive | shell 1 回・`dependencies` なし | **CONFIRMED** | `playwright.config.ts` setup only `testMatch`；`run-e2e.sh` L466–472 |
| gitignore | Both positive | `e2e/.auth/` | **CONFIRMED** | `.gitignore` L15 |
| billing-plus reused | Both positive | 表示・mock のみ | **CONFIRMED** | `billing-plus.spec.ts` ヘッダ + `session-auth` only |

---

## Focus verifications

### 1. portion_size / spice_level — requireCompleteMember / complete_household_member

**CONFIRMED（Important, must-fix）**

| 層 | Live evidence |
| --- | --- |
| Seed insert | `e2e/fixtures/seed-onboarding.ts` L55–63: `status: "complete"`, `age_band: "adult"`, allergy/diet `none` のみ。**`portion_size` / `spice_level` キーなし**（null） |
| DB CHECK | `20260711000200_profiles_household_privacy.sql` L45–48: complete 時必須は `age_band` + `allergy_status` + `unsupported_diet_status` のみ。portion/spice は enum null 可（L25–26）→ **insert は成功する** |
| UI 完了 RPC | `20260807000300_complete_member_require_portion_spice.sql` L18–20: `portion_size is not null and spice_level is not null` |
| 生成 | `netlify/functions/_shared/generation-context.ts` L151–153 / L158–171: `memberFailure` / `requireCompleteMember` が両方 null → `invalid_request` |
| UI 既定 | `household-defaults.ts` adult → `regular`/`regular`。onboarding は age 選択時 `...defaultsForAgeBand(ageBand)` を save（`household-onboarding-page.tsx` L827）。settings 再読込は null を defaults で埋める（`household-settings-schema.ts` L164–165） |
| 現行 suite が緑な理由 | `seedGeneratedMenu` / `completeMinimumPlanner` / `ensurePlannerReady` / `flows` は settings で editor を開き「この家族の設定を完了」→ form defaults が portion/spice を書き戻す。**seed 単体の正しさは証明されていない** |
| 再編集なし経路 | `menu-domain-pantry.spec.ts` `advanceToReviewWithHousehold` は seed メンバーを選択するのみ（AI generate しない）→ 現状緑だが **generate 直前契約の穴は残る** |

Plan Task 6 / Spec §6.4 は「実装スキーマに合わせる」「不足カラムは埋める」。DB CHECK 最小ではなく **生成可能な complete** が製品契約。Primary conf 93 / Adv 92 → **二次も ≥90 で支持**。

**Fix（最小）:**

```ts
portion_size: "regular",
spice_level: "regular",
```

（adult defaults と一致。可能なら seed 後 admin select で non-null assert）

---

### 2. Smoke always runs setup — Important?

**CONFIRMED as waste; PARTIAL as merge-blocker**

| 主張 | Live evidence |
| --- | --- |
| Spec 文言 | Spec §6.3 smoke 枝: `run_playwright --project=setup  # 1 回（reused fixture を使う smoke がある場合）` → **条件付き** |
| 実装 | `scripts/run-e2e.sh` L472: suite 分岐の **前** に常時 `run_playwright --project=setup \|\| return $?`。smoke 枝（L474+）でも回避なし |
| reused 消費者 | `billing-plus.spec.ts` のみ `session-auth` / `reusedCompletedPage`。`e2e-smoke-tags.test.mjs` が billing-plus を **@smoke 0・full-only** 固定 |
| smoke セット | foundation / oauth / full-journey / auth-* / generation / shopping / history / pantry / onboarding / settings / mobile-a11y 320 等 → すべて ephemeral `auth.ts` |
| tooling が常時 setup を固定 | `local-development-scripts.test.mjs` / `compose.test.mjs` が smoke = setup + mobile をゴールデン化 |

- **破壊リスク:** 低（setup 失敗は fail-closed。smoke 本体は storageState 非依存）
- **短縮目的:** setup = magic-link + seed + write → **純粋コスト増**。Adv I2 conf 95 の事実認定は支持
- **ゲート昇格:** Adv の「マージ前必須 I2」は **PARTIAL 却下**。§6.6 完了条件に smoke setup スキップは無い。設計二次レビューも「smoke 時 setup 1 回 **or** ephemeral のみを 1 行固定」— 実装は常時 setup で 1 方式に固定済み（無駄だが仕様として閉じている）。Plan Task 7 例も smoke で setup を常時描いている

**扱い:** Important residual。修正（smoke で setup スキップ **または** 読み取り smoke を reused へ 1 本）か **明示受容** のどちらかでよい。I1 と並列の hard must-fix にはしない。

---

### 3. ensureAiQuota missing on regeneration helpers

**CONFIRMED residual（Important-low / not blocking）**

| Helper | ensure? | File |
| --- | --- | --- |
| `seedGeneratedMenu` | **yes** L171 | `e2e/fixtures/history.ts` |
| `seedGeneratedIdeaMenu` | **yes** L372 | same |
| `requestWholeRegeneration` | **no** L330–344 | same |
| `requestDishRegeneration` | **no** L350–363 | same |
| `submitRegenerationSheet` | **no** L300–323 | same |
| `generateShoppingMenu` | **yes** L71–72 | `e2e/fixtures/shopping.ts` |
| `regenerateWholeMenu` | **no** L137–158 | same |
| `completeMinimumPlanner` / full-journey 初回 / flows | **yes** | specs / shots |

呼び出し側パターン:

- `history-regeneration.spec.ts`: 常に `seedGeneratedMenu` → regen（直前 truncate 済み）
- `shopping-list*.spec.ts`: `generateShoppingMenu` 後に `regenerateWholeMenu`
- `full-journey`: 初回 generate 前に ensure；同一 test 内で後続 regen

Phase 2 契約（§6.5）は「外部 AI 送信直前のみ ensure」。再生成も外部 AI 送信なので **ヘルパ契約としては穴**。  
workers=1・GLOBAL 20・同一 test 内 2–3 回では枯渇しにくい → Primary の「Minor / 実害低」が二次でも妥当。Adv conf 82 の「回帰しやすい契約抜け」も事実だが **Phase 2 完了ブロッカーではない**。

**Fix（defer 可）:** `submitRegenerationSheet` 入口または各 public regen helper 先頭で `ensureAiQuotaForGeneration()`。

---

### 4. tracked e2e/.auth tooling fail — Spec mandated?

**CONFIRMED**

- Spec §6.3 原文: **「Gitignore: `e2e/.auth/`。tracked されていれば tooling で fail。」**
- `.gitignore` に `e2e/.auth/` **あり**（L15）
- `tests/tooling/**` に `e2e/.auth` / `git ls-files` / storageState tracked 検査 **0 件**
- `project-config.test.mjs` の ignore 共通リストにも **未収録**

gitignore だけでは `git add -f` を fail-closed できない。セッショントークン成果物なので Spec が tooling を要求した意図は妥当。  
§6.6 チェックリストには明示行が無いが、§6.3 の setup 設計条項として **Important・同 PR 推奨 must-fix**。

**Fix:** tooling で `git ls-files e2e/.auth` が空、または ignore リストに `e2e/.auth/` を必須化（両方推奨）。

---

### 5. Any Critical overstated?

**なし（REJECTED: 過大 Critical 無し）**

双方 Critical 空。以下の敵対シナリオは二次でも **反証**:

| シナリオ | 二次 |
| --- | --- |
| service role → page | 反証（Node only） |
| privacy 旧 version | 反証（contracts 参照） |
| auth fixture truncate 退行 | 反証 |
| setup × dependsOn 二重 | 反証（dependencies なし） |
| storageState が tracked 既定 | 反証（gitignore）。tooling 未実装は Important 残渣 |
| seed CHECK 違反で insert 失敗 | 反証（CHECK は portion 非要求）。意味的不完全は I1 |

I1 を Critical に上げる必要も **ない**（現行 suite は re-edit で緑・秘密漏洩やデータ破壊ではない）。Important が正しい。

---

## Must-fix (prioritized)

1. **[P0] Seed に `portion_size` / `spice_level` を adult 既定で明示**（I1 / Pri#1）  
   - File: `e2e/fixtures/seed-onboarding.ts` insert  
   - 任意: seed 後 non-null assert  
   - 理由: 製品 `requireCompleteMember` + `complete_household_member` と一致させる。false-confidence の温床

2. **[P1] Spec §6.3 tracked `e2e/.auth` tooling fail**（I4 / Pri#2）  
   - `git ls-files e2e/.auth` empty、および/または ignore リスト固定  
   - 理由: Spec 明示。gitignore 単独では force-add を止められない

---

## Safe to defer

| ID | 内容 | なぜ defer 可 |
| --- | --- | --- |
| **I2** | smoke 常時 setup | 正しさではなくコスト。§6.6 外。明示受容 or 後続で skip/reused-smoke |
| **I3** | regen ensure | 現行 callers が直前 seed/ensure 依存。workers=1 で実害低。Phase 3 前にヘルパ寄せ推奨 |
| **M1** | profile 0-row | magic-link 後 profile 前提。`.select()` で強化可 |
| **M2** | planner 弱 assert | status を admin で再読取すれば強化可 |
| **M3** | 素 PW DX | 意図的 fail-closed |
| **M4** | ephemeral allowlist | Spec 将来項目。現状 reused 1 ファイル・破壊なし |
| full 壁時計 / 2× green | §6.6 実測 | 本レビュー静的範囲外（Primary も未計測と明記） |

---

## Positive re-confirmed（回帰していない）

1. setup = shell 1 回、Playwright `dependencies` なし、`--project=setup` のみは二重回避  
2. setup 失敗 fail-closed（`|| return $?`）  
3. `completedOnboardingPage` → seed、UI onboarding は owning spec 維持  
4. auth / completed / idea fixture 入口から AI truncate 削除  
5. 主要 **初回** generate 経路に ensure 配置  
6. privacy = `privacyNoticeVersion`、service role 境界健全  
7. `billing-plus` は表示・route mock のみ reused  

---

## Final: **FIX_THEN_OK**

- **Fix 必須:** seed の portion/spice（P0）。  
- **強く推奨（§6.3）:** tracked `e2e/.auth` tooling（P1）。  
- **I2/I3 は defer 可**（I2 は受容メモでも可）。  
- Critical 過大なし。1次 REVISE / 敵対 BLOCK_WITH_CONDITIONS のうち、**I1 必須は支持**、**I2 を I1 級ゲートにするのは PARTIAL 却下**。

---

SECONDARY_REVIEW_COMPLETE
