# 敵対的レビュー: Phase 2 E2E 短縮 実装

**Scope:** commits `508c6bd`, `eb57b3a`, `ab45e94`（package `/tmp/grok-1000/e2e-p2-impl-review-9b487a87/` / live `/home/dev/projects/kondate`）  
**観点:** false green、shared storageState 汚染、seed 不完全、quota race、setup 二重実行、privacy version、service role 漏洩

## Summary

Phase 2 の三本柱（DB seed による completed onboarding、setup/`storageState` による認証再利用、生成直前のみの AI 共有枠 reset）は、大枠では仕様（shell が setup を 1 回・`dependencies` なし・privacy は `privacyNoticeVersion` 参照・service role を page に載せない）に沿っている。

一方で **seed が製品の「complete メンバー」契約（`portion_size` / `spice_level` 必須）を満たさない**こと、および **smoke が reused 消費者がいないのに setup コストを必ず払う**ことは、短縮目的と「完了済み前提」の意味に対する実質的な穴である。現行 suite は生成前に UI でメンバーを再編集して穴を塞いでいるため、いま緑でも **seed 単体の正しさは証明されていない**。

Critical な secret 漏洩・auth fixture の truncate 退行・privacy version 誤記・setup の mobile/desktop 二重実行は **反証**できた。

## Attack scenarios (validated/refuted)

| # | シナリオ | 判定 | 根拠 |
| --- | --- | --- | --- |
| 1 | Seed 不完全 → planner が welcome へ間欠 redirect | **概ね反証**（別問題あり） | `RequireCompletedOnboarding` 撤去済み。seed は `profiles.onboarding_status=complete` + `/planner` 固定 assert。welcome 間欠の主因にはならない。ただし seed の planner assert は **onboarding 完了の弱証明**（not_started でも `/planner` に留まれる）。 |
| 2 | `privacy` `notice_version` 誤記 → 生成が後段で失敗 | **反証** | `seed-onboarding.ts` は `shared/contracts/domain` の `privacyNoticeVersion`（`2026-07-29.v1`）を insert。ハードコード旧版なし。 |
| 3 | `reusedCompletedPage` が世帯を汚す test とユーザ共有 → false red/green | **現行は反証 / 将来は残存** | 消費は `billing-plus.spec.ts` のみ。表示・route mock のみで世帯破壊なし。コメントで ephemeral へ戻す注意あり。workers=1 のため同一ユーザ直列。 |
| 4 | `--project` のみで setup 未実行 | **意図的 fail-closed（残存 DX）** | config に `dependencies` なし。`run-e2e.sh` 経由なら setup 前置。素の Playwright では `reusedCompletedPage` が `e2e/.auth/user.json` 不在で落ちる。ephemeral 系は setup 不要のまま動く。 |
| 5 | 生成経路で `ensureAiQuota` 欠落 → mid-suite `global_daily_limit` | **現行 suite では低確率 / 契約穴は成立** | 初回 generate 系（`seedGeneratedMenu` / `full-journey` / `completeMinimumPlanner` / `flows` / shopping generate / mobile-a11y）はカバー。**再生成**（`requestWholeRegeneration` / `requestDishRegeneration` / `regenerateWholeMenu`）は ensure なし。workers=1 と「直前 generate で truncate」に依存しており、回帰しやすい。 |
| 6 | auth fixture が依然 truncate（退行） | **反証** | `authenticatedPage` / `completedOnboardingPage` / `ideaModePage` から truncate 削除済み。 |
| 7 | storageState が commit される / secret 混入 | **gitignore は成立 / tooling fail は未実装** | `.gitignore` に `e2e/.auth/`。Spec §6.3 の「tracked なら fail」tooling は tests に無し。 |
| 8 | service role が log / page に渡る | **反証** | `createServiceAdmin` は Node 側で `.env` 読取。`page.evaluate` に key を渡さない。JWT から `sub` のみ抽出。 |
| 9 | complete member insert が CHECK 違反 → seed が黙って壊れる | **CHECK 違反は反証 / 意味的不完全は成立** | DB CHECK は complete 時に `age_band` + `allergy_status` + `unsupported_diet_status` のみ。insert は成功する。しかし **`portion_size`/`spice_level` が null のまま `status=complete`** になり、`complete_household_member` RPC と `requireCompleteMember`（生成）の契約を満たさない。 |
| 10 | smoke が setup オーバーヘッドで遅く/壊れる | **遅延は成立 / 破壊は低** | `billing-plus` は full-only（`@smoke` 0）。smoke 必須セットはすべて ephemeral。それでも `run-e2e.sh` は smoke でも **必ず** `--project=setup` を前置。壊しはしにくいが **純粋な短縮逆行**。 |

## Findings

### Critical

（該当なし — service role 漏洩、privacy version 誤記、auth fixture truncate 退行、storageState の git 追跡は確認されず）

### Important

#### I1. seed の complete メンバーが `portion_size` / `spice_level` 欠落（生成契約と不一致）

- **Confidence:** 92  
- **Where:** `e2e/fixtures/seed-onboarding.ts` L55–65（live 同）  
- **Why:**  
  - テーブル CHECK は portion/spice を要求しないため insert は成功する。  
  - 製品 RPC `complete_household_member`（`20260807000300_complete_member_require_portion_spice.sql`）と生成の `requireCompleteMember`（`netlify/functions/_shared/generation-context.ts`）は **両方 non-null 必須**。null だと `invalid_request`。  
  - 現行の生成系 E2E は直前に settings で UI 再編集（小麦付与など）し、フォーム初期化が defaults を埋めるため **穴が隠れる**。  
  - `menu-domain-pantry` のローカル `advanceToReviewWithHousehold` は **再編集なし**で seed メンバーを選択する（AI 生成はしないため現状緑）。  
- **False-green リスク:** fixture 名とコメントは「完了済み・planner で使える」だが、**生成可能な complete メンバーではない**。seed 直後の状態だけを信じる test を足すと、再編集有無で結果が分岐する。  
- **Fix:** seed insert に成人 defaults を明示する。

```ts
// 例: defaultsForAgeBand("adult") 相当を固定
portion_size: "regular",
spice_level: "regular",
```

可能なら seed 後に REST/admin で `portion_size`/`spice_level` が non-null であることを assert。

#### I2. smoke が reused 未使用なのに setup を必ず実行する

- **Confidence:** 95  
- **Where:** `scripts/run-e2e.sh`（setup 前置）+ `tests/tooling/e2e-smoke-tags.test.mjs`（`billing-plus` は full-only）  
- **Why:** Spec §6.3 は smoke の setup を「reused を使う smoke がある場合」と注記。実装は suite 種別に関係なく setup 固定。Phase 2 の唯一の reused 消費者 `billing-plus` は `@smoke` 対象外。smoke は magic-link + seed のコストだけが増え、短縮目的に逆行。  
- **Fix（いずれか）:**  
  1. smoke では setup をスキップする（reused が `@smoke` に入るまで）。  
  2. 読み取り専用の smoke 1 本を `reusedCompletedPage` に移し、setup コストに見合うようにする。

#### I3. 再生成ヘルパが `ensureAiQuotaForGeneration` を呼ばない

- **Confidence:** 82  
- **Where:**  
  - `e2e/fixtures/history.ts` — `requestWholeRegeneration` / `requestDishRegeneration` / `submitRegenerationSheet`  
  - `e2e/fixtures/shopping.ts` — `regenerateWholeMenu`  
- **Why:** Phase 2 契約は「外部 AI 送信直前のみ ensure」。再生成も外部 AI 送信。現状は同一 test 内の直前 `seedGeneratedMenu` 等の truncate に依存。workers=1 かつ 20 枠では今すぐ枯渇しにくいが、**生成直前契約の抜け**であり suite 拡張・順序変更で `global_daily_limit` false red を招く。  
- **Fix:** 再生成 click 直前（`submitRegenerationSheet` 入口または各 public regen helper）で `ensureAiQuotaForGeneration()` を呼ぶ。

#### I4. storageState tracked 時の tooling fail が未実装

- **Confidence:** 90  
- **Where:** Spec §6.3 vs `tests/tooling/*`（`e2e/.auth` 検査なし）  
- **Why:** `.gitignore` のみ。誤って `git add -f` したトークン入り `user.json` を機械的に拒否できない。  
- **Fix:** tooling テストで `git ls-files e2e/.auth` が空であることを固定。

### Minor

#### M1. seed の profile update が 0 行更新を検知しない

- **Confidence:** 80  
- **Where:** `seed-onboarding.ts` profiles `.update(...).eq("user_id", userId)`  
- **Why:** PostgREST は 0 行でも `error: null`。トリガ遅延等で profile が無いと silent。現状 magic-link 後は profile がある前提。  
- **Fix:** `.select("user_id")` で返却行を要求し、空なら throw。

#### M2. seed の `/planner` assert は onboarding 完了の弱証明

- **Confidence:** 80  
- **Why:** 保護は session のみ。not_started でも `/planner` + メインナビは出る。  
- **Fix:** seed 後に admin/REST で `onboarding_status === "complete"` と privacy 行存在を assert。

#### M3. 素の Playwright 起動時の setup 前提が DX 上わかりにくい

- **Confidence:** 80  
- **Why:** サポート経路は `./scripts/run-e2e.sh`。`npx playwright test --project=mobile-chromium` では reused のみ死亡。意図的だがエラーメッセージは Playwright の ENOENT 任せ。

#### M4. `reusedCompletedPage` 拡大時の汚染ガードが静的に無い

- **Confidence:** 78（参考・閾値未満だが記録）  
- **Why:** コメント依存。世帯 mutate を reused に載せると false red/green。`@ephemeral-auth` allowlist は Spec にあるが本 diff では未実装。

## 反証できた良い点（回帰していないもの）

1. **auth fixture から truncate 除去** — 非生成 test が枠を触らない方針と一致。  
2. **privacy version** — 契約定数参照で旧版 typo を回避。  
3. **service role 境界** — Node のみ、page 非経由。  
4. **setup 二重実行（shell × dependsOn）** — `dependencies` なし。`auth.setup.ts` は default `*.spec|test` に非マッチで mobile/desktop に混入しない。  
5. **storageState gitignore** — `e2e/.auth/` 追加済み。  
6. **reused の適用範囲** — 破壊的課金 UI ではなく表示系のみ。  
7. **UI onboarding 所有** — seed は `completedOnboardingPage` 専用。onboarding / full-journey household は UI 経路を維持。

## Verdict: **BLOCK_WITH_CONDITIONS**

### マージ／Phase 2 完了前に必須

1. **I1:** seed の complete メンバーに `portion_size` / `spice_level`（adult 既定で可）を入れ、生成契約と揃える。  
2. **I2 または明示受容:** smoke の setup 前置を「reused smoke が無い間はスキップ」にするか、reused を使う smoke を 1 本以上持たせてコストを正当化する。

### 残してもよいが早期対応推奨

- **I3** 再生成 path の ensure  
- **I4** tracked `e2e/.auth` fail tooling  
- **M1–M2** seed の強 assert  

### 条件付きで通す理由

Critical な秘密漏洩・privacy 誤版・fixture truncate 退行・setup の project 二重実行は成立しなかった。ただし I1 は「完了済み seed」の意味を製品契約より弱めており、敵対的に見ると **false confidence の温床**なので無条件 PASS にはしない。

---

ADVERSARIAL_REVIEW_COMPLETE
