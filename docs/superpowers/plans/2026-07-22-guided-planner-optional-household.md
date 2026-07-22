# 献立作成ウィザード・家族設定任意化 Implementation Plan

**Plan ID:** 7（handoffとprogressで使用する数値ID）

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
- `TargetMode`は`"household" | "idea"`の明示値だけを正本とする。空の`targetMemberIds`からモードを推測しない。
- household提出は対象家族1〜20件・`servings: null`、idea提出は対象家族0件・`servings`整数1〜20。下書きだけは`targetMode: null`・`servings: null`を許可する。
- 家族モードの現行安全確認、HMAC、冪等性、quota、回復、所有者、RLSを弱めない。アイデアモードは家族、年齢、アレルギー、好みを読まず、AI送信DTO・snapshot・完成献立子行へ混入させない。
- アイデアモードの結果は「家族条件を使用していません」を常時表示する。買い物リスト操作と`child_friendly`再生成をUI・API・DB境界で拒否する。
- core paletteはリネン`#f7f2e9`、アイボリー`#fffdf8`、ソフトクレイ`#d9a48f`、ディープクレイ`#8b4e3b`、本文`#423a32`、補足`#6b5e52`、選択面`#f4e6df`、注意面`#f8ece7`の8色を正とする。機能上の意味を保つscoped functional tokenとしてborder `#d8c9bc`、pantry state `#416b5a`、danger/error ink `#9f342c`を`.guided-planner-theme`配下だけで使い、core paletteやglobal tokenの置換とは扱わない。global `:root`、`body`、共通button/field、全`.app-section`の既存外観を置換しない。
- UIは320 CSS pxと200%拡大で横スクロールを起こさず、操作領域44px以上、通常文字・補足文字・主要ボタン4.5:1以上、3pxの`#8b4e3b` focus ring、`prefers-reduced-motion`対応を満たす。選択面とnotice面も含め、本文/選択面9.15:1、補足/選択面5.15:1、本文/注意面9.64:1、補足/注意面5.42:1、danger/注意面6.04:1、pantry/カード5.94:1を回帰検証する。
- UI文言、コードコメント、コミットメッセージは日本語。識別子とテスト名は英語。TypeScriptはstrict、`any`と未検査castを追加しない。
- 各TaskのDB変更後は型生成、対象pgTAP、対象Vitestを同じTask内で通す。Task 8は`AGENTS.md`の9段階gateを順番どおり完走する。
- Task完了後に次Taskがある場合、親は`AGENTS.md`指定形式のwrite-once handoffを安全確認後に新規作成し、次Taskスレッドへexact pathだけを渡す。
- 本機能は本番その他の永続利用環境へ未デプロイである。旧データ、旧端末保存、旧HTTP command、処理中の旧requestとのリリース間後方互換を実装せず、clean reset上のv2契約だけを完成させる。

## Supabase確認事項

- 新しい`public`表・関数がData APIへ自動公開される前提を置かず、必要なgrantをmigrationへ明記する。今回新設するrequest snapshotは`private` schemaだけに置く。
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
| `src/features/planner/model/planner-wizard.test.ts` | 対象未選択下書きと戻る・進むの決定論的検証 |
| `src/features/planner/components/planner-wizard.tsx` | wizardの状態表示とstep切替 |
| `src/features/planner/components/meal-step.tsx` | 食事質問 |
| `src/features/planner/components/ingredient-step.tsx` | メイン食材質問 |
| `src/features/planner/components/cuisine-step.tsx` | ジャンル質問 |
| `src/features/planner/components/audience-step.tsx` | 家族/idea選択とidea人数 |
| `src/features/planner/components/review-step.tsx` | 条件一覧、任意条件、注意、生成操作 |
| `src/features/planner/current-safety-summary.tsx` | 既存家族安全表示の文字・role契約を維持 |
| `src/features/planner/planner-page.tsx` | 旧一枚フォームからwizard compositionへ変更 |
| `src/features/planner/planner-route.tsx` | draft取得・autosave・競合・同意往復・生成開始 |
| `src/app/router.tsx` | `/welcome`、root振分け、guard撤去 |
| `src/features/auth/protected-routes.tsx` | `RequireSession`維持、完了guard削除 |

### 共有契約・生成サーバー

| ファイル | 責務 |
| --- | --- |
| `shared/contracts/domain.ts` | `OnboardingStatus`へ`skipped`追加 |
| `shared/contracts/planner.ts` | `TargetMode`、draft、判別可能なsubmission |
| `shared/contracts/generation.ts` | v2 wire、失敗code、regen mode制約 |
| `shared/contracts/menu-result.ts` | resultの`targetMode`とmode-aware view model |
| `shared/safety/generation-context.ts` | household/ideaの判別可能な生成context |
| `shared/safety/idea-fingerprint.ts` | 固定idea snapshotのcanonical JSONとSHA-256 |
| `netlify/functions/_shared/generation-integrity-context.ts` | HMAC前の権威あるdraft/source読出し |
| `netlify/functions/_shared/generation-command-integrity.ts` | v2 canonical HMAC |
| `netlify/functions/_shared/generation-repository.ts` | reserve/snapshot/finalize RPC adapter |
| `netlify/functions/_shared/generation-context.ts` | new menuのmode別context構築 |
| `netlify/functions/_shared/regeneration-context.ts` | request snapshotとlive sourceのfail-closed照合 |
| `netlify/functions/_shared/generation-prompt.ts` | mode別prompt、idea時の家族情報非送信 |
| `netlify/functions/_shared/generation-service.ts` | mode別検証・保存・attempt処理 |
| `src/features/generation/model/pending-generation.ts` | v2 storage schemaとowner/TTL/request整合性 |
| `src/features/generation/api/generation-api.ts` | v2 POSTとstatus回収 |
| `src/features/generation/components/generation-status-panel.tsx` | 通信失敗と通常回復の表示 |

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
| `netlify/functions/_shared/stored-menu-loader.ts` | 所有者境界内で完成献立と`target_mode`を取得 |
| `netlify/functions/_shared/shopping-service.ts` | 買い物HTTP処理をmode検査後に再検証・RPCへ委譲 |
| `netlify/functions/_shared/shopping-adapter.ts` | shopping RPCと安定error codeのadapter |
| `src/features/shopping/api/shopping-api.ts` | household限定の買い物取得・作成・再調整API |
| `src/features/shopping/hooks/use-shopping-list.ts` | household結果だけでmountする買い物hook |
| `supabase/tests/database/002_household_rls.test.sql` | skipped、時刻、privacy独立 |
| `supabase/tests/database/03_pantry_and_planner_drafts.test.sql` | draft mode/servings制約 |
| `supabase/tests/database/04_menu_core.test.sql` | menu mode別nullability |
| `supabase/tests/database/ai_control_and_quota.test.sql` | v2、snapshot、quota、ownerごとのprocessing制約 |
| `supabase/tests/database/ai_control_and_quota_races.test.sql` | 別backend sessionによるv2予約とsource変更race |
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
- Create: `src/features/planner/current-safety-summary.test.tsx`

**Interfaces:**
- Consumes: 既存`.page-frame`、`.primary-button`、`.secondary-button`、`.text-button`。既存global styleは変更せず、対象画面rootに付ける`.guided-planner-theme`で上書きをscopeする。
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

`src/styles.contrast.test.ts`へ`.guided-planner-theme`内のcore palette 8色とscoped functional token 3色の完全一致、本文/補足/主要操作の4.5:1、hover/activeの4.5:1、focus色の存在を追加する。ChoiceCard selectedの本文/選択面9.15:1、補足/選択面5.15:1と選択枠、InlineNotice notice/errorの本文/注意面9.64:1、補足/注意面5.42:1、danger/注意面6.04:1、およびpantry/カード5.94:1を明示的に検証する。global `:root`、`body`、共通button/field、`.app-section`が設計色へ置換されていないことも固定する。カードの18〜20px角丸、薄いshadow、共通wizard操作の44px以上というvisual/CSS契約を固定する。`wizard-ui.test.tsx`へ次のassertionを書く。

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

`current-safety-summary.test.tsx`では、すでに正しい既存source componentを変更せず、代表的な安全表示が状態を文字と適切な`role`で伝え、色だけへ退行しないことを回帰契約として固定する。

- [ ] **Step 2: focused testを実行してREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/shared/ui/wizard/wizard-ui.test.tsx src/features/planner/current-safety-summary.test.tsx`

Expected: FAIL。新tokenが旧値で、wizard moduleが存在しないため失敗する。

- [ ] **Step 3: CSS tokenを設計値へ変更する**

`src/styles.css`の既存`:root`とglobal要素は維持し、次のtokenを専用scopeへ追加する。welcome、planner wizard、mode-aware result/history childだけがこのclassをrootへ付ける。

```css
.guided-planner-theme {
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

focusは`.guided-planner-theme`内で`outline: 3px solid var(--focus); outline-offset: 2px`、primary hover/activeは同scope内で各tokenを使う。既存のglobal button/field/`.app-section`へは適用しない。

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

Run: `docker compose run --rm --no-deps app npx vitest run src/styles.contrast.test.ts src/shared/ui/wizard/wizard-ui.test.tsx src/features/planner/current-safety-summary.test.tsx`

Expected: PASS。scoped token、global style非変更、focus、ARIA、選択表示の全件が成功する。

- [ ] **Step 7: Task 1検証を実行する**

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。

- [ ] **Step 8: コミットする**

```bash
git add src/styles.css src/styles.contrast.test.ts src/shared/ui/wizard src/features/planner/current-safety-summary.test.tsx
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
- Create: `supabase/tests/database/002c_household_onboarding_races.test.sql`
- Modify: `e2e/specs/onboarding.spec.ts`

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

同じファイルで、同意なし`complete`が完全な家族1人で成功すること、家族なし`complete`は`23514/onboarding_members_incomplete`、`complete`後の最後の家族削除でstatusが変わらないことを追加する。`002c_household_onboarding_races.test.sql`はcommit済みfixtureと専用dblink roleを使い、`set_onboarding_status`同士、および`start_household_onboarding`との別backend session競合を再現する。

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

認証確認後、対象`profiles`行を`SELECT ... FOR UPDATE`で取得し、ロック後の現在値に対して同一状態の冪等判定と遷移判定を行う。`start_household_onboarding`も同じprofile rowを最初にロックする既存順序を維持する。`skipped`から`complete`と`in_progress`を別backend sessionで競合させ、禁止された実効的な`complete→in_progress`が後勝ちで成立しないことを`dblink`で検証する。

```sql
onboarding_completed_at = case
  when p_status in ('complete', 'skipped') then statement_timestamp()
  else null
end
```

最後に`revoke all ... from public, anon, authenticated`後、`grant execute ... to authenticated`を復元する。

- [ ] **Step 5: TypeScript契約とUIの同意分離を実装する**

`onboardingStatuses`へ`skipped`を追加する。`HouseholdOnboardingApi.setProgress`は`OnboardingStatus`を受けるが、Task 2の`HouseholdOnboardingPage`から送る値は`in_progress|complete`だけとする。これは恒久的なglobal UI契約ではなく、Task 6のwelcome/audienceは家族設定を省略する正規操作として`skipped`を送る。家族設定完了操作は`completeMember`成功後に`setProgress("complete")`を呼び、その成功後だけ`/planner`へ遷移する。完全なmemberが既に存在する設定完了操作も同じ順序を使い、どちらかが失敗した場合は現在画面に残って再試行可能なエラーを表示する。`PrivacyNoticePage`から`setOnboardingStatus(...,"complete")`を削除し、同意保存後はsanitized `returnTo`へ遷移する。Task 2がprivacy copyの契約を確定し、両mode共通送信内容、householdだけの家族情報、ideaでは家族情報を送らないことを3項目で示す。component testは`completeMember→setProgress→navigate`の順序、各失敗時の非遷移、privacy同意なしでも完了済みprofileが現行guardを通ることを固定する。

既存`e2e/specs/onboarding.spec.ts`はTask 2で書き換える。入力途中memberの再開からmember完了、profile `complete`、`/planner`への直接遷移までをprivacy同意なしで完走し、その時点で同意が保存されていないことを確認する。その後`/privacy?returnTo=%2Fplanner`を独立して開いて同意を保存し、`/planner`へ戻ってもprofile statusが`complete`のまま変化しないことをassertし、家族設定完了とAI同意の境界をE2Eで固定する。

- [ ] **Step 6: DB型を再生成して型overlayを更新する**

Run: `docker compose run --rm --no-deps app npm run db:types`

Expected: `src/shared/types/database.generated.ts`だけがschema追随で更新される。

`database.ts`の`ProfileRow.onboarding_status` overrideを新しい`OnboardingStatus`へ揃え、`database.test.ts`で`skipped`が代入可能、未知値が代入不可であることを`expectTypeOf`で固定する。

- [ ] **Step 7: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/domain.test.ts src/shared/types/database.test.ts src/features/household/household-api.test.ts src/features/household/household-onboarding-page.test.tsx src/features/privacy/privacy-notice-page.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。ルーターテストは旧guardを維持したまま成功し、既存onboarding E2Eは家族完了とprivacy同意の分離後の導線を通る。

- [ ] **Step 8: コミットする**

```bash
git add shared/contracts/domain.ts shared/contracts/domain.test.ts src/features/household src/features/privacy src/shared/types supabase/migrations supabase/tests/database/002_household_rls.test.sql supabase/tests/database/002a_household_draft_completion_boundary.test.sql supabase/tests/database/002b_household_onboarding_start.test.sql supabase/tests/database/002c_household_onboarding_races.test.sql e2e/specs/onboarding.spec.ts
git commit -m "feat: 家族設定状態とAI同意を分離"
```

---

### Task 3: TargetMode、人数、保存schemaを追加する

**Files:**
- Create via CLI: migration logical name `target_mode_storage`
- Modify: `shared/contracts/planner.ts`
- Modify: `shared/contracts/planner.test.ts`
- Modify: `shared/testing/factories.ts`
- Modify: `shared/emergency/filter-emergency-menus.ts`
- Modify: `shared/emergency/filter-emergency-menus.test.ts`
- Modify: `shared/safety/validate-generated-menu.test.ts`
- Modify: `netlify/functions/_shared/generation-context.ts`
- Modify: `netlify/functions/_shared/generation-context.test.ts`
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `netlify/functions/_shared/generation-materializer.test.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/regeneration-adapter.ts`
- Modify: `netlify/functions/_shared/regeneration-adapter.test.ts`
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`
- Modify: `netlify/functions/_shared/revalidation-adapter.ts`
- Modify: `netlify/functions/_shared/revalidation-adapter.test.ts`
- Modify: `src/features/planner/planner-api.ts`
- Modify: `src/features/planner/planner-api.test.ts`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/features/planner/planner-route-conflict.test.tsx`
- Modify: `src/features/planner/planner-route-limits.test.tsx`
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

- DB列名は`target_mode`と`servings`。clean reset上で新しい列と制約を直接成立させ、旧行のデータ移行は行わない。
- `generation_drafts`の`target_mode`/`servings`は質問途中のためnullable、`private.generation_draft_submission_versions.target_mode`はNOT NULL・`servings`はmode条件付きnullable、`menus.target_mode`/実献立の`servings`はNOT NULLとする。
- `menus.servings`、`safety_snapshot`、`safety_fingerprint`はNOT NULLを維持する。`allergen_dictionary_version`と`food_safety_rule_version`だけをmode条件付きnullableにする。

- [ ] **Step 1: migrationをCLIで新規作成する**

Run: `docker compose run --rm --no-deps app npx supabase migration new target_mode_storage`

Expected: 新しいmigration pathが1件表示される。exact pathをTask brief/reportへ記録し、以後このTaskではそのmigrationだけを編集する。

- [ ] **Step 2: 判別可能unionと矛盾入力の失敗するテストを書く**

```ts
it.each([
  { targetMode: "idea", targetMemberIds: [memberId], servings: 2 },
  { targetMode: "idea", targetMemberIds: [], servings: null },
  { targetMode: "household", targetMemberIds: [], servings: null },
  { targetMode: "household", targetMemberIds: [memberId], servings: 2 },
])("rejects contradictory target values", (target) => {
  expect(plannerSubmissionSchema.safeParse({ ...validBase, ...target }).success).toBe(false);
});

it("keeps mode and servings unselected for an incomplete draft", () => {
  expect(mapPlannerDraft(incompleteTargetDraft)).toMatchObject({
    targetMode: null,
    targetMemberIds: [],
    servings: null,
    mealType: "dinner",
    mainIngredients: ["鶏肉"],
    cuisineGenre: "japanese",
  });
});
```

pgTAPへhousehold/ideaの正常行、4種類の矛盾行、version列のmode別nullabilityを追加する。質問途中のdraft fixtureでは`target_mode is null`、`servings is null`と、食事・食材・ジャンル・任意条件・pantry選択・revisionが保持されることを検証する。さらにTask 3単独の状態で、現行householdの下書き保存→予約→凍結snapshot RPC→runtime context読込→完了を通し、凍結提出、runtimeの`PlannerSubmission`、完成献立へ`targetMode: "household"`、`servings: null`が保持される統合caseを追加する。DB RPCの予約・完了だけを直接呼ぶcaseでは完了扱いにしない。この経路はTask 3→4間の開発時境界だけをgreenに保つ一時ブリッジであり、リリース間互換として残さない。

現行Planner UIとrouteのtyped draft fixtureには`targetMode: "household"`, `servings: null`を明示し、家族選択の最後の1人を外すcaseと既存の20人境界caseを追加する。最後の1人を外した結果は`targetMode: null`, `targetMemberIds: []`, `servings: null`であり、`household + []`を一時状態としても保存しないことを固定する。

- [ ] **Step 3: contract testとDB testのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts shared/emergency/filter-emergency-menus.test.ts shared/safety/validate-generated-menu.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/revalidation-adapter.test.ts src/features/planner/planner-api.test.ts src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/planner/use-draft-autosave.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Expected: FAIL。`targetMode`、`servings`、`mapPlannerDraft`と新DB列・制約が未実装。

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

`plannerSubmissionSchema`は`targetMode`による`z.discriminatedUnion`にし、共通shapeを重複させない。`planner-api.ts`の現行private `mapDraft`を`mapPlannerDraft`としてexportし、`target_mode`と`servings`をZod契約へ写す。ブラウザで空配列からmodeを推測しない。

- [ ] **Step 5: DB保存制約をmigrationへ実装する**

CLI生成migrationでplanner draft、`private.generation_draft_submission_versions`、`public.menus`へ`target_mode`を追加する。`generation_drafts.target_mode`と同表の`servings`は質問途中を表すためnullableとする。`private.generation_draft_submission_versions.target_mode`はNOT NULL、同表の`servings`はhouseholdでNULL・ideaで1〜20を表すためnullableとする。`public.menus.target_mode`と実献立人数である既存`menus.servings`はNOT NULLとする。clean reset時に利用者行は存在しない前提で列とCHECKを直接追加し、旧draft、凍結提出、menuを変換するUPDATEや一時defaultを追加しない。

draftへ次と同値の条件付きCHECKを付ける。

```sql
check (
  (target_mode = 'household' and cardinality(target_member_ids) between 1 and 20 and servings is null)
  or (target_mode = 'idea' and cardinality(target_member_ids) = 0 and servings between 1 and 20)
  or (target_mode is null and cardinality(target_member_ids) = 0 and servings is null)
)
```

凍結提出では上記から`target_mode is null`分岐を除き、`target_mode NOT NULL`、householdは`servings is null`、ideaは`servings between 1 and 20`を強制する。`target_member_ids`はいずれも一次元、NULL要素なし、重複なし、household 1〜20件、idea 0件とする。

menuは家族人数を保存する既存`servings`が両modeで1〜20のため、対象配列とのCHECKは凍結提出側だけに置く。menu version列へ次を追加する。

```sql
check (
  (target_mode = 'household' and allergen_dictionary_version is not null and food_safety_rule_version is not null)
  or (target_mode = 'idea' and allergen_dictionary_version is null and food_safety_rule_version is null)
)
```

同じmigration内で公開SQL interfaceを中間schemaへ追随させる。現行の10引数`public.save_generation_draft`をDROPし、`target_mode`と`servings`を明示引数に持つ新signatureとして再作成し、draftの両列を保存する。旧signatureの`PUBLIC`/role権限を残さず、新signatureを`public,anon,service_role`からrevokeして`authenticated`だけへgrantする。

Task 4まで残る現行14引数`public.reserve_ai_generation`も同じmigrationで置換する。この開発時ブリッジは`household`だけを受理し、ロック済みdraftの`target_mode='household'`、対象1〜20件、`servings is null`を確認してから、凍結提出の新列へ`household,NULL`を保存する。ideaまたは未選択draftはrequest/quota行を作る前に拒否する。現行`finalize_ai_generation_success`および内部の献立永続化も、凍結提出から`household`を確認し、`menus.target_mode='household'`を明示保存する。signature、HMAC、quota、lock順は変えず、既存のrevoke/grantを再宣言する。置換する全`SECURITY DEFINER` RPCは`set search_path = ''`へ変更し、catalog、extension、schema objectを完全修飾する。「維持する」のはsignatureと戻り値契約であり、既存search_pathではない。この経路はTask 3→4の開発時境界だけに存在し、Task 4のv2専用予約へ原子的に置換する。

同じmigrationで戻り値shapeが変わる既存`public.get_ai_generation_submission_snapshot(uuid,uuid)`をDROPし、同じ引数signatureで再作成して凍結提出結果に`target_mode`と`servings`を追加する。owner-boundな読出しと戻り値契約の既存fieldを維持しつつ、`set search_path = ''`、catalog・extension・schema objectの完全修飾を必須とする。再作成後は既定の`PUBLIC EXECUTE`を含め`public,anon,authenticated`からrevokeし、現行runtime readerに必要な`service_role`だけへgrantし直す。生成型と手書きoverlayはこの新しい戻り値へ揃える。

- [ ] **Step 6: planner API、runtime reader、household fixtureを更新する**

`getPlannerDraft`と`savePlannerDraft`は`target_mode`/`servings`を明示select/sendし、Task 3で置換した新しい`save_generation_draft` signatureだけを呼ぶ。`emptyDraft`へ両nullを追加する。`sanitizeDraft`はhousehold時だけ無効家族IDを除外し、0件になった場合もideaへ変えず`targetMode: null, servings: null`へ戻す。idea時は家族配列を空に固定し、入力済み人数を保持する。

Task 3時点の現行Planner UIは、家族選択の変更と同じ更新で`targetMode`/`servings`を明示的に同期する。1人以上の選択中は`targetMode: "household"`, `servings: null`を維持し、最後の1人を外したときは`targetMode: null`, `targetMemberIds: []`, `servings: null`へ戻す。autosaveへ`household + []`を渡さない。`planner-page.test.tsx`、route/conflict/limits testを含むtyped draft fixtureにも明示的なhousehold値を追加し、最後の1人を外す操作と既存の20人境界をこのTaskでgreenにする。

`generation-context.ts`のsnapshot row schemaへ`target_mode`と`servings`を追加し、`mapSnapshot`は両fieldをcamelCaseへ写して`plannerSubmissionSchema`へ渡す。`PlannerSubmission`を生成またはparseする現行household経路をすべて静的に監査し、shared factory、emergency、regeneration、revalidation、generation各fixture/builderへ`targetMode: "household"`, `servings: null`を明示する。対象配列だけからmodeを推測するfallbackや旧format readerは作らない。

- [ ] **Step 7: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `rg -n --glob '!docs/**' --glob '!supabase/migrations/**' 'PlannerSubmission|plannerSubmissionSchema|PlannerDraft|plannerDraftInputSchema|targetMemberIds:|submission:' shared src netlify`

Expected: `PlannerSubmission`/`PlannerDraft`/`PlannerDraftInput`の全construction/parse箇所を列挙し、clean-reset/current-householdの各builder/fixtureが明示的な`targetMode: "household"`, `servings: null`を持つ。旧format readerや対象配列からのmode推測は0件。

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/planner.test.ts shared/emergency/filter-emergency-menus.test.ts shared/safety/validate-generated-menu.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/revalidation-adapter.test.ts src/shared/types/database.test.ts src/features/planner/planner-api.test.ts src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/planner/use-draft-autosave.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: `rg`監査は上記条件を満たし、ほかはすべてexit 0。household fixtureは明示的に`targetMode: "household", servings: null`を持ち、Task 3だけの状態で開発時ブリッジによるhousehold保存・予約・凍結snapshotのruntime読込・完了が成功する。

- [ ] **Step 8: コミットする**

```bash
git add shared/contracts/planner.ts shared/contracts/planner.test.ts shared/testing/factories.ts shared/emergency/filter-emergency-menus.ts shared/emergency/filter-emergency-menus.test.ts shared/safety/validate-generated-menu.test.ts netlify/functions/_shared/generation-context.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/regeneration-adapter.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/revalidation-adapter.ts netlify/functions/_shared/revalidation-adapter.test.ts src/features/planner/planner-api.ts src/features/planner/planner-api.test.ts src/features/planner/planner-page.tsx src/features/planner/planner-page.test.tsx src/features/planner/planner-route.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/planner/use-draft-autosave.test.tsx src/shared/types supabase/migrations supabase/tests/database/03_pantry_and_planner_drafts.test.sql supabase/tests/database/03a_pantry_and_planner_drafts_hardening.test.sql supabase/tests/database/04_menu_core.test.sql supabase/tests/database/04a_menu_core_hardening.test.sql supabase/tests/database/ai_control_and_quota.test.sql
git commit -m "feat: 献立の対象モードと人数契約を追加"
```

---

### Task 4: generation-command.v2とrequest-bound snapshotを実装する

**Files:**
- Create via CLI: migration logical name `generation_command_v2`
- Create: `netlify/functions/_shared/generation-integrity-context.ts`
- Create: `netlify/functions/_shared/generation-integrity-context.test.ts`
- Modify: `shared/contracts/generation.ts`
- Modify: `shared/contracts/generation.test.ts`
- Modify: `netlify/functions/_shared/generation-command-integrity.ts`
- Modify: `netlify/functions/_shared/generation-command-integrity.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `netlify/functions/_shared/regeneration-context.ts`
- Modify: `netlify/functions/_shared/regeneration-context.test.ts`
- Modify: `netlify/functions/_shared/regeneration-prompt.test.ts`
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
- Modify: `src/features/generation/pages/generation-page.test.tsx`
- Modify: `src/features/history/hooks/use-regeneration.ts`
- Modify: `src/features/history/hooks/use-regeneration.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `src/shared/types/database.test.ts`
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
export type GenerationCommand = GenerationCommandV2;

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
      targetMode: "household";
      servings: number;
      targetMemberIds: readonly [string, ...string[]];
      sourceMenuVersion: number;
    }
  | {
      kind: "regenerate_menu" | "regenerate_dish";
      targetMode: "idea";
      servings: number;
      targetMemberIds: readonly [];
      sourceMenuVersion: number;
    };

export type GenerationRequestLookup =
  | { kind: "miss" }
  | {
      kind: "hit";
      requestId: string;
      requestHmacVersion: "generation-command.v2";
      integrity: GenerationIntegrityContextV2;
    };

export type GenerationReservationRepository = {
  lookup: (idempotencyKey: string) => Promise<GenerationRequestLookup>;
  replayExisting: (
    command: GenerationCommandV2,
    lookup: Extract<GenerationRequestLookup, { kind: "hit" }>,
  ) => Promise<QuotaRequestRecord>;
  reserveNew: (
    command: GenerationCommandV2,
    integrity: GenerationIntegrityContextV2,
  ) => Promise<QuotaRequestRecord>;
};
```

- `lookupGenerationRequest(userId,idempotencyKey)`を常に最初に実行する。hitは保存済み凍結submissionまたはrequest snapshotからHMAC contextを再構築し、live draft/menuを読まずreplayする。missだけが`resolveGenerationIntegrityContext(admin,userId,command)`で権威あるdraft revisionまたはsource menuを読む。`reserveNew(command,integrity)`はDB lock下で同じmode、servings、member IDs、source versionを再確認し、不一致ならrequest、quota、snapshotを作らない。
- `canonicalizeGenerationCommandV2(command,integrity)`は`targetMode`、`servings`、sort済み`targetMemberIds`、`sourceMenuVersion`を含む。全kindで`commandVersion: "generation-command.v2"`を必須とし、DBの`request_hmac_version`もこの値だけを許可する。
- `private.generation_regeneration_snapshots`はrequest 1対1、owner複合FK、immutable、request削除時cascadeとする。再生成時のmode、`menus.servings`、member IDs、source versionを予約transaction内で凍結する。
- 端末保存は`commandVersion`を持つv2 schemaだけを使う。owner、現行`PENDING_GENERATION_TTL_MS`、request IDを検査し、保存成功前に送信しない。通信切断後は同じidempotency keyを回収し、新しいkeyで自動再予約しない。
- 現行の「ownerごとにprocessing requestは1件」の部分unique indexと安定code `generation_in_progress`を維持する。処理中requestがあるownerの別key new/whole/dishはrequest、quota、attempt、snapshotを追加しない。
- 本機能は永続利用環境へ未デプロイのため、旧版command reader、保存key変換、移行endpoint、mapping/tombstone、過去の処理中requestを回収する分岐は作らない。

新migrationが置換・追加するSQL interfaceを次に固定する。両RPCはNetlify Functionsのservice roleだけへ`EXECUTE`を許可し、`public`、`anon`、`authenticated`から明示的にrevokeする。置換する全`SECURITY DEFINER`関数は`set search_path = ''`とし、catalog、extension、schema objectを完全修飾する。「既存契約を維持する」はsignatureと戻り値を指し、既存search_pathは維持しない。

```sql
create or replace function public.lookup_ai_generation_request(
  p_user_id uuid,
  p_idempotency_key uuid
) returns jsonb;

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
```

`lookup_ai_generation_request`はowner-boundなrequest hitまたはmissだけを返す。`reserve_ai_generation`はv2以外を拒否し、既存`QuotaRequestRecord` JSON契約を維持する。

- [ ] **Step 1: migrationをCLIで新規作成する**

Run: `docker compose run --rm --no-deps app npx supabase migration new generation_command_v2`

Expected: 新しいmigration pathが1件表示される。exact pathをTask brief/reportへ記録し、以後このTaskではそのmigrationだけを編集する。

- [ ] **Step 2: v2 wire、HMAC、snapshot、pendingの失敗するテストを書く**

Vitestで全kindの`commandVersion`必須、unknown key拒否、canonical key順、member IDs sort、mode/servings/source versionのHMAC反映、ledger-first hit/miss、権威あるdraft/source解決、v2 pendingのowner/TTL/request整合性、通信切断後のsame-key回収を固定する。`generation-page.test.tsx`、`regeneration-prompt.test.ts`を含むtyped command fixtureはすべてtop-levelに必須の`commandVersion: "generation-command.v2"`を持つ。`planner-route.test.tsx`ではnew-menu runtime constructorがpending保存前に同じtop-level versionを付け、保存されたcommandとHTTP POSTされたcommandがともにv2であることを固定する。`database.test.ts`の予約RPC fixtureは`p_request_hmac_version: "generation-command.v2"`と必須`p_integrity_context`を渡し、新15引数契約を型で固定する。

pgTAPへv2以外のHMAC版拒否、旧14引数signatureの削除、新15引数signature、request snapshot immutable、owner複合FK、source version変更/削除、同一key replay、ownerごとのprocessing制約を追加する。snapshotは別owner request、21人、NULL要素、重複IDを直接INSERTとRPCの両方で拒否する。

`ai_control_and_quota_races.test.sql`では別backend sessionを使い、同一ownerのprocessing v2が存在するとき別keyの`new_menu`、`regenerate_menu`、`regenerate_dish`をそれぞれ予約する。すべて安定した`generation_in_progress`となり、request、quota、attempt、snapshotの件数が増えないことを検証する。別ownerは独立して予約できることも固定する。

- [ ] **Step 3: focused testのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts netlify/functions/_shared/generation-command-integrity.test.ts netlify/functions/_shared/generation-integrity-context.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-prompt.test.ts netlify/functions/generate-menu.test.ts netlify/functions/generate-dish.test.ts src/features/generation/api/generation-api.test.ts src/features/generation/model/pending-generation.test.ts src/features/generation/hooks/use-generation-recovery.test.tsx src/features/generation/pages/generation-page.test.tsx src/features/history/hooks/use-regeneration.test.tsx src/features/planner/planner-route.test.tsx src/shared/types/database.test.ts`

Run: `docker compose --profile test run --rm db-test`

Expected: FAIL。v2-only schema、resolver、snapshot、15引数予約、v2 pendingが未実装。

- [ ] **Step 4: v2 wire schemaとcanonicalizerを実装する**

`generationCommandV2Schema`は全kindでtop-level discriminatorを必須にし、送信・保存・復帰の唯一のcommand型とする。canonical JSONは次のkey順を固定し、kindに存在しない値は`null`、member IDsと期限切れ確認はsortする。

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

unsupported-version rejection testは`"unsupported-command-version"`などの汎用invalid値をraw inputとして使い、旧versionのtyped fixture、schema、export、readerを残さない。

- [ ] **Step 5: ledger-first lookupと権威あるintegrity resolverを実装する**

`runGeneration`はparse済みcommandのidempotency keyで最初にrepository `lookup`を呼ぶ。hitは保存済みintegrityからHMACを再計算し、`replayExisting`へ渡す。元draft/menu/dish、privacy、pantry、householdをhit前に読まない。保存HMAC不一致は`idempotency_payload_mismatch`、一致は保存済みstatusを返す。lookupとreplayの間にrowが消えた場合はmissへ戻らず`internal_error`でfail-closedする。

`resolveGenerationIntegrityContext`はnew menuで`draftId+draftRevision+owner`、regenerationで`sourceMenuId+owner`と対象dishを取得し、クライアントからmode/servings/member IDs/source versionを受け取らない。new menuは凍結候補、regenerationはmenuの保存済み値をmode別discriminated unionへ絞る。householdはNULL要素・重複なしの1〜20件、ideaは空tupleとし、矛盾はZodとruntime resolverの両方で拒否する。

- [ ] **Step 6: snapshot DDLとv2予約RPCを実装する**

`private.ai_generation_requests`へ`(id,user_id)`のUNIQUE制約を追加し、次のsnapshotを作る。`target_member_ids`はimmutable helperで一次元、NULL要素なし、重複なし、household 1〜20件、idea 0件を強制する。table/helperは`public,anon,authenticated`から全権限をrevokeし、snapshot UPDATEを常に拒否するprivate triggerを付ける。

```sql
create table private.generation_regeneration_snapshots (
  request_id uuid primary key,
  user_id uuid not null,
  kind text not null check (kind in ('regenerate_menu', 'regenerate_dish')),
  source_menu_id uuid not null,
  source_menu_version integer not null check (source_menu_version > 0),
  replace_dish_id uuid,
  target_mode text not null check (target_mode in ('household', 'idea')),
  servings integer not null check (servings between 1 and 20),
  target_member_ids uuid[] not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  foreign key (request_id, user_id)
    references private.ai_generation_requests(id, user_id) on delete cascade,
  check ((kind = 'regenerate_dish') = (replace_dish_id is not null)),
  check (private.is_valid_generation_target_member_ids(target_member_ids, target_mode))
);
```

予約RPCはtransaction内でledger lookupを再実行し、真のmissだけdraft/sourceをlockする。resolver値とmode、servings、member IDs、source versionを完全一致で再検査した後、request、凍結提出またはsnapshot、quota reservationを同一transactionで作る。不一致は`draft_revision_conflict`または`source_menu_changed`で永続行を作らない。ownerに別のprocessing requestがあればunique index違反を安定した`generation_in_progress`へ写し、quota、attempt、snapshotを追加しない。

- [ ] **Step 7: v2 pendingと通常回復を実装する**

`planner-route.tsx`のnew-menu runtime command constructorは、pending保存へ渡す前にtop-level `commandVersion: "generation-command.v2"`を明示する。端末pendingはv2 commandだけをparseし、owner、TTL、request IDの整合しない値を破棄する。作成時はpending保存成功後だけ同じv2 commandをHTTP送信し、通信切断時は保存済みidempotency keyでstatusを回収する。recoveryはnetwork/offlineの既存state machineを維持し、同じ操作から別keyを発行しない。API successは`GenerationStatusData`だけをparseする。`planner-route.test.tsx`は保存されたcommandとPOST bodyの両方が`commandVersion: "generation-command.v2"`を持つことをassertする。

- [ ] **Step 8: source snapshotのfail-closed動作を実装する**

`regeneration-context.ts`はrequest snapshotを正本としてlive sourceと対象dishをowner/version付きで再取得する。外部送信前の不一致・削除は`source_menu_changed`でfailしattemptを返却する。finalize RPCはrequestを`FOR UPDATE`、source menuをowner+version付き`FOR SHARE`の順にlockしてlineageを再検査する。送信後の不一致はmenuを作らずattempt消費・success枠非消費で同codeへ終端化する。reserve/finalizeともrequest→draftまたはsource→usage rowのlock順を守る。置換するfinalize RPCも`set search_path = ''`と完全修飾を必須とする。

- [ ] **Step 9: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `docker compose run --rm --no-deps app npx vitest run shared/contracts/generation.test.ts netlify/functions/_shared/generation-command-integrity.test.ts netlify/functions/_shared/generation-integrity-context.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-prompt.test.ts netlify/functions/generate-menu.test.ts netlify/functions/generate-dish.test.ts src/features/generation/api/generation-api.test.ts src/features/generation/model/pending-generation.test.ts src/features/generation/hooks/use-generation-recovery.test.tsx src/features/generation/pages/generation-page.test.tsx src/features/history/hooks/use-regeneration.test.tsx src/features/planner/planner-route.test.tsx src/shared/types/database.test.ts`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Run: `rg -n --glob '*.{ts,tsx,sql}' 'generation-command\.v1|generationCommandVersionV1|GenerationCommandV1|canonicalizeGenerationCommandV1' shared src netlify supabase/tests`

Expected: Docker・テスト・型・Lint・format検証コマンドはすべてexit 0。最後の`rg`は出力0件かつexit 1となり、これを旧command-versionの不在を示す成功条件とする。immutableなhistorical migrationとTask 4で置換済みのTask 3開発ブリッジを除くsource/testに旧command-version export/fixtureが残らない。v2-only HMAC、pending、snapshot、source fail-closed、ownerごとのprocessing制約が成功する。

- [ ] **Step 10: コミットする**

```bash
git add shared/contracts/generation.ts shared/contracts/generation.test.ts netlify/functions src/features/generation src/features/history/hooks/use-regeneration.ts src/features/history/hooks/use-regeneration.test.tsx src/features/planner/planner-route.tsx src/features/planner/planner-route.test.tsx src/shared/types/database.generated.ts src/shared/types/database.test.ts supabase/migrations supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/history_regeneration.test.sql
git commit -m "feat: 生成コマンドv2と再生成snapshotを追加"
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
- Modify: `netlify/functions/_shared/regeneration-adapter.ts`
- Modify: `netlify/functions/_shared/regeneration-adapter.test.ts`
- Modify: `netlify/functions/_shared/generation-prompt.ts`
- Modify: `netlify/functions/_shared/generation-prompt.test.ts`
- Modify: `netlify/functions/_shared/generation-materializer.ts`
- Modify: `netlify/functions/_shared/generation-materializer.test.ts`
- Modify: `netlify/functions/_shared/generation-repository.ts`
- Modify: `netlify/functions/_shared/generation-repository.test.ts`
- Modify: `netlify/functions/_shared/generation-service.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `netlify/functions/_shared/stored-menu-loader.ts`
- Modify: `netlify/functions/_shared/stored-menu-loader.test.ts`
- Modify: `netlify/functions/_shared/stored-menu-loader.types.test.ts`
- Modify: `netlify/functions/_shared/revalidation-adapter.ts`
- Modify: `netlify/functions/_shared/revalidation-adapter.test.ts`
- Modify: `netlify/functions/_shared/revalidation-service.ts`
- Modify: `netlify/functions/_shared/revalidation-service.test.ts`
- Modify: `netlify/functions/revalidate-menu.ts`
- Modify: `netlify/functions/revalidate-menu.test.ts`
- Modify: `netlify/functions/_shared/shopping-service.ts`
- Modify: `netlify/functions/_shared/shopping-service.test.ts`
- Modify: `netlify/functions/_shared/shopping-adapter.ts`
- Modify: `netlify/functions/_shared/shopping-adapter.test.ts`
- Modify: `netlify/functions/shopping-list-from-menu.ts`
- Modify: `netlify/functions/shopping-list-from-menu.test.ts`
- Modify: `netlify/functions/shopping-list-preview.ts`
- Modify: `netlify/functions/shopping-list-preview.test.ts`
- Modify: `netlify/functions/shopping-list-reconcile.ts`
- Modify: `netlify/functions/shopping-list-reconcile.test.ts`
- Modify: `netlify/functions/shopping-list-revalidate.ts`
- Modify: `netlify/functions/shopping-list-revalidate.test.ts`
- Modify: `src/shared/types/database.generated.ts`
- Modify: `src/shared/types/database.ts`
- Modify: `src/shared/types/database.test.ts`
- Modify: `supabase/tests/database/ai_control_and_quota.test.sql`
- Modify: `supabase/tests/database/04_menu_core.test.sql`
- Modify: `supabase/tests/database/shopping_lists.test.sql`
- Modify: `supabase/tests/database/shopping_lists_races.test.sql`

**Interfaces:**
- Consumes: Task 4のv2 integrity、必須request snapshot、source fail-closed契約。
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
- shopping create/reconcileのHTTP/serviceとDB RPCは有効期限内mutation replayを最初にread-onlyで返す。replay hitは出典削除、identity読出し障害、現在modeの変化後も保存済み成功を返し、live modeを再解釈しない。replay missだけowner+menu version+modeをlockなしで検査する。preview/revalidateはmutation replayを持たない各既存契約に従う。
- 全shopping writerのhousehold replay missは`mutation replay（該当時）→lockなしsource identityのowner/version/mode→active list FOR UPDATE（存在時）→source rows/menu FOR SHARE再確認→shopping safety locks（menu id昇順）→writes`へ統一する。初回listは既存のuser単位active-list直列化/unique契約を維持し、この位置から逆順lockを作らない。
- `stored-menu-loader.ts`へowner-scopedで`id,user_id,version,target_mode`だけを読む`loadStoredMenuIdentity`を追加する。これはfull aggregate用`loadStoredMenu`と分離し、家族、member adaptation、label confirmation、catalogをnested selectしない。`ShoppingDependencies`も`loadMenuIdentity`→既存`loadMenu`の二段階interfaceとする。買い物のcreate/preview/reconcileと既存list revalidateはidentity取得直後にideaを`idea_menu_not_supported`で拒否し、householdだけが家族再検証・full aggregate・fingerprint・pantry読出し・RPC・projection書込みへ進む。完成献立の直接revalidation APIも最初に同じidentityを読み、ideaを専用`idea_menu_revalidation_not_supported`で拒否する。

- [ ] **Step 1: migrationをCLIで新規作成する**

Run: `docker compose run --rm --no-deps app npx supabase migration new idea_generation_boundary`

Expected: 新しいmigration pathが1件表示される。exact pathをTask brief/reportへ記録し、以後このTaskではそのmigrationだけを編集する。

- [ ] **Step 2: idea fingerprintとcontext非送信の失敗するテストを書く**

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

`regeneration-adapter.test.ts`はidea snapshotからの再生成がcurrent household safetyと`buildStoredGenerationContext`を呼ばず、専用idea contextを返すこと、household branchは既存builderと家族安全検査を維持することを先に固定する。両modeの再生成はrequest snapshotを必須とする。

shopping service/handler testは全4経路（from-menu、preview、reconcile、revalidate）をidea menuまたはidea source混入listで呼び、`422 / idea_menu_not_supported / アイデア献立は買い物リストに利用できません`を期待する。create/reconcileは有効期限内mutation replayを最初にread-onlyで返し、保存後に出典を削除したcaseやidentity loaderを失敗させたcaseでも保存済み成功を返してfull aggregate・mode検査・RPCを呼ばないこと、replay missのidea新規keyだけが422になることを固定する。preview/revalidateはmutation replayなしの既存契約を維持する。replay miss各経路の最初のowner-scoped読出しは`loadStoredMenuIdentity`の4列だけで、家族/member/catalog nested queryが0件であることをquery/adapter testで固定する。create/preview/reconcileではfull aggregate、家族再検証、fingerprint、pantry読出し、apply RPCを呼ばず、revalidateでは安全projectionを書き換えないことを先に失敗するテストとして固定する。完成献立の直接`revalidate-menu` POSTは`422 / idea_menu_revalidation_not_supported / アイデア献立は家族条件で確認できません`で拒否し、full aggregate、家族・catalog queryとrevalidation書込みが0件であることを検証する。

`database.test.ts`へ`finalize_ai_generation_success.Args`の両versionが`string | null`で、ideaのnull引数とhouseholdのstring引数を受ける型テストを先に追加する。pgTAPへ固定fingerprint helperの直接呼出し、idea完了時の空member子行、version null、人数不一致拒否、household helper回帰、shopping直接RPC拒否、mutation/list version不変を追加する。

- [ ] **Step 3: focused testのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run shared/safety/idea-fingerprint.test.ts shared/safety/validate-generated-menu.test.ts src/shared/types/database.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/stored-menu-loader.test.ts netlify/functions/_shared/stored-menu-loader.types.test.ts netlify/functions/_shared/revalidation-adapter.test.ts netlify/functions/_shared/revalidation-service.test.ts netlify/functions/revalidate-menu.test.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/_shared/shopping-adapter.test.ts netlify/functions/shopping-list-from-menu.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts netlify/functions/shopping-list-revalidate.test.ts`

Run: `docker compose --profile test run --rm db-test`

Expected: FAIL。idea helper、mode分岐、DB境界が未実装。

- [ ] **Step 4: mode別GenerationContextとpromptを実装する**

new menuのfrozen submissionがhouseholdなら既存家族読出しを実行する。ideaなら家族・allergen・age rule queryを呼ばず、pantry/自由条件/共通制約だけでcontextを作る。prompt builderはidea時に`members`、`memberPreferences`、`allergies`、`ageBands`、`adaptations`要求を含めない。医療・治療食拒否とpantry owner/期限検査は両modeで維持する。

`regeneration-adapter.ts`はrequest snapshotのmodeを先に判別する。idea branchはcurrent household safetyと`buildStoredGenerationContext`を呼ばず、固定idea safety、空member/preference、null versionを持つ専用contextを構築する。household branchは対象家族1〜20人、current safety、既存`buildStoredGenerationContext`をそのまま維持する。

- [ ] **Step 5: AI output validationとmaterializationをmode-awareにする**

ideaは`adaptations.length === 0`、`labelConfirmations.length === 0`、family-specific safety actions 0件、`menu.servings === frozenSubmission.servings`を必須にする。householdの現在の人数・匿名member ref・ラベル確認検査は変更しない。materializerはideaで`menu_target_members`、`menu_member_adaptations`、`menu_safety_actions`、`menu_label_confirmations`を作らない。

- [ ] **Step 6: DB idea helperとfinalize境界を実装する**

`private.idea_safety_fingerprint()`は`extensions.digest(pg_catalog.convert_to('{"assurance":"none","members":[],"mode":"idea"}', 'UTF8'), 'sha256')`をhex化する。pgTAPはこのhelperを直接呼び、固定lowercase hexと一致すること、家族・catalog表を読まないことを検証する。`public.finalize_ai_generation_success`は引数型・順序・戻り値を変えず、関数本体をv2 request snapshotのmode分岐へ置換する。PostgreSQLの`text`引数は元からNULLを受け取れるため、ideaでは`p_allergen_version`と`p_food_rule_version`のNULLを許容する。ideaでは対象家族0件、family子行0件、保存人数一致、固定snapshot/fingerprint一致、version列nullを検査する。householdでは両versionをnon-null検査し、既存`lock_and_assert_current_safety_fingerprint`をそのまま呼ぶ。両modeでowner、request status、HMAC、source lineage、quotaを維持する。

RPC内の順序はrequest `FOR UPDATE`→snapshot mode読出し→mode別不変条件→source lineage lock→menu/子行永続化→quota更新とする。失敗時は同一transactionのためmenu、子行、quotaの部分更新を残さない。function置換後は既存signatureの`EXECUTE`を`public,anon`からrevokeし、`service_role`だけへgrantする。Task 5で置換する`finalize_ai_generation_success`、shopping RPC、関連`SECURITY DEFINER` helperはすべて`set search_path = ''`とし、catalog、extension、schema objectを完全修飾する。「signatureを維持する」は既存search_pathを維持する意味ではない。

型生成後、`database.ts`の`finalize_ai_generation_success.Args` overlayで`p_allergen_version`と`p_food_rule_version`を`string | null`へ上書きする。`database.test.ts`はhousehold引数の両値がstring、idea引数の両値がnullで型検査を通り、それ以外の引数型を緩めないことを`expectTypeOf`で固定する。

- [ ] **Step 7: shopping RPCのidea拒否を新migrationで置換する**

`public.apply_shopping_draft(uuid,uuid,text,uuid,integer,text,uuid,text,jsonb)`と`public.apply_shopping_reconciliation(uuid,uuid,integer,uuid,integer,text,uuid,text,jsonb)`のsignatureおよびJSON responseは変更しない。両RPCは最初に有効期限内のidempotency replayをread-onlyで判定し、replay hitなら出典削除やmode変更後も保存済み成功responseを返して現在の`target_mode`を再解釈しない。replay miss後は、期限切れ同一key削除やbounded cleanupをまだ行わず次の順序に揃える。

1. draftは`p_menu_id+p_user_id+期待version`、reconciliationは`p_source_menu_id+p_source_menu_version+p_user_id`を同じmenu行からlockなしでread-only取得する。所有者不一致は存在を秘匿した既存not-found、version不一致は既存version conflictとして扱う。
2. owner、version、modeの順で判定し、欠損/version不一致を既存codeで拒否する。
3. 直後に`target_mode`を検査する。
4. householdだけactive listを存在時に`FOR UPDATE`する。初回new listは既存のuser単位active-list直列化とunique制約を同じ位置で維持し、source/safety lock後に取り直す逆順を作らない。
5. 同じmenu行と全source rowsを`FOR SHARE`で再取得し、owner、version、modeを再検査する。
6. shopping safety lockをsource menu id昇順で取得する。期限切れ同一key削除、bounded cleanup、list/source/items更新は必要なlock取得後のwrite phaseだけで行う。

mode判定より前にはwrite、期限切れcleanup、row lockを行わず、active listをlockせず、shopping safety helperも呼ばない。owner/not-found、source version、idea modeの既存error優先順位はlockなしidentity段階で確定する。household branchのglobal lock順は`期限内mutation replay → lockなしsource identity owner/version/mode → active list FOR UPDATE（存在時）→ source rows/menu FOR SHARE再確認 → shopping safety locks（menu id昇順）→ writes`へ統一する。active list/list version、source再確認、safety fingerprint間の失敗も既存の安定codeへ終端し、dblinkでerror優先順位を固定する。これによりidea拒否は例外rollbackに依存せず、list/item/source/snapshot row、list version、mutation ledger、label confirmationを変更しない。

既存writerの`refresh_shopping_list_safety`、`mutate_shopping_item`、`private.lock_and_check_shopping_list_safety`も、`replay（該当時）→ active list FOR UPDATE → source rows/menu FOR SHARE → safety locks（menu id昇順）→ write`へ揃える。helperが同一transaction内で既にlock済みのlistを再度`FOR UPDATE`してもよいが、呼出し手ごとにsource先行など別手順を持たせない。`shopping_lists_races.test.sql`はapply draft/reconciliationのそれぞれとrefresh/mutateの全cross-RPC組合せを別backend sessionで競合させ、複数sourceの昇順lock、deadlockなし、定義済みerror優先順位を検証する。

```sql
if v_menu.target_mode <> 'household' then
  raise exception using errcode = '22023', message = 'idea_menu_not_supported';
end if;
```

この判定より前にshopping list行、source snapshot、list version、shopping safety lockを変更しない。既存signatureのrevoke/grantを新migration末尾で再宣言する。

pgTAPはreplay hitが保存済み成功を返すこと、replay missのideaで同一keyと無関係な期限切れledgerを含む上記全行・versionが不変であること、mode判定前のwrite/row lockが0件であること、owner/version/modeのerror優先順位を固定する。race testはidea拒否と同時cleanup、draft/reconciliation対refresh/mutateの全cross-RPC、初回list作成、同時source/list更新、複数sourceを別backend sessionで再現し、global orderどおりに直列化され、deadlockせず定義済みcodeへ終端することを検証する。

- [ ] **Step 8: shopping HTTP/serviceと直接revalidationのmode境界を実装する**

`stored-menu-loader.ts`へ`loadStoredMenuIdentity(admin,userId,menuId)`を追加し、owner-scoped selectを`id,user_id,version,target_mode`だけに限定して`targetMode: TargetMode`へ写す。既存`loadStoredMenu`はfull aggregate loaderとして維持する。`ShoppingDependencies`は`loadMutationReplay`、`loadMenuIdentity`、既存`loadMenu`を分ける。mutation keyを持つcreate/reconcileは有効期限内replayを最初にread-onlyで返し、hit時は出典削除、identity障害、現在modeの変化に関係なく保存済み成功を返してlive stateを再解釈しない。replay missだけ`loadMenuIdentity`へ進み、ideaならfull aggregate、家族revalidation、fingerprint、pantry読出し、active list取得、apply RPCより前に`HttpError(422,"idea_menu_not_supported","アイデア献立は買い物リストに利用できません")`を返す。previewはmutation replayを持たない既存契約どおりidentityから開始する。

既存listのrevalidateはmutation replayを新設せず、各live sourceを`loadStoredMenuIdentity`でowner/version付きに読む既存契約を維持する。そのいずれかがideaなら同じcode/messageでfail-closedし、full aggregateや家族queryへ進まず安全tokenやprojectionを保存しない。削除済みsourceなど既存のunverifiable契約は変更しない。`shopping-adapter.mapRpcError`もDBの`idea_menu_not_supported`を同じ安定HTTP契約へ写し、from-menu/preview/reconcile/revalidateの4 handlerすべてで同じresponseを返す。Vitestはcreate/reconcileの保存済み成功後にsourceを削除して同じkeyを再送したreplayと、idea sourceへ新しいkeyを送って422になるmissを固定する。

完成献立の家族安全を直接更新する`revalidate-menu.ts`も、最初に`loadStoredMenuIdentity`だけを呼ぶ。ideaは空memberに由来する既存errorへ落とさず、full aggregate、家族、アレルゲンcatalog、年齢rule query、revalidation row書込みより前に`HttpError(422,"idea_menu_revalidation_not_supported","アイデア献立は家族条件で確認できません")`で拒否する。householdだけ既存`loadStoredMenu`と再検証処理へ進む。

- [ ] **Step 9: DB型生成とfocused verificationを実行する**

Run: `./scripts/reset-local-db.sh`

Run: `docker compose run --rm --no-deps app npm run db:types`

Run: `docker compose run --rm --no-deps app npx vitest run shared/safety/idea-fingerprint.test.ts shared/safety/validate-generated-menu.test.ts src/shared/types/database.test.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/stored-menu-loader.test.ts netlify/functions/_shared/stored-menu-loader.types.test.ts netlify/functions/_shared/revalidation-adapter.test.ts netlify/functions/_shared/revalidation-service.test.ts netlify/functions/revalidate-menu.test.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/_shared/shopping-adapter.test.ts netlify/functions/shopping-list-from-menu.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts netlify/functions/shopping-list-revalidate.test.ts`

Run: `docker compose --profile test run --rm db-test`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。householdの既存generation test結果数を減らさない。

- [ ] **Step 10: コミットする**

```bash
git add shared/safety netlify/functions/_shared/generation-context.ts netlify/functions/_shared/generation-context.test.ts netlify/functions/_shared/regeneration-context.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/regeneration-adapter.ts netlify/functions/_shared/regeneration-adapter.test.ts netlify/functions/_shared/generation-prompt.ts netlify/functions/_shared/generation-prompt.test.ts netlify/functions/_shared/generation-materializer.ts netlify/functions/_shared/generation-materializer.test.ts netlify/functions/_shared/generation-repository.ts netlify/functions/_shared/generation-repository.test.ts netlify/functions/_shared/generation-service.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/stored-menu-loader.ts netlify/functions/_shared/stored-menu-loader.test.ts netlify/functions/_shared/stored-menu-loader.types.test.ts netlify/functions/_shared/revalidation-adapter.ts netlify/functions/_shared/revalidation-adapter.test.ts netlify/functions/_shared/revalidation-service.ts netlify/functions/_shared/revalidation-service.test.ts netlify/functions/_shared/shopping-service.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/_shared/shopping-adapter.ts netlify/functions/_shared/shopping-adapter.test.ts netlify/functions/revalidate-menu.ts netlify/functions/revalidate-menu.test.ts netlify/functions/shopping-list-from-menu.ts netlify/functions/shopping-list-from-menu.test.ts netlify/functions/shopping-list-preview.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.ts netlify/functions/shopping-list-reconcile.test.ts netlify/functions/shopping-list-revalidate.ts netlify/functions/shopping-list-revalidate.test.ts src/shared/types/database.generated.ts src/shared/types/database.ts src/shared/types/database.test.ts supabase/migrations supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/04_menu_core.test.sql supabase/tests/database/shopping_lists.test.sql supabase/tests/database/shopping_lists_races.test.sql
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
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`
- Modify: `src/features/planner/planner-page.tsx`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/planner/planner-route.tsx`
- Modify: `src/features/planner/planner-route.test.tsx`
- Modify: `src/features/planner/planner-route-conflict.test.tsx`
- Modify: `src/features/planner/planner-route-limits.test.tsx`
- Modify: `src/features/privacy/privacy-notice-page.tsx`
- Modify: `src/features/privacy/privacy-notice-page.test.tsx`
- Modify: `shared/contracts/menu-result.ts`
- Modify: `src/features/generation/api/menu-result-api.ts`
- Modify: `src/features/generation/api/menu-result-api.test.ts`
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `src/features/generation/components/menu-result.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`
- Modify: `src/features/shopping/api/shopping-api.ts`
- Create: `src/features/shopping/api/shopping-api.test.ts`
- Modify: `src/features/shopping/hooks/use-shopping-list.ts`
- Create: `src/features/shopping/hooks/use-shopping-list.test.tsx`
- Modify: `src/features/history/api/history-api.ts`
- Create: `src/features/history/api/history-api.test.ts`
- Modify: `src/features/history/model/group-history.ts`
- Modify: `src/features/history/model/group-history.test.ts`
- Modify: `src/features/history/components/history-card.tsx`
- Create: `src/features/history/components/history-card.test.tsx`
- Modify: `src/features/history/pages/history-page.tsx`
- Modify: `src/features/history/pages/history-page.test.tsx`
- Modify: `src/features/history/pages/history-detail-page.tsx`
- Modify: `src/features/history/pages/history-detail-page.test.tsx`
- Modify: `src/features/emergency/emergency-menu-page.tsx`
- Modify: `src/features/emergency/emergency-menu-page.test.tsx`
- Modify: `e2e/fixtures/auth.ts`
- Modify: `e2e/specs/onboarding.spec.ts`
- Modify: `e2e/specs/auth-recovery.spec.ts`
- Modify: `e2e/specs/oauth-mock.spec.ts`
- Modify: `e2e/specs/generation-recovery-results.spec.ts`
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`

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
  fieldErrors: Readonly<Partial<Record<PlannerFieldName, string>>>;
  onDraftChange: (next: PlannerDraftInput) => void;
  onStepChange: (next: PlannerStep) => void;
  onSubmit: () => Promise<void>;
};

export type PlannerFieldName =
  | "mealType"
  | "mainIngredients"
  | "cuisineGenre"
  | "targetMode"
  | "targetMemberIds"
  | "servings"
  | "timeLimitMinutes"
  | "budgetPreference"
  | "avoidIngredients"
  | "memo"
  | "pantrySelections";

export function mapPlannerIssuePathToField(
  path: readonly PropertyKey[],
): PlannerFieldName | null;

export type WelcomePageProps = {
  onboardingStatus: OnboardingStatus;
  onStartIdea: () => Promise<void>;
  onStartHousehold: () => Promise<void>;
};
```

- `/`はprofileが`not_started|in_progress`なら`/welcome`、`complete|skipped`なら`/planner`。`/planner`直接URLは全statusで許可する。
- Task 6のidea結果は本文閲覧と常時noticeだけを提供する。採用、お気に入り、再生成、買い物、冷蔵庫、family revalidation、family領域は表示しない。
- welcome、planner wizard、mode-aware result/history childのrootだけに`.guided-planner-theme`を付け、対象外routeとglobal AppShellには付けない。
- Task 2がmode-aware privacy copyの3 sectionを確定済みとし、このTaskのprivacy変更はreviewからのsanitized `returnTo`往復だけに限定する。copy契約を再定義しない。
- `HouseholdOnboardingPage`自身のstatus送信は引き続き`in_progress|complete`だけとし、このTaskでは公開後の文言を「家族設定（任意）」など任意性が明確な表現へ直す。`skipped`送信はwelcome/audienceだけが所有する。

- [ ] **Step 1: wizard modelとstep UIの失敗するテストを書く**

```ts
it("resumes an incomplete target draft at audience without losing answers", () => {
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

component testは固定順、戻る時の回答保持、家族0件の登録link、idea人数1〜6 buttonと7〜20 number input、未選択既定値なし、reviewの編集操作、保存失敗時の現在step維持、heading focusを検証する。Zod issue pathから作るfield error mapについて、`mapPlannerIssuePathToField`が`mainIngredients.0`、`targetMemberIds.0`、`avoidIngredients.0`、`pantrySelections.0`などのarray indexを各root field/group controlへ正規化し、未知pathをnullにすることを固定する。各入力の安定したinput/error ID、`aria-invalid`、`aria-describedby`、field-local message、上部summary、submit時の最初のinvalid fieldへのfocusをRTLで固定する。focus順は質問順の`mealType → mainIngredients → cuisineGenre → targetMode → targetMemberIds → servings`、review内の`timeLimitMinutes → budgetPreference → avoidIngredients → memo → pantrySelections`とする。

家族モード選択後に対象家族が0件になった場合はmode未選択へ戻り、ideaへ自動降格しないことも固定する。profileが`complete`でも利用可能家族0件ならhousehold選択をdisabledにし、ideaと家族追加linkを表示する。

- [ ] **Step 2: welcome、router、minimum resultの失敗するテストを書く**

router testで`/welcome`が`RequireSession`配下、主要routeが`RequireCompletedOnboarding`配下でないこと、`complete|skipped`で`/welcome`へ直接アクセスした場合は`/planner`へreplace redirectすることを期待する。`RootEntryPage`のtestは`not_started`、`in_progress`、`complete`、`skipped`の4 status、pending、query error、profile row欠損を分け、成功したrowだけがreplace navigationを起こすこと、error/欠損はstatusを推測せず再試行可能なalertに留まることを固定する。`skipped`かつ家族0人のfixtureで`/pantry`、`/history`、`/shopping`、`/settings`、`/emergency-menus`を直接開き、onboarding redirectなし、render例外なし、理解可能なempty state、家族安全query/revalidation requestなしをroute/page testで固定する。緊急献立は下書きなしとidea下書きを別caseにし、利用可能な家族が現れるまで緊急献立APIを含む家族安全HTTP/query activityが0件であることを期待する。result testでidea resultが`useMenuRevalidation`とshopping hook/query/pending replayをmountせず、注意とrecipe本文を表示し、家族領域と5操作を表示しないことを期待する。ideaではfrom-menu/preview/reconcile/revalidateのどのrequestも発生せず、`kondate:shopping:*`のsessionStorageが作られないことも固定する。履歴の直接testは`history-api.test.ts`で`target_mode`のselectとmapping、`history-card.test.tsx`で両modeの文字badgeとidea時に家族向け安心表現を出さないことを固定する。履歴page testはidea詳細でnoticeと本文だけを表示し、family revalidation、shopping query/hook/pending、採用、お気に入り、冷蔵庫、再生成がmountされないことを固定する。welcome、planner、result/history childには`.guided-planner-theme`があり、pantry、shopping、settings、emergencyとglobal AppShellにはないことも検証する。

- [ ] **Step 3: focused VitestのREDを確認する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/welcome/welcome-page.test.tsx src/features/auth/root-entry-page.test.tsx src/app/router.test.tsx src/features/auth/protected-routes.test.tsx src/features/household/household-onboarding-page.test.tsx src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx src/features/shopping/api/shopping-api.test.ts src/features/shopping/hooks/use-shopping-list.test.tsx src/features/history/api/history-api.test.ts src/features/history/model/group-history.test.ts src/features/history/components/history-card.test.tsx src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.test.tsx src/features/emergency/emergency-menu-page.test.tsx`

Expected: FAIL。新画面・wizard・mode result分岐が未実装。

- [ ] **Step 4: welcomeとroot振分けを実装する**

`WelcomePage`はprofileを取得し、not_startedで「献立アイデアを考える」「家族情報を登録する」、in_progressで「設定せず献立アイデアを考える」「家族設定を続ける」を表示する。idea開始は`setOnboardingStatus(...,"skipped")`成功後に`/planner`、家族導線は`setOnboardingStatus(...,"in_progress")`成功後に`/onboarding`。`complete|skipped`で`/welcome`へ直接アクセスした場合は操作を表示せず、`Navigate replace`で`/planner`へ移す。welcomeの表示rootへ`.guided-planner-theme`を付ける。

`RootEntryPage`は認証済みuser IDを`useAuth`から受け、`householdKeys.profile(userId)`をquery key、`getProfile(client,userId)`をquery functionとしてprofile rowを取得する。pending中は進行状況を表示する。query errorまたはprofile row欠損は`not_started`へ変換せず、再読込操作を持つ`role="alert"`を表示してredirectしない。取得成功時だけstatusを判定し、`not_started|in_progress`は`/welcome`、`complete|skipped`は`/planner`へ`Navigate replace`で移す。

- [ ] **Step 5: PlannerWizardと5 stepを実装する**

route層はdraft/autosave/conflict/usage/generationを維持し、表示だけ`PlannerWizard`へ委譲する。`PlannerWizard`は`PlannerStep`、draft値、保存状態、step移動callbackを受け、DB/APIを直接呼ばない。各stepは`PlannerStepProps<TValue>`を満たし、value更新だけを親へ通知する。

submit失敗時は`plannerSubmissionSchema`のissue pathを`mapPlannerIssuePathToField`で`PlannerFieldName`別のmapへ正規化し、上部summaryと各field-local errorへ同じ内容を渡す。実入力ごとにfield名を持ち、`additionalConditions`への一括集約は行わない。配列indexはroot fieldまたはそのfieldのgroup controlへ正規化する。各入力は安定したIDと`${inputId}-error`を使い、invalid時だけ`aria-invalid="true"`と`aria-describedby`を設定する。複数issueでは質問順と質問内順の最初のinvalid fieldへfocusし、保存/APIの非field errorは上部alertだけへ表示する。

- [ ] **Step 6: meal、ingredient、cuisine stepを実装する**

`MealStep`は時間帯、`IngredientStep`は主食材、`CuisineStep`はジャンルを既存contractの選択肢だけで表示する。初期未選択、戻る/進む、heading focus、選択後も次画面から戻れば値が残ることを各component testで固定する。

- [ ] **Step 7: audience stepのmode不変条件を実装する**

household選択は利用可能家族1人以上を要求しservingsをnull、idea選択はmember IDsを空にして人数を毎回明示選択させる。modeを切り替える場合、以前のhousehold IDsまたはidea人数を送信可能状態へ残さない。利用可能家族が0件になったhousehold draftはmode未選択へ戻し、ideaへ自動降格しない。

- [ ] **Step 8: review stepと送信pipelineを実装する**

任意条件はreview内のdetails/dialogから開き、時間、予算、避ける食材、memo、pantry選択を既存componentで編集する。生成時は`plannerSubmissionSchema.parse`、autosave flush、privacy consent確認、v2 pending作成の順に進む。profileが`not_started|in_progress`の利用者がaudienceでideaを確定した時だけ`setOnboardingStatus(...,"skipped")`を呼び、`/planner`へ直接開いただけではstatusを変更しない。

- [ ] **Step 9: AI情報説明の往復を実装する**

同意未確認時はdraft flush後に`/privacy?returnTo=%2Fplanner%3Fresume%3Dreview`へ移動する。PrivacyNoticePageの「同意して続ける」と「今はAIを使わない」は両方sanitized returnToへ戻るが、後者では同意を保存しない。reviewはprivacy query未確認なら生成buttonをdisabledにして説明linkを表示する。Task 2で確定した両mode共通・household限定・idea非送信の3 section copyは変更せず、このTaskのprivacy page/test変更はreview `returnTo`統合だけを検証する。

- [ ] **Step 10: guardを外しルート契約を更新する**

`RequireSession`は維持する。`RequireCompletedOnboarding` componentとimportを削除し、AppShell配下へ`/planner`、`/generation`、`/menus/:menuId`、`/pantry`、`/history`、`/shopping`、`/settings`を直接配置する。`/emergency-menus`の既存unguarded reachabilityを維持する。`/welcome`と`/onboarding`はRequireSession配下に置く。家族0人でも5 routeそれぞれが理解可能なempty stateを描画できるようにし、route entryだけを理由に家族一覧・家族安全再検証を開始しない。`EmergencyMenuPage`は下書きなしまたはidea下書きで対象家族が0人なら、家族不在を説明して家族設定への任意導線を示し、緊急献立APIを呼ばない。eligible household memberが存在するときだけ既存の家族向け緊急献立を開始する。

同じ公開境界で`HouseholdOnboardingPage`の「必須設定」「残りはあとで設定して完了」などの文言だけを、家族設定が任意であると明確に伝える「家族設定（任意）」「この家族の設定を完了」などへ変更する。保存順序と画面から送るstatusはTask 2の`in_progress|complete`契約を維持し、`skipped`操作をこの画面へ追加しない。

- [ ] **Step 11: minimum idea result boundaryを実装する**

menu result queryへ`target_mode`と`preference_snapshot`を追加する。`preference_snapshot.submission`を`plannerSubmissionSchema.safeParse`し、成功時だけ`sourceSubmission`へ設定する。`MenuResultPage`はaggregate読込後にhousehold bodyまたはidea bodyへコンポーネント境界で分岐し、各child rootへ`.guided-planner-theme`を付ける。household bodyだけが`useMenuRevalidation`、active-list/reconcilable query、shopping pending replay hookをmountする。hookのconditional callではなくmode別child componentで分離する。`MenuResultViewModel.targetMode`を唯一のUI判定元とし、household bodyだけが買い物作成button、Create sheet、Reconcile sheetをrenderする。`fetchReconcilableMenuSource`のmenu queryにも`target_mode='household'`を加えるが、これはTask 5のHTTP/DB拒否に対する防御層とする。idea bodyは`InlineNotice`で「家族条件を使用していません」「年齢・アレルギーへの適合は確認されていません」を常時表示し、`MenuResult`へ`mode="idea"`とactionsなしを渡す。`MenuResult`はideaでadaptation、label confirmation、family safety summaryをrenderせず、4つのshopping endpointを呼ばない。

- [ ] **Step 12: 公開時点のhistory read-only境界を実装する**

history一覧selectへ`target_mode`を追加し、group modelへ`targetMode`を保持する。`history-api.test.ts`でquery selectに`target_mode`が含まれることとDB rowからgroup入力へのmappingを直接固定する。cardは「アイデア」「家族に合わせた献立」の文字badgeでmodeを示し、`history-card.test.tsx`で両badgeとidea cardに家族安全確認済みと誤解させる表現がないことを直接固定する。詳細はmenu aggregateを取得して権威ある`targetMode`を判定した後にmode別child componentへ分岐し、mode-aware child rootだけへ`.guided-planner-theme`を付ける。履歴一覧ページ全体の背景は変更しない。household childは現行family revalidationとshopping経路を維持する。idea childは常時noticeと献立本文だけを表示し、保存済みsnapshotを家族安全表示として解釈しない。family revalidation、shopping query/hook/pending replay、採用、お気に入り、冷蔵庫反映、whole/dish再生成のhook・component・4 endpointはmountしない。Task 7はこの境界を維持したまま許可操作だけを有効化する。

- [ ] **Step 13: 既存E2E導線を新しいrouteへ更新する**

auth fixtureはログイン後の`/welcome`または`/planner`をstatus別に待つ。onboarding、auth recovery、OAuthの旧`/onboarding`強制期待を新root分岐へ変更する。generation E2Eへ「家族設定を省略→4質問→idea人数N→privacy→review→生成→notice付き本文」を追加し、Nには1または20の境界値を1件以上使う。結果に`N人分`と表示され、保存されたmenu rowの`servings`も同じNであることをassertする。Task 6ではidea操作buttonが存在せず、shoppingのcreate/preview/reconcile/revalidate requestが0件、`sessionStorage`に`kondate:shopping:` prefixのkeyが0件であることも確認する。さらに`skipped`かつ家族0人の利用者で`/pantry`、`/history`、`/shopping`、`/settings`、`/emergency-menus`を1つずつ直接開き、onboarding redirectなし、page errorなし、理解可能なempty state、家族安全request 0件を5-route smoke matrixで検証する。`/emergency-menus`は下書きなしとidea下書きを両方検証し、緊急献立APIを含む家族安全HTTP/query activityが0件であることを固定する。人数の範囲エラーではfield-local descriptionと最初のinvalid field focusを検証する。

- [ ] **Step 14: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/welcome/welcome-page.test.tsx src/features/auth/root-entry-page.test.tsx src/app/router.test.tsx src/features/auth/protected-routes.test.tsx src/features/household/household-onboarding-page.test.tsx src/features/planner/model/planner-wizard.test.ts src/features/planner/components/planner-wizard.test.tsx src/features/planner/planner-page.test.tsx src/features/planner/planner-route.test.tsx src/features/planner/planner-route-conflict.test.tsx src/features/planner/planner-route-limits.test.tsx src/features/privacy/privacy-notice-page.test.tsx src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx src/features/shopping/api/shopping-api.test.ts src/features/shopping/hooks/use-shopping-list.test.tsx src/features/history/api/history-api.test.ts src/features/history/model/group-history.test.ts src/features/history/components/history-card.test.tsx src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.test.tsx src/features/emergency/emergency-menu-page.test.tsx`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: focused Vitestと全E2Eを含め全てexit 0。idea resultに家族向け操作・表示がない。

- [ ] **Step 15: コミットする**

```bash
git add src/app src/features/auth src/features/welcome src/features/household/household-onboarding-page.tsx src/features/household/household-onboarding-page.test.tsx src/features/planner src/features/privacy/privacy-notice-page.tsx src/features/privacy/privacy-notice-page.test.tsx src/features/generation src/features/shopping/api src/features/shopping/hooks src/features/history/api/history-api.ts src/features/history/api/history-api.test.ts src/features/history/model/group-history.ts src/features/history/model/group-history.test.ts src/features/history/components/history-card.tsx src/features/history/components/history-card.test.tsx src/features/history/pages/history-page.tsx src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.tsx src/features/history/pages/history-detail-page.test.tsx src/features/emergency/emergency-menu-page.tsx src/features/emergency/emergency-menu-page.test.tsx shared/contracts/menu-result.ts e2e/fixtures/auth.ts e2e/specs/onboarding.spec.ts e2e/specs/auth-recovery.spec.ts e2e/specs/oauth-mock.spec.ts e2e/specs/generation-recovery-results.spec.ts e2e/specs/menu-domain-pantry.spec.ts
git commit -m "feat: 家族設定任意の献立ウィザードを公開"
```

---

### Task 7: idea結果、履歴、再生成を完全対応する

**Files:**
- Modify: `src/features/generation/pages/menu-result-page.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `src/features/generation/components/menu-result.tsx`
- Modify: `src/features/generation/components/menu-result.test.tsx`
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

Task 6のread-only notice・本文・history mode badgeを維持したまま、idea result/detailで採用、お気に入り、冷蔵庫、whole/dish再生成が利用でき、買い物・label確認・family revalidationがないことをassertする。create/preview/reconcile/revalidate/pending replayのshopping UI・hook・HTTPがすべて不在で、`kondate:shopping:*`を作らないこともassertする。

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

- [ ] **Step 4: Task 6のread-only境界を維持して許可操作を有効化する**

Task 6で完成済みのhistory query、文字badge、mode別child分岐は再定義しない。idea childのnoticeと本文、family revalidation・shopping非mountを維持しながら、次Stepの採用、お気に入り、冷蔵庫反映、再生成だけを明示的にmountする。household childの既存操作と安全境界は変更しない。

- [ ] **Step 5: idea resultの許可操作を有効化する**

採用は既存`useAcceptMenuVersion`、お気に入りは既存`setMenuFavorite`、冷蔵庫反映は現在のpantry owner/updatedAt競合APIを使う。これらはfamily fingerprintを要求しない分岐にする。label確認callbackはideaでは作らない。買い物buttonはDOMへ出さない。

- [ ] **Step 6: mode別再生成hookと理由制約を実装する**

`useRegeneration`は上のunionを受け、householdだけ`phase === "checked"`かつactionable resultを要求する。ideaはrevalidation引数を受けず、それ以外のowner、pending保存、quota/生成中制御を共有する。clientはsource menu ID、dish ID、reasonだけをv2 wireで送る。mode/servings/member IDsは送らず、Task 4 snapshotが元menuから複製する。`RegenerationSheet`はideaで`child_friendly`をfilterする。serverはsnapshot作成後かつmarkSent前にidea+child_friendlyを拒否する。whole/dish両方でsource mode、servings、lineage versionを維持する。

- [ ] **Step 7: 対象変更を新規draftとして実装する**

menu result queryはowner RLS下で`preference_snapshot`を読み、`plannerSubmissionSchema`で検査した`sourceSubmission`だけをview modelへ公開する。mode変更操作は`createPlannerDraftFromMenu`を使う新規作成として実装し、元menu条件を保持しながら対象3項目だけnull/空へ戻す。保存成功後に`/planner?resume=audience`へ遷移し、元menuのderivation groupや再生成lineageへ追加しない。

- [ ] **Step 8: E2Eを両modeへ拡張する**

history E2Eへidea card badge、detail notice、favorite、accept、冷蔵庫反映、whole/dish再生成、再生成後もidea、child_friendly不存在、買い物不存在を追加する。result、history detail、再生成後resultの各地点でcreate/preview/reconcile/revalidate requestが0件、shopping pending replayがmountされず、`kondate:shopping:*`が作られないことを検証する。household既存経路は現在の安全再検証、child_friendly、買い物create/reconcile/replayを維持する。

- [ ] **Step 9: focused verificationを実行する**

Run: `docker compose run --rm --no-deps app npx vitest run src/features/generation/api/menu-result-api.test.ts src/features/generation/pages/menu-result-page.test.tsx src/features/generation/components/menu-result.test.tsx src/features/history/model/group-history.test.ts src/features/history/pages/history-page.test.tsx src/features/history/pages/history-detail-page.test.tsx src/features/history/components/regeneration-sheet.test.tsx src/features/history/hooks/use-regeneration.test.tsx src/features/planner/model/draft-from-menu.test.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-service.test.ts`

Run: `./scripts/run-e2e.sh`

Run: `docker compose run --rm --no-deps app npm run typecheck`

Run: `docker compose run --rm --no-deps app npm run lint`

Run: `docker compose run --rm --no-deps app npm run format:check`

Expected: すべてexit 0。householdとideaの両fixtureが成功する。

- [ ] **Step 10: コミットする**

```bash
git add src/features/generation src/features/history/pages/history-detail-page.tsx src/features/history/pages/history-detail-page.test.tsx src/features/history/components/regeneration-sheet.tsx src/features/history/components/regeneration-sheet.test.tsx src/features/history/hooks/use-regeneration.ts src/features/history/hooks/use-regeneration.test.tsx src/features/planner/model/draft-from-menu.ts src/features/planner/model/draft-from-menu.test.ts shared/contracts/generation.ts netlify/functions/_shared/regeneration-context.ts netlify/functions/_shared/regeneration-context.test.ts netlify/functions/_shared/generation-service.ts netlify/functions/_shared/generation-service.test.ts e2e/fixtures/history.ts e2e/specs/history-regeneration.spec.ts e2e/specs/generation-recovery-results.spec.ts
git commit -m "feat: アイデア献立の履歴と再生成に対応"
```

---

### Task 8: セキュリティ統合、アクセシビリティ、全体回帰を完了する

**Files:**
- Modify: `netlify/functions/_shared/generation-adversarial.integration.test.ts`
- Modify: `netlify/functions/_shared/generation-service.test.ts`
- Modify: `src/features/planner/planner-page.test.tsx`
- Modify: `src/features/generation/pages/menu-result-page.test.tsx`
- Modify: `netlify/functions/_shared/shopping-service.test.ts`
- Modify: `netlify/functions/_shared/shopping-adapter.test.ts`
- Modify: `netlify/functions/revalidate-menu.test.ts`
- Modify: `netlify/functions/shopping-list-from-menu.test.ts`
- Modify: `netlify/functions/shopping-list-preview.test.ts`
- Modify: `netlify/functions/shopping-list-reconcile.test.ts`
- Modify: `netlify/functions/shopping-list-revalidate.test.ts`
- Modify: `src/features/shopping/api/shopping-api.test.ts`
- Modify: `src/features/shopping/hooks/use-shopping-list.test.tsx`
- Modify: `src/features/shopping/pages/shopping-list-page.test.tsx`
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
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`
- Modify: `e2e/fixtures/shopping.ts`
- Modify: `e2e/specs/shopping-list.spec.ts`
- Modify: `e2e/specs/shopping-list-races.spec.ts`

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

- [ ] **Step 3: v2 concurrencyとsource raceを実DBで検証する**

同一ownerのprocessing v2 requestを作り、別keyの`new_menu`、`regenerate_menu`、`regenerate_dish`を別backend sessionから予約する。全caseが安定した`generation_in_progress`となり、request、quota、attempt、snapshotの増分が0で、providerを呼ばないことをpgTAP/race harnessで確認する。同一key replayは保存済みstatusを返して同じ不変条件を満たし、別ownerは独立して予約できることを確認する。whole/dish再生成は予約後のsource変更・削除を外部送信前と送信後に分け、`source_menu_changed`、attempt返却/消費、success非消費、menu 0件を確認する。

- [ ] **Step 4: shopping RPC・HTTP・browser境界と不変性を検証する**

service role相当のDB sessionからidea menuを`apply_shopping_draft`と`apply_shopping_reconciliation`へ渡し、`idea_menu_not_supported`を期待する。呼出し前後のshopping list row、item row、source row、snapshot row、list version、同一keyと無関係な期限切れ行を含むmutation ledger rowを比較し、replay hit以外は全て不変であることをassertする。replay hitは保存済み成功をmode再解釈なしで返す。replay missはmode前のwrite/row lockが0件であること、owner/version/modeのerror優先順位、household全writerの`mutation replay（該当時）→lockなしsource identity→active list FOR UPDATE（存在時）→source rows/menu FOR SHARE→safety locks（menu id昇順）→writes`をrace testで固定する。apply draft/reconciliation対refresh/mutateの全cross-RPC、初回list、複数sourceでもdeadlockせず安定codeへ終端することを確認する。

HTTP/service/browser統合ではidea result/history/再生成後resultからfrom-menu、preview、reconcile、revalidateを呼ぶと固定`422/idea_menu_not_supported`、直接menu revalidationは固定`422/idea_menu_revalidation_not_supported`となり、どちらもidentity query以外の家族/member/catalog query、fingerprint、pantry、RPC、projection writeが0件であることを確認する。通常UIではこれらのrequest自体が0件で、shopping pending replayと`kondate:shopping:*`が作られないことを確認する。household fixtureでは既存create、preview、reconcile、revalidate、idempotency replay、同時実行raceを減らさず維持する。create/reconcile成功後にsourceを削除して同じmutation keyを再送するE2Eは保存済み成功を返し、idea sourceへの新規keyは422になることも固定する。

- [ ] **Step 5: Playwrightへ320px、keyboard、reduced-motion、復帰を追加する**

320px/200%で`document.documentElement.scrollWidth === document.documentElement.clientWidth`、全主要操作のbounding boxが44px以上、Tabだけで4質問・review・privacy・生成へ到達、step変更時heading focus、進捗読み上げ、選択中文字、field errorの`aria-invalid`/accessible descriptionと最初のinvalid field focus、通信切断後の同一mode/idempotency回収を検証する。`prefers-reduced-motion: reduce`ではwizard animation名が`none`であることを確認する。`skipped`かつ家族0人で`/pantry`、`/history`、`/shopping`、`/settings`、`/emergency-menus`を直接開く5-route smoke matrixは、onboarding redirectなし、render例外なし、理解可能なempty state、家族安全request 0件を確認する。`/emergency-menus`は下書きなしとidea下書きの両方で既存unguarded reachabilityを維持し、緊急献立APIを含む家族安全HTTP/query activityが0件であることを`menu-domain-pantry.spec.ts`で強化する。idea生成の正常系は明示選択した境界値Nについて結果の`N人分`表示と保存menuの`servings=N`が一致することを再確認する。shopping E2Eはideaで全network requestとstorageが0件、householdで既存create/reconcile/replay/race、source削除後replay、新規idea 422が成功することを含める。

- [ ] **Step 6: 統合テスト変更をfocused実行する**

Run: `docker compose run --rm --no-deps app npx vitest run netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-service.test.ts src/features/planner/planner-page.test.tsx src/features/generation/pages/menu-result-page.test.tsx netlify/functions/_shared/shopping-service.test.ts netlify/functions/_shared/shopping-adapter.test.ts netlify/functions/revalidate-menu.test.ts netlify/functions/shopping-list-from-menu.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts netlify/functions/shopping-list-revalidate.test.ts src/features/shopping/api/shopping-api.test.ts src/features/shopping/hooks/use-shopping-list.test.tsx src/features/shopping/pages/shopping-list-page.test.tsx`

Run: `docker compose --profile test run --rm db-test`

Run: `./scripts/run-e2e.sh`

Expected: canary、矛盾、race、shopping、UIの全追加caseが成功する。

- [ ] **Step 7: Task 8変更をコミットする**

```bash
git add netlify/functions/_shared/generation-adversarial.integration.test.ts netlify/functions/_shared/generation-service.test.ts netlify/functions/_shared/shopping-service.test.ts netlify/functions/_shared/shopping-adapter.test.ts netlify/functions/revalidate-menu.test.ts netlify/functions/shopping-list-from-menu.test.ts netlify/functions/shopping-list-preview.test.ts netlify/functions/shopping-list-reconcile.test.ts netlify/functions/shopping-list-revalidate.test.ts src/features/planner/planner-page.test.tsx src/features/generation/pages/menu-result-page.test.tsx src/features/shopping/api/shopping-api.test.ts src/features/shopping/hooks/use-shopping-list.test.tsx src/features/shopping/pages/shopping-list-page.test.tsx supabase/tests/database/ai_control_and_quota.test.sql supabase/tests/database/ai_control_and_quota_races.test.sql supabase/tests/database/history_regeneration.test.sql supabase/tests/database/shopping_lists.test.sql supabase/tests/database/shopping_lists_races.test.sql tools/openrouter-mock/fixtures/scenarios.mjs tools/openrouter-mock/fixtures/scenarios.d.mts e2e/specs/onboarding.spec.ts e2e/specs/generation-recovery-results.spec.ts e2e/specs/history-regeneration.spec.ts e2e/specs/foundation.spec.ts e2e/specs/menu-domain-pantry.spec.ts e2e/fixtures/shopping.ts e2e/specs/shopping-list.spec.ts e2e/specs/shopping-list-races.spec.ts
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

`AGENTS.md` 9章に従い、`reviewer`役のTOMLまたは親設定を正としてTask 1開始前commitからTask 8 HEADまでのreview packageを渡す。設計適合性、RLS/owner、v2 HMAC/replay、family canary、shopping不変性、アクセシビリティ、household回帰を確認する。contextを共有しない別ReviewerがCritical/Important指摘を再現検証し、妥当な指摘はfresh Implementerで修正後、9段階gateと両レビューを再実行する。未解決Critical/Importantが0件になった時だけPlan完了とする。

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
9. 次Taskがある場合はPlan ID 7を使った`handoff-plan-7-task-<completed>-to-task-<next>-<head7>.md`を`AGENTS.md`どおりwrite-onceで作成し、canonical pathとGit正本を再確認してから次Taskへexact pathだけを渡す。

## Completion Criteria

- 家族0人のログイン利用者が`/welcome`からidea modeを選び、4質問、人数、privacy説明、review、生成、結果、履歴、再生成を完了できる。
- household modeの安全確認、revalidation、label確認、target members、quota、HMAC、復帰が回帰しない。
- idea modeの全レイヤーで家族情報canaryが0件、家族向け安全表示が0件、買い物操作が0件である。
- v2 replayと別key同時予約が二重request・二重attempt・二重successを起こさず、ownerごとのprocessing制約を維持する。
- `skipped`かつ家族0人で`/pantry`、`/history`、`/shopping`、`/settings`、`/emergency-menus`へ直接到達でき、理解可能な空状態を表示し、不適切な家族安全requestを送らない。緊急献立は下書きなしとidea下書きの両方で既存のunguarded reachabilityを維持する。
- 全migration、生成型、Vitest、pgTAP、Playwright、build、diff checkが一致し、最終一次・二次レビューに未解決Critical/Importantがない。
