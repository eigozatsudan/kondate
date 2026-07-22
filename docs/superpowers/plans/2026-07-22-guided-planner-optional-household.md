# 献立作成ウィザード・家族設定任意化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン済み利用者が家族設定を必須とせず、1画面1質問のウィザードから家族モードまたはアイデアモードの献立を安全に生成・閲覧・履歴利用・再生成できるようにする。

**Architecture:** `TargetMode` を共有Zod契約、下書き、凍結提出、HMAC、完成献立の判別子として一貫して保存する。家族モードは既存の年齢・アレルギー安全境界を維持し、アイデアモードは家族表を読まない独立したコンテキスト、安全snapshot、fingerprint、結果表示へ分岐する。UI公開はDB・生成境界の完成後に行い、`/welcome` とウィザードを公開するTaskで最低限安全なアイデア結果画面まで同時に完成させる。

**Tech Stack:** React 19 / React Router 8 / TanStack Query 5 / TypeScript 5.9 / Zod 4 / Vite 8 / Netlify Functions / Supabase Postgres 17 / Vitest / React Testing Library / pgTAP / Playwright

**仕様書:** `docs/superpowers/specs/2026-07-22-guided-planner-optional-household-design.md`

## Global Constraints

- Node.jsは`>=24 <25`のみ。Node/npmコマンドは必ず`docker compose run --rm --no-deps app ...`で実行し、コマンドを`&&`や`;`で連結しない。
- 実装はTask 1からTask 8まで順番に行う。各TaskでRED、GREEN、対象リファクタリング、独立検証、一次レビュー、別Reviewerの二次検証を完了してから次へ進む。
- 各Taskは新しいImplementer、Verifier、一次Reviewer、二次Reviewerスレッドを使い、完了済みTaskのスレッドを再利用しない。
- DB Taskは最初に、そのTaskで指定したlogical nameを使って`docker compose run --rm --no-deps app npx supabase migration new`を単独実行し、CLIが出力したmigration pathをTask brief/reportへ記録する。migration filenameを手作業で考案しない。
- private schemaの新規表はData APIへ公開せず、`public`、`anon`、`authenticated`から全権限を明示的にrevokeする。公開RPCは既定の`PUBLIC EXECUTE`をrevokeし、`authenticated`または`service_role`の必要最小権限だけをgrantする。
- `SECURITY DEFINER` RPCは`set search_path = ''`、関数内の完全修飾名、`auth.uid()`または明示的なowner引数検査を必須とする。ブラウザへservice roleやHMAC鍵を公開しない。
- `TargetMode`は`"household" | "idea"`の明示値だけを正本とする。空の`targetMemberIds`からモードを推測しない。判別済みv1 legacyだけは旧版契約に基づく限定的な`household`変換を許可する。
- household提出は対象家族1〜20件・`servings: null`、idea提出は対象家族0件・`servings`整数1〜20。下書きだけは`targetMode: null`・`servings: null`を許可する。
- 家族モードの現行安全確認、HMAC、冪等性、quota、回復、所有者、RLSを弱めない。アイデアモードは家族、年齢、アレルギー、好みを読まず、AI送信DTO・snapshot・完成献立子行へ混入させない。
- アイデアモードの結果は「家族条件を使用していません」を常時表示する。買い物リスト操作と`child_friendly`再生成をUI・API・DB境界で拒否する。
- 配色はリネン`#f7f2e9`、アイボリー`#fffdf8`、ソフトクレイ`#d9a48f`、ディープクレイ`#8b4e3b`、本文`#423a32`、補足`#6b5e52`、選択面`#f4e6df`、注意面`#f8ece7`を正とする。
- UIは320 CSS pxと200%拡大で横スクロールを起こさず、操作領域44px以上、通常文字・補足文字・主要ボタン4.5:1以上、3pxの`#8b4e3b` focus ring、`prefers-reduced-motion`対応を満たす。
- UI文言、コードコメント、コミットメッセージは日本語。識別子とテスト名は英語。TypeScriptはstrict、`any`と未検査castを追加しない。
- 各TaskのDB変更後は型生成、対象pgTAP、対象Vitestを同じTask内で通す。Task 8は`AGENTS.md`の9段階gateを順番どおり完走する。
- Task完了後に次Taskがある場合、親は`AGENTS.md`指定形式のwrite-once handoffを安全確認後に新規作成し、次Taskスレッドへexact pathだけを渡す。

## Supabase確認事項

- 新しい`public`表・関数がData APIへ自動公開される前提を置かず、必要なgrantをmigrationへ明記する。今回新設するsnapshotとlegacy migration ledgerは`private` schemaだけに置く。
- RLSはgrantとは別の境界である。既存public表のRLSを維持し、private表は直接公開せずowner-bound RPCからのみ操作する。
- Postgres 17を前提とし、現在のself-hosted構成で既に完了しているPG17移行をこのPlanで再実施しない。
- 根拠: [Supabase Data API公開既定値の変更](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)、[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Database Functions](https://supabase.com/docs/guides/database/functions)、[CLI migration new](https://supabase.com/docs/reference/cli/supabase-bootstrap)。

---

## File Structure

### 共有UIとフロントエンド

| ファイル | 責務 |
| --- | --- |
| `src/styles.css` | リネン＆テラコッタのtoken、wizard layout、focus、motion |
| `src/styles.contrast.test.ts` | token組み合わせのWCAG 2.1 AA検証 |
| `src/shared/ui/wizard/wizard-frame.tsx` | 質問見出し、進捗、戻る、本文、主操作 |
| `src/shared/ui/wizard/choice-card.tsx` | 単一・複数選択の44px以上の選択カード |
| `src/shared/ui/wizard/progress-indicator.tsx` | 文字とbarによる現在位置 |
| `src/shared/ui/wizard/inline-notice.tsx` | 注意・保存失敗・安全境界の見出し付き表示 |
| `src/shared/ui/wizard/review-row.tsx` | 確認項目、値、編集操作 |
| `src/shared/ui/wizard/wizard-ui.test.tsx` | 共通部品のARIA、keyboard、focus、表示契約 |
| `src/features/welcome/welcome-page.tsx` | 初回開始画面と家族設定省略・再開 |
| `src/features/welcome/welcome-page.test.tsx` | profile状態別開始導線 |
| `src/features/auth/root-entry-page.tsx` | `/`から`/welcome`または`/planner`への振分け |
| `src/features/planner/model/planner-wizard.ts` | step順序、完了判定、再開位置 |
| `src/features/planner/model/planner-wizard.test.ts` | 古い下書きと戻る・進むの決定論的検証 |
| `src/features/planner/components/planner-wizard.tsx` | wizardの状態表示とstep切替 |
| `src/features/planner/components/meal-step.tsx` | 食事質問 |
| `src/features/planner/components/ingredient-step.tsx` | メイン食材質問 |
| `src/features/planner/components/cuisine-step.tsx` | ジャンル質問 |
| `src/features/planner/components/audience-step.tsx` | 家族/idea選択とidea人数 |
| `src/features/planner/components/review-step.tsx` | 条件一覧、任意条件、注意、生成操作 |
| `src/features/planner/planner-page.tsx` | 旧一枚フォームからwizard compositionへ変更 |
| `src/features/planner/planner-route.tsx` | draft取得・autosave・競合・同意往復・生成開始 |
| `src/app/router.tsx` | `/welcome`、root振分け、guard撤去 |
| `src/features/auth/protected-routes.tsx` | `RequireSession`維持、完了guard削除 |

### 共有契約・生成サーバー

| ファイル | 責務 |
| --- | --- |
| `shared/contracts/domain.ts` | `OnboardingStatus`へ`skipped`追加 |
| `shared/contracts/planner.ts` | `TargetMode`、draft、判別可能なsubmission |
| `shared/contracts/generation.ts` | v1/v2 wire、失敗code、regen mode制約 |
| `shared/contracts/menu-result.ts` | resultの`targetMode`とmode-aware view model |
| `shared/safety/generation-context.ts` | household/ideaの判別可能な生成context |
| `shared/safety/idea-fingerprint.ts` | 固定idea snapshotのcanonical JSONとSHA-256 |
| `netlify/functions/_shared/generation-integrity-context.ts` | HMAC前の権威あるdraft/source読出し |
| `netlify/functions/_shared/generation-command-integrity.ts` | v1 readerとv2 canonical HMAC |
| `netlify/functions/_shared/generation-repository.ts` | reserve/snapshot/finalize RPC adapter |
| `netlify/functions/_shared/generation-context.ts` | new menuのmode別context構築 |
| `netlify/functions/_shared/regeneration-context.ts` | request snapshotとlive sourceのfail-closed照合 |
| `netlify/functions/_shared/generation-prompt.ts` | mode別prompt、idea時の家族情報非送信 |
| `netlify/functions/_shared/generation-service.ts` | mode別検証・保存・attempt処理 |
| `netlify/functions/generation-command-migration.ts` | legacy keyのowner-bound claim API |
| `src/features/generation/model/pending-generation.ts` | 新storage schema、legacy reader、claim後置換 |
| `src/features/generation/api/generation-api.ts` | v2 POSTとlegacy claim API |

### DB、結果、履歴、テスト

| ファイル | 責務 |
| --- | --- |
| `src/shared/types/database.generated.ts` | 各migration後に再生成するpublic/private型 |
| `src/shared/types/database.ts` | 既存型overrideのmode/nullability追随 |
| `src/features/generation/api/menu-result-api.ts` | `target_mode`を含む結果aggregate |
| `src/features/generation/pages/menu-result-page.tsx` | mode別revalidationと操作境界 |
| `src/features/generation/components/menu-result.tsx` | idea時の家族領域非表示 |
| `src/features/history/api/history-api.ts` | history一覧へ`target_mode`追加 |
| `src/features/history/components/history-card.tsx` | mode表示 |
| `src/features/history/pages/history-detail-page.tsx` | mode別詳細・revalidation |
| `src/features/history/components/regeneration-sheet.tsx` | idea時の`child_friendly`非表示 |
| `src/features/history/hooks/use-regeneration.ts` | 権威あるmodeを維持したv2再生成 |
| `src/features/planner/model/draft-from-menu.ts` | 元献立の保存済みsubmissionから対象だけ未選択にした新規draftを作る |
| `supabase/tests/database/002_household_rls.test.sql` | skipped、時刻、privacy独立 |
| `supabase/tests/database/03_pantry_and_planner_drafts.test.sql` | draft mode/servings制約と移行 |
| `supabase/tests/database/04_menu_core.test.sql` | menu mode別nullability |
| `supabase/tests/database/ai_control_and_quota.test.sql` | v1/v2、snapshot、claim、quota |
| `supabase/tests/database/ai_control_and_quota_races.test.sql` | 別backend sessionによるlegacy claimとsource変更race |
| `supabase/tests/database/history_regeneration.test.sql` | source version/lineage fail-closed |
| `supabase/tests/database/shopping_lists.test.sql` | idea source拒否と不変性 |
| `supabase/tests/database/shopping_lists_races.test.sql` | lock順と同時実行回帰 |
| `netlify/functions/_shared/generation-adversarial.integration.test.ts` | canary、矛盾payload、人数改変 |
| `e2e/specs/onboarding.spec.ts` | optional household開始導線 |
| `e2e/specs/generation-recovery-results.spec.ts` | idea生成・復帰・結果・320px |
| `e2e/specs/history-regeneration.spec.ts` | 両modeの履歴・再生成 |

---

### Task 1: リネン＆テラコッタtokenと共通wizard部品

**Files:**
- Modify: `src/styles.css`
- Modify: `src/styles.contrast.test.ts`
- Create: `src/shared/ui/wizard/wizard-frame.tsx`
- Create: `src/shared/ui/wizard/choice-card.tsx`
- Create: `src/shared/ui/wizard/progress-indicator.tsx`
- Create: `src/shared/ui/wizard/inline-notice.tsx`
- Create: `src/shared/ui/wizard/review-row.tsx`
- Create: `src/shared/ui/wizard/wizard-ui.test.tsx`

**Interfaces:**
- Consumes: 既存`.page-frame`、`.primary-button`、`.secondary-button`、`.text-button`。
- Produces:

```ts
export type WizardPrimaryAction = {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
};

export type WizardFrameProps = {
  stepKey: string;
  currentStep: number;
  totalSteps: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  onBack?: () => void;
  primaryAction: WizardPrimaryAction;
};

export type ChoiceCardProps = {
  title: string;
  description?: string;
  selected: boolean;
  selectionMode: "single" | "multiple";
  disabled?: boolean;
  onSelect: () => void;
};

export type InlineNoticeTone = "notice" | "warning" | "error";
```

- Task 6はこれらのexportを名前変更せず利用する。

- [ ] **Step 1: tokenと共通部品の失敗するテストを書く**

`src/styles.contrast.test.ts`へ設計色の完全一致、本文/補足/主要操作の4.5:1、hover/activeの4.5:1、focus色の存在を追加する。`wizard-ui.test.tsx`へ次のassertionを書く。

```tsx
it("moves focus to the question heading when the step changes", () => {
  const { rerender } = render(
    <WizardFrame
      stepKey="meal"
      currentStep={1}
      totalSteps={5}
      title="いつの食事ですか？"
      primaryAction={{ label: "次へ", onClick: vi.fn() }}
    >
      <p>選択肢</p>
    </WizardFrame>,
  );
  expect(screen.getByRole("heading", { name: "いつの食事ですか？" })).toHaveFocus();
  rerender(
    <WizardFrame
      stepKey="ingredient"
      currentStep={2}
      totalSteps={5}
      title="メインの食材は？"
      primaryAction={{ label: "次へ", onClick: vi.fn() }}
    >
      <p>選択肢</p>
    </WizardFrame>,
  );
  expect(screen.getByRole("heading", { name: "メインの食材は？" })).toHaveFocus();
});

it("exposes selection without relying on colour", async () => {
  const onSelect = vi.fn();
  render(
    <ChoiceCard
      title="夕食"
      selected
      selectionMode="single"
      onSelect={onSelect}
    />,
  );
  const choice = screen.getByRole("button", { name: /夕食/ });
  expect(choice).toHaveAttribute("aria-pressed", "true");
  expect(within(choice).getByText("選択中")).toBeVisible();
  await userEvent.click(choice);
  expect(onSelect).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: focused testを実行してREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/shared/ui/wizard/wizard-ui.test.tsx`

Expected: FAIL。新tokenが旧値で、wizard moduleが存在しないため失敗する。

- [ ] **Step 3: CSS tokenを設計値へ変更する**

`src/styles.css`の`:root`を次の契約へ揃え、body、card、button、field、section tintをtoken参照へ変更する。

```css
:root {
  color: #423a32;
  background: #f7f2e9;
  font-family: "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  --app-background: #f7f2e9;
  --surface: #fffdf8;
  --text: #423a32;
  --muted: #6b5e52;
  --primary: #d9a48f;
  --primary-hover: #cf947d;
  --primary-active: #cc927b;
  --primary-ink: #3b302b;
  --primary-strong: #8b4e3b;
  --selection: #f4e6df;
  --notice: #f8ece7;
  --border: #d8c9bc;
  --focus: #8b4e3b;
  --pantry: #416b5a;
  --danger: #9f342c;
  --question-font: "Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif;
}
```

focusは`outline: 3px solid var(--focus); outline-offset: 2px`、primary hover/activeは各tokenを使う。`.app-section`の基本面を`var(--app-background)`へ揃える。

- [ ] **Step 4: 共通wizard部品を最小実装する**

`WizardFrame`は`stepKey`変更時に`tabIndex={-1}`の`h1`へfocusし、`ProgressIndicator`は`aria-label="質問 1 / 5"`と視覚barを両方出す。`ChoiceCard`は`button`と`aria-pressed`を使用する。`InlineNotice`は`error`だけ`role="alert"`、他toneは`role="note"`とする。`ReviewRow`の編集操作は`「${label}を変更」`のaccessible nameを持つ。

- [ ] **Step 5: wizard CSSとreduced-motionを追加する**

```css
.wizard-title {
  margin: 0;
  color: var(--text);
  font-family: var(--question-font);
  line-height: 1.4;
}

.choice-card[aria-pressed="true"] {
  border-color: var(--primary-strong);
  background: var(--selection);
}

.wizard-transition {
  animation: wizard-enter 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .wizard-transition {
    animation: none;
  }
}
```

- [ ] **Step 6: focused testをGREENにする**

Run: `docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/shared/ui/wizard/wizard-ui.test.tsx`

Expected: PASS。token、focus、ARIA、選択表示の全件が成功する。

- [ ] **Step 7: Task 1検証を実行する**

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。

- [ ] **Step 8: コミットする**

```bash
git add src/styles.css src/styles.contrast.test.ts src/shared/ui/wizard
git commit -m "feat: 献立ウィザードの共通UIを追加"
```

---

### Task 2: 家族設定状態とAI同意を分離する

**Files:**
- Create via CLI: migration logical name `optional_household_profiles`
- Modify: `shared/contracts/domain.ts`
- Modify: `shared/contracts/domain.test.ts`
- Modify: `src/features/household/household-api.ts`
- Modify: `src/features/household/household-api.test.ts`
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`
- Modify: `src/features/privacy/privacy-notice-page.tsx`
- Modify: `src/features/privacy/privacy-notice-page.test.tsx`
- Modify: `src/features/privacy/privacy-copy.ts`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `src/shared/types/database.ts`
- Modify: `src/shared/types/database.test.ts`
- Modify: `supabase/tests/database/002_household_rls.test.sql`
- Modify: `supabase/tests/database/002a_household_draft_completion_boundary.test.sql`
- Modify: `supabase/tests/database/002b_household_onboarding_start.test.sql`

**Interfaces:**
- Consumes: Task 1 UI token。現行`setOnboardingStatus(client,userId,status)`。
- Produces:

```ts
export const onboardingStatuses = ["not_started", "in_progress", "complete", "skipped"] as const;
export type OnboardingStatus = (typeof onboardingStatuses)[number];
```

- `set_onboarding_status(text)`は`not_started`を入力として受けず、仕様書の3組の遷移を検査する。同じ状態の再送は時刻を変更しない冪等な読出しとする。`complete`/`skipped`は完了時刻非null、`in_progress`はnull。
- `PrivacyNoticePage`は`privacy_consents`だけを更新し、プロフィール状態を変更しない。
- 主要ルートの`RequireCompletedOnboarding`はこのTaskで削除しない。

- [ ] **Step 1: migrationをCLIで新規作成する**

Run: `docker compose run --rm --no-deps app npx supabase migration new optional_household_profiles`

Expected: `supabase/migrations/`配下の新しい`.sql` pathが1件表示される。exact pathをTask reportへ記録する。

- [ ] **Step 2: 状態遷移の失敗するpgTAPを書く**

次をfixture化して検証する。

```sql
select lives_ok(
  $$ select public.set_onboarding_status('skipped') $$,
  '家族未登録でもskippedへ遷移できる'
);
select is(
  (select onboarding_status from public.profiles where user_id = tests.current_user_id()),
  'skipped',
  'skippedが保存される'
);
select ok(
  (select onboarding_completed_at is not null from public.profiles where user_id = tests.current_user_id()),
  'skippedは完了時刻を持つ'
);
select lives_ok(
  $$ select public.set_onboarding_status('in_progress') $$,
  'skippedからin_progressへ戻れる'
);
select ok(
  (select onboarding_completed_at is null from public.profiles where user_id = tests.current_user_id()),
  'in_progressへ戻ると完了時刻を消す'
);
```

同じファイルで、同意なし`complete`が完全な家族1人で成功すること、家族なし`complete`は`23514/onboarding_members_incomplete`、`complete`後の最後の家族削除でstatusが変わらないことを追加する。

- [ ] **Step 3: pgTAPのREDを確認する**

Run: `./scripts/reset-local-db.sh`

Expected: reset成功。

Run: `docker compose --profile test run --rm db-test`

Expected: FAIL。`skipped`のCHECKまたはRPC拒否、privacy結合の旧挙動で新assertionが失敗する。

- [ ] **Step 4: profile制約とRPCをmigrationで置換する**

CLI生成migrationへ次の契約を実装する。

```sql
alter table public.profiles drop constraint profiles_onboarding_status_check;
alter table public.profiles drop constraint profiles_check;

alter table public.profiles
  add constraint profiles_onboarding_status_check
  check (onboarding_status in ('not_started', 'in_progress', 'complete', 'skipped'));

alter table public.profiles
  add constraint profiles_onboarding_completed_at_check
  check (
    (onboarding_status in ('complete', 'skipped') and onboarding_completed_at is not null)
    or (onboarding_status in ('not_started', 'in_progress') and onboarding_completed_at is null)
  );
```

`public.set_onboarding_status`は`auth.uid()`がnullなら`42501/authentication_required`、許可外入力なら`22023/invalid_onboarding_status`を返す。現在値と要求値が同じ場合は行を更新せず現在行を返す。異なる場合は`not_started→in_progress|skipped`、`in_progress→complete|skipped`、`skipped→in_progress|complete`だけを許可し、その他は`22023/invalid_onboarding_transition`を返す。`complete`時だけ完全な家族存在を検査し、privacy consentは参照しない。更新時刻は次で設定する。

```sql
onboarding_completed_at = case
  when p_status in ('complete', 'skipped') then statement_timestamp()
  else null
end
```

最後に`revoke all ... from public, anon, authenticated`後、`grant execute ... to authenticated`を復元する。

- [ ] **Step 5: TypeScript契約とUIの同意分離を実装する**

`onboardingStatuses`へ`skipped`を追加する。`HouseholdOnboardingApi.setProgress`は`OnboardingStatus`を受けるが、画面から送る値は`in_progress|complete`だけとする。家族設定完了後は`/planner`へ遷移する。`PrivacyNoticePage`から`setOnboardingStatus(...,"complete")`を削除し、同意保存後はsanitized `returnTo`へ遷移する。privacy copyは両mode共通送信内容、householdだけの家族情報、ideaでは家族情報を送らないことを3項目で示す。

- [ ] **Step 6: DB型を再生成して型overlayを更新する**

Run: `docker compose run --rm --no-deps app npm run db:types`

Expected: `src/shared/types/database.generated.ts`だけがschema追随で更新される。

`database.ts`の`ProfileRow.onboarding_status` overrideを新しい`OnboardingStatus`へ揃え、`database.test.ts`で`skipped`が代入可能、未知値が代入不可であることを`expectTypeOf`で固定する。

- [ ] **Step 7: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/domain.test.ts src/shared/types/database.test.ts src/features/household/household-api.test.ts src/features/household/household-onboarding-page.test.tsx src/features/privacy/privacy-notice-page.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。ルーターテストは旧guardを維持したまま成功する。

- [ ] **Step 8: コミットする**

```bash
git add shared/contracts/domain.ts shared/contracts/domain.test.ts src/features/household src/features/privacy src/shared/types supabase/migrations supabase/tests/database/002_household_rls.test.sql supabase/tests/database/002a_household_draft_completion_boundary.test.sql supabase/tests/database/002b_household_onboarding_start.test.sql
git commit -m "feat: 家族設定状態とAI同意を分離"
```

---

### Task 3: TargetMode、人数、保存schemaを追加する

**Files:**
- Create via CLI: migration logical name `target_mode_storage`
- Modify: `shared/contracts/planner.ts`
- Modify: `shared/contracts/planner.test.ts`
- Modify: `src/features/planner/planner-api.ts`
- Modify: `src/features/planner/planner-api.test.ts`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/features/planner/use-draft-autosave.test.tsx`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `src/shared/types/database.ts`
- Modify: `src/shared/types/database.test.ts`
- Modify: `supabase/tests/database/03_pantry_and_planner_drafts.test.sql`
- Modify: `supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql`
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/tests/database/04a_menu_core_hardening.test.sql`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`

**Interfaces:**
- Consumes: Task 2の`OnboardingStatus`。
- Produces:

```ts
export const targetModes = ["household", "idea"] as const;
export type TargetMode = (typeof targetModes)[number];

export type PlannerDraftInput = {
  targetMode: TargetMode | null;
  targetMemberIds: string[];
  servings: number | null;
  // mealType、mainIngredients、cuisineGenre、任意条件、pantrySelectionsは既存どおり
};

export type PlannerSubmission =
  | {
      targetMode: "household";
      targetMemberIds: [string, ...string[]];
      servings: null;
    }
  | {
      targetMode: "idea";
      targetMemberIds: [];
      servings: number;
    };

export function mapPlannerDraft(row: Tables<"generation_drafts">): PlannerDraft;
```

- DB列名は`target_mode`と`servings`。既存menuは`household`へbackfillする。
- `menus.servings`、`safety_snapshot`、`safety_fingerprint`はNOT NULLを維持する。`allergen_dictionary_version`と`food_safety_rule_version`だけをmode条件付きnullableにする。

- [ ] **Step 1: 判別可能unionと矛盾入力の失敗するテストを書く**

```ts
it.each([
  { targetMode: "idea", targetMemberIds: [memberId], servings: 2 },
  { targetMode: "idea", targetMemberIds: [], servings: null },
  { targetMode: "household", targetMemberIds: [], servings: null },
  { targetMode: "household", targetMemberIds: [memberId], servings: 2 },
])("rejects contradictory target values", (target) => {
  expect(plannerSubmissionSchema.safeParse({ ...validBase, ...target }).success).toBe(false);
});

it("keeps mode and servings unselected for a legacy empty-target draft", () => {
  expect(mapPlannerDraft(migratedEmptyTargetDraft)).toMatchObject({
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
  });
});
```

- [ ] **Step 2: contract testのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts src/features/planner/planner-api.test.ts src/features/planner/planner-route.test.tsx src/features/planner/use-draft-autosave.test.tsx`

Expected: FAIL。`targetMode`、`servings`、`mapPlannerDraft`が未実装。

- [ ] **Step 3: migrationをCLIで新規作成してpgTAP REDを書く**

Run: `docker compose run --rm --no-deps app npx supabase migration new target_mode_storage`

Expected: 新しいmigration pathが1件表示される。exact pathをTask reportへ記録する。

pgTAPへhousehold/ideaの正常行、4種類の矛盾行、既存menu backfill、空target draftのnull移行、version列のmode別nullabilityを追加する。空targetは少なくとも「他回答が完成済み」「途中回答」「以前は家族を選択していたが保存時点では0件」の3 fixtureを用意する。旧schemaから選択意図を復元できないため、3件とも`target_mode is null`、`servings is null`へ移行し、食事・食材・ジャンル・任意条件は変更されないことを検証する。

- [ ] **Step 4: shared planner schemaを実装する**

`plannerDraftInputSchema`は`targetMode: targetModeSchema.nullable()`と`servings: z.number().int().min(1).max(20).nullable()`を持ち、`superRefine`で次を強制する。

```ts
if (value.targetMode === "household") {
  if (value.targetMemberIds.length === 0) issue("targetMemberIds", "家族を選んでください");
  if (value.servings !== null) issue("servings", "家族モードでは人数を直接指定できません");
}
if (value.targetMode === "idea") {
  if (value.targetMemberIds.length !== 0) issue("targetMemberIds", "アイデアモードでは家族を指定できません");
  if (value.servings === null) issue("servings", "人数を指定してください");
}
if (value.targetMode === null) {
  if (value.targetMemberIds.length !== 0) issue("targetMemberIds", "対象を選び直してください");
  if (value.servings !== null) issue("servings", "対象を選んでから人数を指定してください");
}
```

`plannerSubmissionSchema`は`targetMode`による`z.discriminatedUnion`にし、共通shapeを重複させない。`planner-api.ts`の現行private `mapDraft`を`mapPlannerDraft`としてexportし、migration後の`target_mode`と`servings`をZod契約へ写す。legacy判定はDB migrationだけが担当し、ブラウザで空配列からmodeを推測しない。

- [ ] **Step 5: DB保存制約とbackfillをmigrationへ実装する**

CLI生成migrationでplanner draft、`private.generation_draft_submission_versions`、`public.menus`へ`target_mode`を追加する。draftだけ`target_mode`/`servings` nullable、凍結提出とmenuはNOT NULLとする。既存draftの非空targetはhousehold、空targetは回答進捗や過去の選択意図に関係なくnullとし、servingsもnullへ揃える。既存凍結提出とmenuはhouseholdへbackfillする。backfillは対象列以外の回答JSON、任意条件、pantry選択、revisionを変更しない。

各表へ次と同値の条件付きCHECKを付ける。

```sql
check (
  (target_mode = 'household' and cardinality(target_member_ids) between 1 and 20 and servings is null)
  or (target_mode = 'idea' and cardinality(target_member_ids) = 0 and servings between 1 and 20)
  or (target_mode is null and cardinality(target_member_ids) = 0 and servings is null)
)
```

menuは家族人数を保存する既存`servings`が両modeで1〜20のため、対象配列とのCHECKは凍結提出側だけに置く。menu version列へ次を追加する。

```sql
check (
  (target_mode = 'household' and allergen_dictionary_version is not null and food_safety_rule_version is not null)
  or (target_mode = 'idea' and allergen_dictionary_version is null and food_safety_rule_version is null)
)
```

- [ ] **Step 6: planner APIとrouteのrow mappingを更新する**

`getPlannerDraft`と`savePlannerDraft`は`target_mode`/`servings`を明示select/sendする。`emptyDraft`へ両nullを追加する。`sanitizeDraft`はhousehold時だけ無効家族IDを除外し、0件になった場合もideaへ変えず`targetMode: null, servings: null`へ戻す。idea時は家族配列を空に固定し、入力済み人数を保持する。

- [ ] **Step 7: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts src/shared/types/database.test.ts src/features/planner/planner-api.test.ts src/features/planner/planner-route.test.tsx src/features/planner/use-draft-autosave.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。既存household fixtureは明示的に`targetMode: "household", servings: null`へ更新されている。

- [ ] **Step 8: コミットする**

```bash
git add shared/contracts/planner.ts shared/contracts/planner.test.ts src/features/planner src/shared/types supabase/migrations supabase/tests/database/03_pantry_and_planner_drafts.test.sql supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql supabase/tests/database/04_menu_core.test.sql supabase/tests/database/04a_menu_core_hardening.test.sql supabase/tests/database/ai_control_and_quota.test.sql
git commit -m "feat: 献立の対象モードと人数契約を追加"
```

---

### Task 4: generation-command.v2とlegacy移行を実装する

**Files:**
- Create via CLI: migration logical name `generation_command_v2`
- Create: `netlify/functions/_shared/generation-integrity-context.ts`
- Create: `netlify/functions/_shared/generation-integrity-context.test.ts`
- Create: `netlify/functions/generation-command-migration.ts`
- Create: `netlify/functions/generation-command-migration.test.ts`
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-command-integrity.ts`
- Modify: `netlify/functions/_shared/generation-command-integrity.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/regeneration-context.ts`
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`
- Modify: `netlify/functions/generate-menu.ts`
- Modify: `netlify/functions/generate-menu.test.ts`
- Modify: `netlify/functions/generate-dish.ts`
- Modify: `netlify/functions/generate-dish.test.ts`
- Modify: `src/features/generation/api/generation-api.ts`
- Modify: `src/features/generation/api/generation-api.test.ts`
- Modify: `src/features/generation/model/pending-generation.ts`
- Modify: `src/features/generation/model/pending-generation.test.ts`
- Modify: `src/features/generation/hooks/use-generation-recovery.ts`
- Modify: `src/features/generation/hooks/use-generation-recovery.test.tsx`
- Modify: `src/features/history/hooks/use-regeneration.ts`
- Modify: `src/features/history/hooks/use-regeneration.test.tsx`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Create: `supabase/tests/database/ai_control_and_quota_races.test.sql`
- Modify: `supabase/tests/database/history_regeneration.test.sql`

**Interfaces:**
- Consumes: Task 3の`TargetMode`、mode-aware frozen submission、menu列。
- Produces:

```ts
export const generationCommandVersionV2 = "generation-command.v2" as const;

export const generationCommandV2Schema = z.discriminatedUnion("kind", [
  z.object({
    commandVersion: z.literal(generationCommandVersionV2),
    kind: z.literal("new_menu"),
    request: newMenuGenerationRequestSchema,
  }).strict(),
  z.object({
    commandVersion: z.literal(generationCommandVersionV2),
    kind: z.literal("regenerate_menu"),
    request: regenerateMenuRequestSchema,
  }).strict(),
  z.object({
    commandVersion: z.literal(generationCommandVersionV2),
    kind: z.literal("regenerate_dish"),
    request: regenerateDishRequestSchema,
  }).strict(),
]);

export type GenerationCommandV2 = z.infer<typeof generationCommandV2Schema>;
export type GenerationCommandV1 = z.infer<typeof generationCommandV1Schema>;
export type GenerationCommand = GenerationCommandV2;
export type RecoverableGenerationCommand = GenerationCommandV1 | GenerationCommandV2;

export type GenerationIntegrityContextV2 =
  | {
      kind: "new_menu";
      targetMode: "household";
      servings: null;
      targetMemberIds: readonly [string, ...string[]];
      sourceMenuVersion: null;
    }
  | {
      kind: "new_menu";
      targetMode: "idea";
      servings: number;
      targetMemberIds: readonly [];
      sourceMenuVersion: null;
    }
  | {
      kind: "regenerate_menu" | "regenerate_dish";
      targetMode: TargetMode;
      servings: number;
      targetMemberIds: readonly string[];
      sourceMenuVersion: number;
    };

export type GenerationRequestLookup =
  | { kind: "miss" }
  | {
      kind: "hit";
      requestId: string;
      requestHmacVersion: "generation-command.v1";
      integrity: null;
    }
  | {
      kind: "hit";
      requestId: string;
      requestHmacVersion: "generation-command.v2";
      integrity: GenerationIntegrityContextV2;
    };

export type GenerationReservationRepository = {
  lookup: (idempotencyKey: string) => Promise<GenerationRequestLookup>;
  replayExisting: (
    command: RecoverableGenerationCommand,
    lookup: Extract<GenerationRequestLookup, { kind: "hit" }>,
  ) => Promise<QuotaRequestRecord>;
  reserveNew: (
    command: GenerationCommandV2,
    integrity: GenerationIntegrityContextV2,
  ) => Promise<QuotaRequestRecord>;
};

export type GenerationCommandMigrationResult =
  | {
      kind: "existing_v1";
      legacyIdempotencyKey: string;
      request: QuotaRequestRecord;
    }
  | {
      kind: "claimed_v2";
      legacyIdempotencyKey: string;
      v2IdempotencyKey: string;
      replayed: boolean;
    };
```

- 新しい端末keyは`kondate:generation:v3`、現行`kondate:generation:v2`はdiscriminatorなしv1 legacy reader専用。
- `lookupGenerationRequest(userId,idempotencyKey)`を常に最初に実行する。ledger hitは保存済み版と凍結submission/snapshotからHMAC contextを再構築し、live draft/menuを読まずreplayする。ledger missのv2だけが`resolveGenerationIntegrityContext(admin,userId,command)`で権威あるdraft revisionまたはsource menuを読む。`reserveNew(command,integrity)`はDBロック下で同じmode/servings/member IDs/source versionを再確認し、不一致なら永続request/quotaを作らない。
- `generationRequestHmacVersion`の新規値はv2。`canonicalizeGenerationCommandV1`は既存ledger回収のため変更しない。`canonicalizeGenerationCommandV2(command,integrity)`は`targetMode`、`servings`、sort済み`targetMemberIds`、`sourceMenuVersion`を含む。
- `private.generation_regeneration_snapshots`はrequest 1対1・immutable・cascade 30日保持。`private.generation_command_migrations`は`(user_id,legacy_idempotency_key)`一意でv2 key/tombstoneを30日保持。
- 新migrationが置換・追加するSQL interfaceを次に固定する。`lookup`と`reserve`はNetlify Functionsのservice roleだけ、`claim`は`authenticated`だけ、cleanupはservice roleだけへ`EXECUTE`を許可する。`anon`、`public`、不要なroleからは明示的にrevokeする。RLSとは別にData API grantを列挙する。

```sql
create or replace function public.lookup_ai_generation_request(
  p_user_id uuid,
  p_idempotency_key uuid
) returns jsonb;

-- 現行v1の14引数overloadだけを削除する。直後に作るv2はjsonbを加えた15引数である。
drop function if exists public.reserve_ai_generation(
  uuid, uuid, text, uuid, bigint, uuid, uuid, text,
  text, text, integer, integer, integer, timestamptz
);

create or replace function public.reserve_ai_generation(
  p_user_id uuid,
  p_idempotency_key uuid,
  p_request_kind text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_source_menu_id uuid,
  p_replace_dish_id uuid,
  p_change_reason text,
  p_request_hmac_version text,
  p_request_hmac text,
  p_integrity_context jsonb,
  p_user_limit integer,
  p_global_limit integer,
  p_stale_after_seconds integer default 180,
  p_now timestamptz default clock_timestamp()
) returns jsonb;

create or replace function public.claim_generation_command_migration(
  p_legacy_idempotency_key uuid
) returns jsonb;

create or replace function private.cleanup_generation_command_migrations(
  p_before timestamptz,
  p_limit integer
) returns integer;
```

`lookup_ai_generation_request`はmiss時`{"kind":"miss"}`、hit時`kind`、既存request payload、`requestHmacVersion`、v2だけ`integrityContext`を返す。`reserve_ai_generation`は既存`QuotaRequestRecord` JSONだけを返し、v2以外の新規予約を拒否する。旧14引数overloadはDROP後に再作成せず、既存v1の回収はlookupだけを使う。`claim_generation_command_migration`は`GenerationCommandMigrationResult`と同じ`existing_v1 | claimed_v2`の判別可能JSONを返す。

- [ ] **Step 1: v2 wire、HMAC、pending storageの失敗するVitestを書く**

```ts
it("binds target mode and servings in v2 canonical payload", () => {
  const canonical = canonicalizeGenerationCommandV2(command, {
    kind: "new_menu",
    targetMode: "idea",
    servings: 4,
    targetMemberIds: [],
    sourceMenuVersion: null,
  });
  expect(JSON.parse(canonical)).toMatchObject({
    version: "generation-command.v2",
    targetMode: "idea",
    servings: 4,
    targetMemberIds: [],
  });
});

it("reads discriminator-less v2 storage as legacy v1 and writes only v3", () => {
  storage.setItem("kondate:generation:v2", JSON.stringify(legacyPending));
  expect(readPendingGeneration(storage, userId)?.commandVersion).toBe("generation-command.v1");
  writePendingGeneration(storage, createV2Pending());
  expect(storage.getItem("kondate:generation:v3")).not.toBeNull();
});
```

endpoint testsは`commandVersion`なし新規keyを`client_update_required`、既存v1 ledgerをreplay、v2を通常処理として固定する。

次の順序テストも追加する。

```ts
it("replays from the frozen snapshot before reading a deleted live source", async () => {
  repository.lookup.mockResolvedValue(existingV2RegenerationLookup);
  await runGeneration(deps, replayCommand);
  expect(repository.lookup).toHaveBeenCalledBefore(repository.replayExisting);
  expect(resolveGenerationIntegrityContext).not.toHaveBeenCalled();
  expect(repository.replayExisting).toHaveBeenCalledWith(
    replayCommand,
    existingV2RegenerationLookup,
  );
});
```

- [ ] **Step 2: focused VitestのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts netlify/functions/_shared/generation-command-integrity.test.ts netlify/functions/_shared/generation-integrity-context.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/generation-command-migration.test.ts src/features/generation/model/pending-generation.test.ts src/features/generation/hooks/use-generation-recovery.test.tsx`

Expected: FAIL。v2 schema、resolver、migration endpoint、v3 storageが存在しない。

- [ ] **Step 3: migrationをCLIで作成してpgTAP REDを書く**

Run: `docker compose run --rm --no-deps app npx supabase migration new generation_command_v2`

Expected: 新しいmigration pathが1件表示される。exact pathをTask reportへ記録する。

通常pgTAPへv1/v2 CHECK、未知版拒否、新規v1予約拒否、既存v1 replay、request snapshot immutable、source version変更/削除、遅延v1拒否、quota不変を追加する。旧14引数`reserve_ai_generation`の`to_regprocedure(...) is null`と、新15引数signatureの`to_regprocedure(...) is not null`を別assertionで検証し、旧signature呼出し失敗前後でrequest/usage行数不変も検証する。`ai_control_and_quota_races.test.sql`は既存shopping race testと同じ専用dblink roleを使い、fixtureをcommitしてから別backend 2 sessionで同じlegacy keyをclaimする。既存v1が先に作られたraceは両sessionが`existing_v1`と同一requestを返し、未作成raceは両sessionが`claimed_v2`と同一v2 keyを返し、どちらもrequest/quotaを二重作成しないことを検証する。

- [ ] **Step 4: v1/v2 wire schemaとcanonicalizerを実装する**

`generationCommandV1Schema`を現行discriminatorなしwireとして保持し、`generationCommandV2Schema`は全kindで`commandVersion` literalを必須にする。新規送信用`GenerationCommand`はv2、reader用`RecoverableGenerationCommand`はv1|v2とする。

v2 canonical JSONは次のkey順を固定し、kindに存在しない値は`null`、member IDsと期限切れ確認はsortする。

```ts
{
  version,
  kind,
  idempotencyKey,
  draftId,
  draftRevision,
  sourceMenuId,
  dishId,
  changeReason,
  changeReasonCustom,
  privacyNoticeVersion,
  expiredPantryConfirmations,
  targetMode,
  servings,
  targetMemberIds,
  sourceMenuVersion,
}
```

- [ ] **Step 5: ledger-first lookupとreplay adapterを実装する**

`runGeneration`はparse済みcommandからidempotency keyを取り、最初のrepository callを必ず`lookup`にする。hit時はv1ならincoming legacy command、v2ならlookupが返した凍結integrityでHMACを再計算し、`replayExisting`へ渡す。元draft/menu/dish、privacy、pantry、householdをhit前に読まない。保存HMAC不一致は`idempotency_payload_mismatch`、一致は保存済みstatusを返す。

`lookup`と`replayExisting`の間に行が消えた場合は1回だけmiss処理へ戻さず`internal_error`でfail-closedする。30日retention中のrowが通常実行で消えない既存契約を回帰テストする。

- [ ] **Step 6: replay miss専用integrity resolverを実装する**

`resolveGenerationIntegrityContext`はnew menuで`draftId+draftRevision+owner`、regenerationで`sourceMenuId+owner`と対象dishを取得し、クライアントからmode/servingsを受け取らない。new menuはfrozen候補のmode/servings/member IDs、regenerationはmenuの保存済みmode/servings/member IDs/versionを返す。`lookup.kind === "miss"`かつv2の場合だけ呼ぶ。missのv1はresolverを呼ばず`client_update_required`を返す。

- [ ] **Step 7: reserveNewのDB lock再確認を実装する**

repositoryはresolver値とv2 HMACをreserve RPCへ渡す。RPCは競合insertに備えてtransaction内でもledger lookupを最初に行う。既存行が現れた場合は保存HMACとincoming HMACを比較してreplayへ合流する。真のmissだけdraft/sourceを`FOR UPDATE`で取得し、mode/servings/member IDs/source versionを完全一致で検査した後にrequest、frozen submissionまたはregeneration snapshot、quota reservationを同一transactionで作る。不一致は`draft_revision_conflict`または`source_menu_changed`で永続行を作らない。

- [ ] **Step 8: private snapshot DDLとimmutable triggerを実装する**

次の列・制約をそのままmigrationへ定義する。`target_member_ids`はsort済み・重複なしをreserve RPCで保証し、ideaなら空、householdなら1件以上とする。`kind='regenerate_dish'`の時だけ`replace_dish_id`を必須にする。

```sql
create table private.generation_regeneration_snapshots (
  request_id uuid primary key references private.ai_generation_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('regenerate_menu', 'regenerate_dish')),
  source_menu_id uuid not null,
  source_menu_version integer not null check (source_menu_version > 0),
  replace_dish_id uuid,
  target_mode text not null check (target_mode in ('household', 'idea')),
  servings integer not null check (servings between 1 and 20),
  target_member_ids uuid[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'regenerate_dish') = (replace_dish_id is not null)),
  check (
    (target_mode = 'idea' and cardinality(target_member_ids) = 0)
    or (target_mode = 'household' and cardinality(target_member_ids) > 0)
  )
);

create table private.generation_command_migrations (
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_idempotency_key uuid not null,
  v2_idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  primary key (user_id, legacy_idempotency_key),
  check (expires_at = created_at + interval '30 days')
);
```

両tableはschema/table権限を`public,anon,authenticated`からrevokeする。snapshotはUPDATEを常に例外にするprivate triggerを付け、作成はreserve RPC、削除はrequest cascadeとcleanupだけに限定する。

- [ ] **Step 9: legacy claim ledger、RPC、bounded cleanupを実装する**

claim RPCは`auth.uid()`がnullなら拒否し、ownerの既存v1 requestを先に`existing_v1`として返す。未claimなら現行reserve RPCと同じkey生成規則で、次のtransaction-scoped advisory lockを取得する。

```sql
perform pg_advisory_xact_lock(
  hashtextextended(v_user_id::text || ':' || p_legacy_idempotency_key::text, 0)
);
```

hash衝突は無関係なclaimを直列化するだけで正しさを損なわない。lock後にv1 requestとmappingを再読込し、未作成なら新しいv2 keyを`insert ... on conflict (user_id, legacy_idempotency_key) do nothing`で追加する。主キーを競合時の最終防壁とし、insert後は同じ主キーで必ず再selectして`claimed_v2`を返す。`ON CONFLICT DO UPDATE`で既存のv2 keyや期限を変更してはならない。mapping判定はlookup/claimに集約し、reserve RPCはmigration redirectを返さない。レスポンス作成後に`expires_at`を延長しない。

期限切れmappingは`private.cleanup_generation_command_migrations(p_before timestamptz,p_limit integer)`で`created_at,user_id,legacy_idempotency_key`順に最大250件だけ削除し、service role以外のexecuteをrevokeする。claim時のowner cleanupも自分の期限切れ行を最大100件に制限する。

- [ ] **Step 10: pending commandの安全なv1→v2変換を実装する**

claim結果が`existing_v1`なら内包されたrequest statusをv1として回収し、変換もv3書込みも行わない。`claimed_v2`なら返されたv2 keyを使って変換する。存在しないnew menuは同じdraft revisionを再読込し、非空targetの旧版契約に限ってhouseholdへ変換する。空target、欠損、revision不一致は現在の回答を維持し対象stepへ戻す。regenerationはmigration済みsource menuのhousehold modeとversionを使う。v3 storageへの保存が成功した後だけv2 legacy keyを削除する。両storage keyがある場合はv3を正本とし、owner、現行`PENDING_GENERATION_TTL_MS`の30分、request IDの整合が取れたlegacy行だけを削除する。

- [ ] **Step 11: source snapshotのfail-closed動作を実装する**

`regeneration-context.ts`はrequest snapshotを正本としてlive sourceと対象dishをowner/version付きで再取得する。外部送信前の不一致・削除は`source_menu_changed`でfailしattemptを返却する。finalize RPCはrequestを`FOR UPDATE`、source menuをowner+version付き`FOR SHARE`の順にlockしてlineageを再検査する。送信後の不一致はmenuを作らずattempt消費・success枠非消費で同codeへ終端化する。reserve/finalizeともrequest→draftまたはsource→usage rowのlock順を守り、逆順取得を禁止する。

- [ ] **Step 12: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts netlify/functions/_shared/generation-command-integrity.test.ts netlify/functions/_shared/generation-integrity-context.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/generation-command-migration.test.ts netlify/functions/generate-menu.test.ts netlify/functions/generate-dish.test.ts src/features/generation/api/generation-api.test.ts src/features/generation/model/pending-generation.test.ts src/features/generation/hooks/use-generation-recovery.test.tsx src/features/history/hooks/use-regeneration.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。v1 canonical fixtureの既存期待値は変化しない。

- [ ] **Step 13: コミットする**

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions src/features/generation src/features/history/hooks/use-regeneration.ts src/features/history/hooks/use-regeneration.test.tsx src/shared/types/database.generated.ts supabase/migrations supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/history_regeneration.test.sql
git commit -m "feat: 生成コマンドv2と旧版移行を追加"
```

---

### Task 5: アイデアモードのサーバー安全境界を実装する

**Files:**
- Create via CLI: migration logical name `idea_generation_boundary`
- Create: `shared/safety/idea-fingerprint.ts`
- Create: `shared/safety/idea-fingerprint.test.ts`
- Modify: `shared/safety/generation-context.ts`
- Modify: `shared/safety/validate-generated-menu.ts`
- Modify: `shared/safety/validate-generated-menu.test.ts`
- Modify: `netlify/functions/_shared/generation-context.ts`
- Modify: `netlify/functions/_shared/generation-context.test.ts`
- Modify: `netlify/functions/_shared/regeneration-context.ts`
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Modify: `netlify/functions/_shared/generation-materializer.ts`
- Modify: `netlify/functions/_shared/generation-materializer.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `src/shared/types/database.ts`
- Modify: `src/shared/types/database.test.ts`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/tests/database/shopping_lists.test.sql`
- Modify: `supabase/tests/database/shopping_lists_races.test.sql`

**Interfaces:**
- Consumes: Task 4のv2 integrity、request snapshot、source fail-closed契約。
- Produces:

```ts
export const ideaSafetySnapshot = {
  assurance: "none",
  members: [],
  mode: "idea",
} as const;

export const ideaSafetyCanonicalJson =
  '{"assurance":"none","members":[],"mode":"idea"}' as const;

export type GenerationTargetMember = {
  householdMemberId: string;
  anonymousRef: string;
  displayNameSnapshot: string;
};

export type GenerationContextBase = {
  pantryItems: readonly PantryItem[];
  expiredPantryChecks: readonly ExpiredPantryCheck[];
  idempotencyKey: string;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetySnapshot: Readonly<Record<string, unknown>>;
};

export type HouseholdGenerationContext = GenerationContextBase & {
  targetMode: "household";
  submission: Extract<PlannerSubmission, { targetMode: "household" }>;
  safety: CurrentSafetyContext;
  memberPreferences: readonly GenerationMemberPreference[];
  targetMembers: readonly GenerationTargetMember[];
  allergenVersion: string;
  foodRuleVersion: string;
};

export type IdeaGenerationContext = GenerationContextBase & {
  targetMode: "idea";
  submission: Extract<PlannerSubmission, { targetMode: "idea" }>;
  safety: null;
  memberPreferences: readonly [];
  targetMembers: readonly [];
  allergenVersion: null;
  foodRuleVersion: null;
};

export type GenerationContext = HouseholdGenerationContext | IdeaGenerationContext;

export type GenerationSuccessBase = {
  requestId: string;
  menu: ValidatedMenu;
  preferenceSnapshot: Readonly<Record<string, unknown>>;
  safetyFingerprint: string;
  expiredChecks: readonly ExpiredPantryCheck[];
  sourceMenuId: string | null;
  changeReason: string | null;
  changeReasonCustom: string | null;
};

export type GenerationSuccessInput =
  | (GenerationSuccessBase & {
      targetMode: "household";
      safetySnapshot: Readonly<Record<string, unknown>>;
      allergenVersion: string;
      foodRuleVersion: string;
      targetMembers: readonly GenerationTargetMember[];
    })
  | (GenerationSuccessBase & {
      targetMode: "idea";
      safetySnapshot: typeof ideaSafetySnapshot;
      allergenVersion: null;
      foodRuleVersion: null;
      targetMembers: readonly [];
    });

export type GenerationSuccessWriter = {
  succeed: (input: GenerationSuccessInput) => Promise<QuotaRequestRecord>;
};
```

- idea contextは`safety: null`、`memberPreferences: []`、`targetMembers: []`、`allergenVersion: null`、`foodRuleVersion: null`。household contextの既存型は維持する。
- DB helper名は`private.idea_safety_fingerprint()`。家族表・catalog表を読まず固定JSONのSHA-256 lowercase hexを返す。
- `createGenerationRepository()`の戻り値は既存methodを維持し、`succeed`が`GenerationSuccessWriter`を満たす。`finalize_ai_generation_success`とともに上の判別可能unionを唯一の入口にする。ideaでversion文字列や家族対象をサム値に置換しない。
- shopping RPCは既存replay hitを最優先し、replay miss後にowner+menu version lock、直後にmode検査、次にshopping safety lock/書込みの順序とする。

- [ ] **Step 1: idea fingerprintとcontext非送信の失敗するテストを書く**

```ts
it("hashes only the fixed idea safety snapshot", () => {
  expect(ideaSafetyCanonicalJson).toBe('{"assurance":"none","members":[],"mode":"idea"}');
  expect(createIdeaSafetyFingerprint()).toMatch(/^[0-9a-f]{64}$/);
});

it("does not query household data for idea mode", async () => {
  const context = await loadExecutionContext(ideaCommand, requestId, deadline);
  expect(householdRepository.listMembers).not.toHaveBeenCalled();
  expect(context.generationContext).toMatchObject({
    targetMode: "idea",
    safety: null,
    memberPreferences: [],
    targetMembers: [],
  });
});
```

adversarial testは家族表示名・アレルギー・好みに別々のcanaryを保存し、context DTO、OpenRouter message、snapshot、menu子行の全てで0件を期待する。

`database.test.ts`へ`finalize_ai_generation_success.Args`の両versionが`string | null`で、ideaのnull引数とhouseholdのstring引数を受ける型テストを先に追加する。

- [ ] **Step 2: focused VitestのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/safety/idea-fingerprint.test.ts shared/safety/validate-generated-menu.test.ts src/shared/types/database.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts`

Expected: FAIL。idea helperとmode分岐が未実装。

- [ ] **Step 3: migrationをCLIで作成してDB REDを書く**

Run: `docker compose run --rm --no-deps app npx supabase migration new idea_generation_boundary`

Expected: 新しいmigration pathが1件表示される。exact pathをTask reportへ記録する。

pgTAPへ固定fingerprint、idea完了時の空member子行、version null、人数不一致拒否、household helper回帰、shopping直接RPC拒否、mutation/list version不変を追加する。

- [ ] **Step 4: mode別GenerationContextとpromptを実装する**

new menuのfrozen submissionがhouseholdなら既存家族読出しを実行する。ideaなら家族・allergen・age rule queryを呼ばず、pantry/自由条件/共通制約だけでcontextを作る。prompt builderはidea時に`members`、`memberPreferences`、`allergies`、`ageBands`、`adaptations`要求を含めない。医療・治療食拒否とpantry owner/期限検査は両modeで維持する。

- [ ] **Step 5: AI output validationとmaterializationをmode-awareにする**

ideaは`adaptations.length === 0`、`labelConfirmations.length === 0`、family-specific safety actions 0件、`menu.servings === frozenSubmission.servings`を必須にする。householdの現在の人数・匿名member ref・ラベル確認検査は変更しない。materializerはideaで`menu_target_members`、`menu_member_adaptations`、`menu_safety_actions`、`menu_label_confirmations`を作らない。

- [ ] **Step 6: DB idea helperとfinalize境界を実装する**

`private.idea_safety_fingerprint()`は`digest(convert_to('{"assurance":"none","members":[],"mode":"idea"}','UTF8'),'sha256')`をhex化する。`public.finalize_ai_generation_success`は引数型・順序・戻り値を変えず、関数本体だけを置換する。PostgreSQLの`text`引数は元からNULLを受け取れるため、ideaでは`p_allergen_version`と`p_food_rule_version`のNULLを許容するmode分岐を本体へ追加する。ideaでは対象家族0件、family子行0件、保存人数一致、固定snapshot/fingerprint一致、version列nullを検査する。householdでは両versionをnon-null検査し、既存`lock_and_assert_current_safety_fingerprint`をそのまま呼ぶ。両modeでowner、request status、HMAC、source lineage、quotaを維持する。

RPC内の順序はrequest `FOR UPDATE`→snapshot mode読出し→mode別不変条件→source lineage lock→menu/子行永続化→quota更新とする。失敗時は同一transactionのためmenu、子行、quotaの部分更新を残さない。function置換後は既存signatureの`EXECUTE`を`public,anon`からrevokeし、`service_role`だけへgrantする。

型生成後、`database.ts`の`finalize_ai_generation_success.Args` overlayで`p_allergen_version`と`p_food_rule_version`を`string | null`へ上書きする。`database.test.ts`はhousehold引数の両値がstring、idea引数の両値がnullで型検査を通り、それ以外の引数型を緩めないことを`expectTypeOf`で固定する。

- [ ] **Step 7: shopping RPCのidea拒否を新migrationで置換する**

`public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)`と`public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)`のsignatureおよびJSON responseは変更しない。両RPCの先頭にあるidempotency replay lookupを移動しない。replay miss後は次の順序に揃える。

1. draftは`p_menu_id+p_user_id`、reconciliationは`p_source_menu_id+p_source_menu_version+p_user_id`でmenuを`FOR SHARE`取得する。
2. menu欠損/version不一致を既存codeで拒否する。
3. 直後に`target_mode`を検査する。
4. householdだけ既存shopping safety lock、active list `FOR UPDATE`、list/source/items書込みへ進む。

mode判定より前にはactive listをlockせず、shopping safety helperも呼ばない。これによりidea拒否はlist version、mutation ledger、source row、label confirmationを変更しない。

```sql
if v_menu.target_mode <> 'household' then
  raise exception using errcode = '22023', message = 'idea_menu_not_supported';
end if;
```

この判定より前にshopping list行、source snapshot、list version、shopping safety lockを変更しない。既存signatureのrevoke/grantを新migration末尾で再宣言する。

- [ ] **Step 8: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `docker compose run --rm --no-deps app npx vitest run shared/safety/idea-fingerprint.test.ts shared/safety/validate-generated-menu.test.ts src/shared/types/database.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。householdの既存generation test結果数を減らさない。

- [ ] **Step 9: コミットする**

```bash
git add shared/safety netlify/functions/_shared src/shared/types/database.generated.ts src/shared/types/database.ts src/shared/types/database.test.ts supabase/migrations supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/04_menu_core.test.sql supabase/tests/database/shopping_lists.test.sql supabase/tests/database/shopping_lists_races.test.sql
git commit -m "feat: アイデア生成の安全境界を追加"
```

---

### Task 6: /welcome、献立wizard、最低限安全なidea結果を公開する

**Files:**
- Create: `src/features/welcome/welcome-page.tsx`
- Create: `src/features/welcome/welcome-page.test.tsx`
- Create: `src/features/auth/root-entry-page.tsx`
- Create: `src/features/auth/root-entry-page.test.tsx`
- Create: `src/features/planner/model/planner-wizard.ts`
- Create: `src/features/planner/model/planner-wizard.test.ts`
- Create: `src/features/planner/components/planner-wizard.tsx`
- Create: `src/features/planner/components/planner-wizard.test.tsx`
- Create: `src/features/planner/components/meal-step.tsx`
- Create: `src/features/planner/components/ingredient-step.tsx`
- Create: `src/features/planner/components/cuisine-step.tsx`
- Create: `src/features/planner/components/audience-step.tsx`
- Create: `src/features/planner/components/review-step.tsx`
- Modify: `src/app/router.tsx`
- Modify: `src/app/router.test.tsx`
- Modify: `src/features/auth/protected-routes.tsx`
- Modify: `src/features/auth/protected-routes.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/features/planner/planner-route-conflict.test.tsx`
- Modify: `src/features/planner/planner-route-limits.test.tsx`
- Modify: `src/features/privacy/privacy-copy.ts`
- Modify: `src/features/privacy/privacy-notice-page.tsx`
- Modify: `src/features/privacy/privacy-notice-page.test.tsx`
- Modify: `shared/contracts/menu-result.ts`
- Modify: `src/features/generation/api/menu-result-api.ts`
- Modify: `src/features/generation/api/menu-result-api.test.ts`
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `src/features/generation/components/menu-result.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `e2e/specs/onboarding.spec.ts`
- Modify: `e2e/specs/auth-recovery.spec.ts`
- Modify: `e2e/specs/oauth-mock.spec.ts`
- Modify: `e2e/specs/generation-recovery-results.spec.ts`

**Interfaces:**
- Consumes: Task 1 UI、Task 2 status、Task 3 draft union、Task 4 v2 pending、Task 5 idea server。
- Produces:

```ts
export const plannerSteps = ["meal", "ingredients", "cuisine", "audience", "review"] as const;
export type PlannerStep = (typeof plannerSteps)[number];
export function firstIncompletePlannerStep(draft: PlannerDraftInput): PlannerStep;

export type MenuResultLabelConfirmation = {
  confirmationId: string;
  sourceType: ValidatedMenu["labelConfirmations"][number]["sourceType"];
  sourceId: string;
  sourcePath: string;
  sourceText: string;
  allergenName: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
  requirementSafetyFingerprint: string;
  isCurrent: true;
  confirmedAt: string | null;
  confirmedBy: string | null;
};

export type MenuResultViewModel = {
  targetMode: TargetMode;
  sourceSubmission: PlannerSubmission | null;
  menu: ValidatedMenu;
  memberLabels: Readonly<Record<string, string>>;
  labelConfirmations: readonly MenuResultLabelConfirmation[];
  pantryPostCookTargets: readonly PantryPostCookTarget[];
};

export type PlannerStepProps<TValue> = {
  value: TValue;
  onChange: (value: TValue) => void;
  onBack?: () => void;
  onNext: () => void;
  disabled: boolean;
};

export type PlannerWizardProps = {
  draft: PlannerDraftInput;
  step: PlannerStep;
  eligibleMembers: readonly HouseholdMember[];
  isSaving: boolean;
  error: string | null;
  onDraftChange: (next: PlannerDraftInput) => void;
  onStepChange: (next: PlannerStep) => void;
  onSubmit: () => Promise<void>;
};

export type WelcomePageProps = {
  onboardingStatus: OnboardingStatus;
  onStartIdea: () => Promise<void>;
  onStartHousehold: () => Promise<void>;
};
```

- `/`はprofileが`not_started|in_progress`なら`/welcome`、`complete|skipped`なら`/planner`。`/planner`直接URLは全statusで許可する。
- Task 6のidea結果は本文閲覧と常時noticeだけを提供する。採用、お気に入り、再生成、買い物、冷蔵庫、family revalidation、family領域は表示しない。

- [ ] **Step 1: wizard modelとstep UIの失敗するテストを書く**

```ts
it("resumes a migrated legacy draft at audience without losing answers", () => {
  expect(
    firstIncompletePlannerStep({
      ...completeQuestionAnswers,
      targetMode: null,
      targetMemberIds: [],
      servings: null,
    }),
  ).toBe("audience");
});
```

component testは固定順、戻る時の回答保持、家族0件の登録link、idea人数1〜6 buttonと7〜20 number input、未選択既定値なし、reviewの編集操作、保存失敗時の現在step維持、heading focusを検証する。

家族モード選択後に対象家族が0件になった場合はmode未選択へ戻り、ideaへ自動降格しないことも固定する。profileが`complete`でも利用可能家族0件ならhousehold選択をdisabledにし、ideaと家族追加linkを表示する。

- [ ] **Step 2: welcome、router、minimum resultの失敗するテストを書く**

router testで`/welcome`が`RequireSession`配下、主要routeが`RequireCompletedOnboarding`配下でないことを期待する。result testでidea resultが`useMenuRevalidation`を呼ばず、注意とrecipe本文を表示し、家族領域と5操作を表示しないことを期待する。

- [ ] **Step 3: focused VitestのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/welcome/welcome-page.test.tsx src/features/auth/root-entry-page.test.tsx src/app/router.test.tsx src/features/auth/protected-routes.test.tsx src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx`

Expected: FAIL。新画面・wizard・mode result分岐が未実装。

- [ ] **Step 4: welcomeとroot振分けを実装する**

`WelcomePage`はprofileを取得し、not_startedで「献立アイデアを考える」「家族情報を登録する」、in_progressで「設定せず献立アイデアを考える」「家族設定を続ける」を表示する。idea開始は`setOnboardingStatus(...,"skipped")`成功後に`/planner`、家族導線は`setOnboardingStatus(...,"in_progress")`成功後に`/onboarding`。`RootEntryPage`はprofile statusだけでNavigate先を決める。

- [ ] **Step 5: PlannerWizardと5 stepを実装する**

route層はdraft/autosave/conflict/usage/generationを維持し、表示だけ`PlannerWizard`へ委譲する。`PlannerWizard`は`PlannerStep`、draft値、保存状態、step移動callbackを受け、DB/APIを直接呼ばない。各stepは`PlannerStepProps<TValue>`を満たし、value更新だけを親へ通知する。

- [ ] **Step 6: meal、ingredient、cuisine stepを実装する**

`MealStep`は時間帯、`IngredientStep`は主食材、`CuisineStep`はジャンルを既存contractの選択肢だけで表示する。初期未選択、戻る/進む、heading focus、選択後も次画面から戻れば値が残ることを各component testで固定する。

- [ ] **Step 7: audience stepのmode不変条件を実装する**

household選択は利用可能家族1人以上を要求しservingsをnull、idea選択はmember IDsを空にして人数を毎回明示選択させる。modeを切り替える場合、以前のhousehold IDsまたはidea人数を送信可能状態へ残さない。利用可能家族が0件になったhousehold draftはmode未選択へ戻し、ideaへ自動降格しない。

- [ ] **Step 8: review stepと送信pipelineを実装する**

任意条件はreview内のdetails/dialogから開き、時間、予算、避ける食材、memo、pantry選択を既存componentで編集する。生成時は`plannerSubmissionSchema.parse`、autosave flush、privacy consent確認、v2 pending作成の順に進む。profileが`not_started|in_progress`の利用者がaudienceでideaを確定した時だけ`setOnboardingStatus(...,"skipped")`を呼び、`/planner`へ直接開いただけではstatusを変更しない。

- [ ] **Step 9: AI情報説明の往復を実装する**

同意未確認時はdraft flush後に`/privacy?returnTo=%2Fplanner%3Fresume%3Dreview`へ移動する。PrivacyNoticePageの「同意して続ける」と「今はAIを使わない」は両方sanitized returnToへ戻るが、後者では同意を保存しない。reviewはprivacy query未確認なら生成buttonをdisabledにして説明linkを表示する。

- [ ] **Step 10: guardを外しルート契約を更新する**

`RequireSession`は維持する。`RequireCompletedOnboarding` componentとimportを削除し、AppShell配下へ`/planner`、`/generation`、`/menus/:menuId`、`/pantry`、`/history`、`/shopping`、`/settings`を直接配置する。`/emergency-menus`の到達性を維持する。`/welcome`と`/onboarding`はRequireSession配下に置く。

- [ ] **Step 11: minimum idea result boundaryを実装する**

menu result queryへ`target_mode`と`preference_snapshot`を追加する。`preference_snapshot.submission`を`plannerSubmissionSchema.safeParse`し、成功時だけ`sourceSubmission`へ設定する。`MenuResultPage`はaggregate読込後にhousehold bodyまたはidea bodyへ分岐し、household bodyだけが`useMenuRevalidation`をmountする。idea bodyは`InlineNotice`で「家族条件を使用していません」「年齢・アレルギーへの適合は確認されていません」を常時表示し、`MenuResult`へ`mode="idea"`とactionsなしを渡す。`MenuResult`はideaでadaptation、label confirmation、family safety summaryをrenderしない。

- [ ] **Step 12: 既存E2E導線を新しいrouteへ更新する**

auth fixtureはログイン後の`/welcome`または`/planner`をstatus別に待つ。onboarding、auth recovery、OAuthの旧`/onboarding`強制期待を新root分岐へ変更する。generation E2Eへ「家族設定を省略→4質問→idea人数→privacy→review→生成→notice付き本文」を追加する。Task 6ではidea操作buttonが存在しないことも確認する。

- [ ] **Step 13: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/welcome/welcome-page.test.tsx src/features/auth/root-entry-page.test.tsx src/app/router.test.tsx src/features/auth/protected-routes.test.tsx src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/privacy/privacy-notice-page.test.tsx src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: focused Vitestと全E2Eを含め全てexit 0。idea resultに家族向け操作・表示がない。

- [ ] **Step 14: コミットする**

```bash
git add src/app src/features/auth src/features/welcome src/features/planner src/features/privacy src/features/generation shared/contracts/menu-result.ts e2e/fixtures/auth.ts e2e/specs/onboarding.spec.ts e2e/specs/auth-recovery.spec.ts e2e/specs/oauth-mock.spec.ts e2e/specs/generation-recovery-results.spec.ts
git commit -m "feat: 家族設定任意の献立ウィザードを公開"
```

---

### Task 7: idea結果、履歴、再生成を完全対応する

**Files:**
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `src/features/generation/components/menu-result.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`
- Modify: `src/features/history/api/history-api.ts`
- Modify: `src/features/history/model/group-history.ts`
- Modify: `src/features/history/model/group-history.test.ts`
- Modify: `src/features/history/components/history-card.tsx`
- Modify: `src/features/history/pages/history-page.tsx`
- Modify: `src/features/history/pages/history-page.test.tsx`
- Modify: `src/features/history/pages/history-detail-page.tsx`
- Modify: `src/features/history/pages/history-detail-page.test.tsx`
- Modify: `src/features/history/components/regeneration-sheet.tsx`
- Modify: `src/features/history/components/regeneration-sheet.test.tsx`
- Modify: `src/features/history/hooks/use-regeneration.ts`
- Modify: `src/features/history/hooks/use-regeneration.test.tsx`
- Create: `src/features/planner/model/draft-from-menu.ts`
- Create: `src/features/planner/model/draft-from-menu.test.ts`
- Modify: `src/features/generation/api/menu-result-api.ts`
- Modify: `src/features/generation/api/menu-result-api.test.ts`
- Modify: `shared/contracts/generation.ts`
- Modify: `netlify/functions/_shared/regeneration-context.ts`
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `e2e/fixtures/history.ts`
- Modify: `e2e/specs/history-regeneration.spec.ts`
- Modify: `e2e/specs/generation-recovery-results.spec.ts`

**Interfaces:**
- Consumes: Task 6の`MenuResultViewModel.targetMode/sourceSubmission`、mode別result body、Task 4/5のsnapshot/finalize。
- Produces:

```ts
export type RegenerationSheetProps = {
  targetMode: TargetMode;
  remaining: number;
  onSubmit: (reason: RegenerationReasonInput) => Promise<void>;
  onCancel: () => void;
};

export function createPlannerDraftFromMenu(
  submission: PlannerSubmission,
): PlannerDraftInput;

export type UseRegenerationInput =
  | {
      targetMode: "household";
      menuId: string;
      phase: RevalidationPhaseName;
      result: RevalidationResult | undefined;
    }
  | {
      targetMode: "idea";
      menuId: string;
      phase: null;
      result: null;
    };
```

- idea result/historyは家族revalidationを呼ばない。採用、お気に入り、所有者/version検査付き冷蔵庫反映、whole/dish再生成を許可する。買い物は非表示のまま。
- `child_friendly`はidea UIに出さず、serverがsource snapshotのmodeを見て`invalid_request`で外部送信前に拒否する。

- [ ] **Step 1: result/history mode表示と操作の失敗するテストを書く**

idea result/detailでnotice、採用、お気に入り、冷蔵庫、whole/dish再生成が利用でき、買い物・label確認・family revalidationがないことをassertする。history cardに「アイデア」「家族に合わせた献立」の識別表示をassertする。

「対象を変えて新しく作る」は`menus.preference_snapshot.submission`をZodで`PlannerSubmission`へ絞り、食事、主食材、ジャンル、任意条件、pantry選択を新しいdraftへコピーし、`targetMode`、`targetMemberIds`、`servings`だけを未選択へ戻してaudienceから開始することをassertする。不正snapshotは操作を表示せず、再生成commandのmode変更として実装しない。

- [ ] **Step 2: regeneration mode維持とchild_friendly拒否の失敗するテストを書く**

```ts
it("hides child_friendly for idea menus", () => {
  render(<RegenerationSheet targetMode="idea" remaining={3} onSubmit={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.queryByRole("radio", { name: "子どもが食べやすく" })).not.toBeInTheDocument();
});

it("rejects an idea child_friendly command before provider send", async () => {
  const status = await runGeneration(deps, ideaChildFriendlyCommand);
  expect(status).toMatchObject({ status: "failed", code: "invalid_request" });
  expect(deps.callOpenRouter).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: focused VitestのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx src/features/history/model/group-history.test.ts src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.test.tsx src/features/history/components/regeneration-sheet.test.tsx src/features/history/hooks/use-regeneration.test.tsx src/features/planner/model/draft-from-menu.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-service.test.ts`

Expected: FAIL。idea操作、history mode、reason制約が未実装。

- [ ] **Step 4: history queryとcard/detailをmode-awareにする**

history一覧selectへ`target_mode`を追加し、group modelへ`targetMode`を保持する。cardは文字badgeでmodeを示す。detailはmenu aggregate取得後に分岐し、householdだけrevalidation hookをmountする。ideaは常時noticeと本文を表示し、保存済みsnapshotを家族安全表示として解釈しない。

- [ ] **Step 5: idea resultの許可操作を有効化する**

採用は既存`useAcceptMenuVersion`、お気に入りは既存`setMenuFavorite`、冷蔵庫反映は現在のpantry owner/updatedAt競合APIを使う。これらはfamily fingerprintを要求しない分岐にする。label確認callbackはideaでは作らない。買い物buttonはDOMへ出さない。

- [ ] **Step 6: mode別再生成hookと理由制約を実装する**

`useRegeneration`は上のunionを受け、householdだけ`phase === "checked"`かつactionable resultを要求する。ideaはrevalidation引数を受けず、それ以外のowner、pending保存、quota/生成中制御を共有する。clientはsource menu ID、dish ID、reasonだけをv2 wireで送る。mode/servings/member IDsは送らず、Task 4 snapshotが元menuから複製する。`RegenerationSheet`はideaで`child_friendly`をfilterする。serverはsnapshot作成後かつmarkSent前にidea+child_friendlyを拒否する。whole/dish両方でsource mode、servings、lineage versionを維持する。

- [ ] **Step 7: 対象変更を新規draftとして実装する**

menu result queryはowner RLS下で`preference_snapshot`を読み、`plannerSubmissionSchema`で検査した`sourceSubmission`だけをview modelへ公開する。mode変更操作は`createPlannerDraftFromMenu`を使う新規作成として実装し、元menu条件を保持しながら対象3項目だけnull/空へ戻す。保存成功後に`/planner?resume=audience`へ遷移し、元menuのderivation groupや再生成lineageへ追加しない。

- [ ] **Step 8: E2Eを両modeへ拡張する**

history E2Eへidea card badge、detail notice、favorite、accept、冷蔵庫反映、whole/dish再生成、再生成後もidea、child_friendly不存在、買い物不存在を追加する。household既存経路は現在の安全再検証とchild_friendlyを維持する。

- [ ] **Step 9: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx src/features/history/model/group-history.test.ts src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.test.tsx src/features/history/components/regeneration-sheet.test.tsx src/features/history/hooks/use-regeneration.test.tsx src/features/planner/model/draft-from-menu.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-service.test.ts`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。householdとideaの両fixtureが成功する。

- [ ] **Step 10: コミットする**

```bash
git add src/features/generation src/features/history src/features/planner/model/draft-from-menu.ts src/features/planner/model/draft-from-menu.test.ts shared/contracts/generation.ts netlify/functions/_shared/regeneration-context.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-service.ts netlify/functions/_shared/generation-service.test.ts e2e/fixtures/history.ts e2e/specs/history-regeneration.spec.ts e2e/specs/generation-recovery-results.spec.ts
git commit -m "feat: アイデア献立の履歴と再生成に対応"
```

---

### Task 8: セキュリティ統合、アクセシビリティ、全体回帰を完了する

**Files:**
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/tests/database/ai_control_and_quota_races.test.sql`
- Modify: `supabase/tests/database/history_regeneration.test.sql`
- Modify: `supabase/tests/database/shopping_lists.test.sql`
- Modify: `supabase/tests/database/shopping_lists_races.test.sql`
- Modify: `tools/openrouter-mock/fixtures/scenarios.mjs`
- Modify: `tools/openrouter-mock/fixtures/scenarios.d.mts`
- Modify: `e2e/specs/onboarding.spec.ts`
- Modify: `e2e/specs/generation-recovery-results.spec.ts`
- Modify: `e2e/specs/history-regeneration.spec.ts`
- Modify: `e2e/specs/foundation.spec.ts`

**Interfaces:**
- Consumes: Task 1〜7の全確定interface。
- Produces: リリース可能な検証証跡のみ。product contractは追加しない。

- [ ] **Step 1: adversarial canary matrixを完成させる**

family display name、standard allergy、custom allergy、dislike、portion、spice、ease preferenceへ別々のcanaryを入れる。idea生成のhousehold query戻り値、GenerationContext、OpenRouter request body、safety snapshot、menu target/adaptation/action/label子行を検査し、全canary 0件を期待する。household controlでは同じfixtureが匿名化済みDTOへ必要な値だけ反映されることを確認する。

- [ ] **Step 2: mode矛盾と人数改変matrixを全境界へ追加する**

共有schema、HTTP handler、integrity resolver、reserve RPC、context loader、output validator、finalize RPCへ次の4系統を通す。

```text
idea + non-empty member IDs
idea + null/out-of-range/different servings
household + empty member IDs
household + non-null direct servings
```

各拒否でprovider send 0、menu 0、success消費0をassertする。

- [ ] **Step 3: v1/v2 concurrencyとsource raceを実DBで検証する**

同じlegacy keyを2 sessionでclaimし、v2 keyが1つ、request成功が1つ、quota/attemptが1系列であることをpgTAP/race harnessで確認する。遅延legacy claimは既存`claimed_v2` mappingを返し、旧reserve RPCを呼ばない。whole/dish再生成は予約後のsource変更・削除を外部送信前と送信後に分け、`source_menu_changed`、attempt返却/消費、success非消費、menu 0件を確認する。

- [ ] **Step 4: shopping直接RPCと不変性を検証する**

service role相当のDB sessionからidea menuを`apply_shopping_draft`と`apply_shopping_reconciliation`へ渡し、`idea_menu_not_supported`を期待する。呼出し前後のshopping list row、item row、source row、snapshot row、list version、mutation ledger rowを比較し、replay hit以外は全て不変であることをassertする。

- [ ] **Step 5: Playwrightへ320px、keyboard、reduced-motion、復帰を追加する**

320px/200%で`document.documentElement.scrollWidth === document.documentElement.clientWidth`、全主要操作のbounding boxが44px以上、Tabだけで4質問・review・privacy・生成へ到達、step変更時heading focus、進捗読み上げ、選択中文字、通信切断後の同一mode/idempotency回収を検証する。`prefers-reduced-motion: reduce`ではwizard animation名が`none`であることを確認する。

- [ ] **Step 6: 統合テスト変更をfocused実行する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-service.test.ts src/features/planner/planner-page.test.tsx src/features/generation/pages/menu-result-page.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `./scripts/run-e2e.sh`

Expected: canary、矛盾、race、shopping、UIの全追加caseが成功する。

- [ ] **Step 7: Task 8変更をコミットする**

```bash
git add netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-service.test.ts src/features/planner/planner-page.test.tsx src/features/generation/pages/menu-result-page.test.tsx supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/history_regeneration.test.sql supabase/tests/database/shopping_lists.test.sql supabase/tests/database/shopping_lists_races.test.sql tools/openrouter-mock/fixtures/scenarios.mjs tools/openrouter-mock/fixtures/scenarios.d.mts e2e/specs/onboarding.spec.ts e2e/specs/generation-recovery-results.spec.ts e2e/specs/history-regeneration.spec.ts e2e/specs/foundation.spec.ts
git commit -m "test: 家族設定任意化の統合境界を検証"
```

- [ ] **Step 8: 必須9段階gateを順番どおり実行する**

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npx vitest run`

Run: `./scripts/reset-local-db.sh`

Run: `docker compose --profile test run --rm db-test`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run build`

Run: `git diff --check`

Expected: 9コマンドすべてexit 0。失敗した場合は原因を修正し、失敗step以降を順番どおり再実行する。

- [ ] **Step 9: Plan全体の最終レビューを行う**

`AGENTS.md` 9章に従い、`reviewer`役のTOMLまたは親設定を正としてTask 1開始前commitからTask 8 HEADまでのreview packageを渡す。設計適合性、RLS/owner、HMAC、legacy replay、family canary、shopping不変性、アクセシビリティ、household回帰を確認する。contextを共有しない別ReviewerがCritical/Important指摘を再現検証し、妥当な指摘はfresh Implementerで修正後、9段階gateと両レビューを再実行する。未解決Critical/Importantが0件になった時だけPlan完了とする。

---

## Task Completion Protocol

各Taskで次を順番どおり行う。

1. `.superpowers/sdd/progress.md`と`git log`を確認し、Task briefとreportのexact pathを新規作成する。
2. clean baselineを記録し、fresh ImplementerがRED→GREEN→対象リファクタリング→focused検証→日本語Conventional Commitを行う。
3. 実装前baseと実装commitからreview packageを生成する。
4. fresh VerifierがTask記載コマンドを独立実行し、pass/failと失敗excerptだけをreportへ記録する。
5. fresh一次Reviewerが仕様適合、品質、セキュリティ、敵対入力、境界、回帰、テスト不足を確認する。
6. contextを共有しないfresh二次Reviewerが一次指摘と変更全体を深掘りする。
7. Critical/Importantがあればfresh Implementerでまとめて修正し、review package、Verifier、両Reviewerを繰り返す。
8. `.superpowers/sdd/progress.md`へ完了行を追記する。
9. 次Taskがある場合は`AGENTS.md`指定のwrite-once handoffを作成し、canonical pathとGit正本を再確認してから次Taskへexact pathだけを渡す。

## Completion Criteria

- 家族0人のログイン利用者が`/welcome`からidea modeを選び、4質問、人数、privacy説明、review、生成、結果、履歴、再生成を完了できる。
- household modeの安全確認、revalidation、label確認、target members、quota、HMAC、復帰が回帰しない。
- idea modeの全レイヤーで家族情報canaryが0件、家族向け安全表示が0件、買い物操作が0件である。
- v1 replay/処理中回収、v2新規、legacy pending claimが30日境界内で二重予約・二重attempt・二重successを起こさない。
- 全migration、生成型、Vitest、pgTAP、Playwright、build、diff checkが一致し、最終一次・二次レビューに未解決Critical/Importantがない。
