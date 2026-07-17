# 提出前E2E既存不具合修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提出前E2Eで判明した、期限切れ食材の確認操作と完了済み家族のアレルギー登録順序の既存不具合を、DB制約を維持したまま修復する。

**Architecture:** 期限切れ食材のE2Eは確認待ちの操作を最終状態APIではなく通常clickとして表現する。完了済み家族の`registered`変更はアレルギー0件の間はローカルに保留し、最初のアレルギーINSERT成功後に既存の保存queueで家族行を更新する。

**Tech Stack:** React 19、TypeScript、TanStack Query、Supabase、Vitest、React Testing Library、Playwright、Docker、Git

## Global Constraints

- 設計の正本は `docs/superpowers/specs/2026-07-18-e2e-validation-existing-failures-design.md` とする。
- ホスト上でNode.js、npm、Playwrightを実行しない。
- Node/npm/PlaywrightコマンドはDocker経由で実行する。
- コマンドは結合せず、1コマンドごとに独立したツール呼び出しで実行する。
- complete家族を`allergy_status = 'registered'`へ保存する前に、1件以上のアレルギーINSERTが成功していなければならない。
- アレルギー追加に成功していない場合は、保留中の`registered`をDBへ保存しない。
- 既存の保存queue、安全条件無効化、最後のアレルギー削除禁止、DB制約を維持する。
- DBスキーマ、RLS、マイグレーション、Compose、依存パッケージ、CSS、Playwright MCP設定、緊急献立契約は変更しない。
- コメント、コミットメッセージ、追加ドキュメントは日本語にする。
- ユーザー所有の未コミット変更が現れた場合は変更、整形、ステージ、コミットしない。

---

## File Structure

- Modify: `src/features/household/household-settings-page.test.tsx` — complete家族の`registered`保存保留と、最初のアレルギー追加後の保存順序を固定する。
- Modify: `src/features/household/household-settings-page.tsx` — DB制約を満たす二段階保存を実装する。
- Modify: `e2e/specs/menu-domain-pantry.spec.ts` — 期限確認dialogの操作契約とcomplete家族のアレルギー登録順序を実画面で検証する。

---

### Task 1: 完了済み家族のアレルギー登録を二段階保存にする

**Files:**
- Modify: `src/features/household/household-settings-page.test.tsx`
- Modify: `src/features/household/household-settings-page.tsx`

**Interfaces:**
- Consumes: `HouseholdSettingsApi.addStandardAllergy()`、`addCustomAllergy()`、`updateMember()`、`invalidateSafety()`、既存の`saveQueue`。
- Produces: complete家族でアレルギー0件の`registered`をローカル保留し、最初のアレルギー追加後に`Promise<boolean | undefined>`で保存結果を返す内部処理。

- [ ] **Step 1: REDとなるUnitテストを追加する**

`household-settings-page.test.tsx`の型importへ`MemberAllergyRow`を追加する。

```ts
import type {
  AllergenCatalogRow,
  HouseholdMemberRow,
  MemberAllergyRow,
} from "./household-api";
```

catalog定義の後へ、標準アレルギー行を追加する。

```ts
const walnutAllergy: MemberAllergyRow = {
  id: "allergy-1",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: "walnut",
  custom_name: null,
  custom_aliases: [],
  custom_confirmed: false,
  created_at: "2026-07-11T00:00:00.000Z",
};
```

既存の保存テストの近くへ次を追加する。

```ts
it("アレルギー0件のcomplete家族ではregisteredの保存を保留する", async () => {
  const { updateMember } = renderSettings();

  await userEvent.selectOptions(
    await screen.findByLabelText("アレルギーの確認"),
    "registered",
  );

  expect(screen.getByRole("status")).toHaveTextContent(
    "登録ありの場合は1つ以上選んでください",
  );
  expect(updateMember).not.toHaveBeenCalled();
});

it("最初のアレルギー追加成功後に保留したregisteredを保存する", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const { updateMember, invalidateSafety } = renderSettings({ addStandardAllergy });

  await userEvent.selectOptions(
    await screen.findByLabelText("アレルギーの確認"),
    "registered",
  );
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "walnut");
  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
    );
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
  });
});
```

2件目はアレルギー追加Promiseを未解決のまま検査することで、追加が成功していない間は`updateMember`を呼ばない不変条件も固定する。

- [ ] **Step 2: Unitテストが期待どおり失敗することを確認する**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-settings-page.test.tsx
```

Expected: 終了コード1。最初のテストは`updateMember`が呼ばれたため失敗し、2件目はアレルギー追加成功後も保留状態が保存されないため失敗する。既存テストの別エラーではない。

- [ ] **Step 3: `registered`の保存保留と追加後保存を実装する**

`allergiesQuery`の直後に現在のアレルギー一覧を定義し、現在の末尾側にある同じ定義を削除する。

```ts
const currentAllergies = allergiesQuery.data ?? [];
```

`queueSave`の後へ次を追加する。

```ts
const savePendingRegisteredStatus = async (): Promise<boolean | undefined> => {
  if (
    selected === undefined ||
    values === undefined ||
    selected.status !== "complete" ||
    selected.allergy_status === "registered" ||
    values.allergyStatus !== "registered"
  ) {
    return undefined;
  }
  return queueSave(values);
};
const finalizeAllergyChange = async (memberId: string): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: householdKeys.allergies("settings", memberId),
  });
  const registeredStatusSaved = await savePendingRegisteredStatus();
  if (registeredStatusSaved !== true) {
    await api.invalidateSafety();
  }
};
```

`updateAndSave`を次へ置き換える。

```ts
const updateAndSave = (patch: Partial<HouseholdSettingsValue>) => {
  const next = { ...(values as HouseholdSettingsValue), ...patch };
  update(patch);
  if (
    selected?.status === "complete" &&
    next.allergyStatus === "registered" &&
    currentAllergies.length === 0
  ) {
    setMessage("登録ありの場合は1つ以上選んでください");
    return;
  }
  void queueSave(next);
};
```

`AllergyEditor`の`addStandard`と`addCustom`を次へ置き換える。

```tsx
addStandard={async (memberId, allergenId) => {
  await api.addStandardAllergy(memberId, allergenId);
  await finalizeAllergyChange(memberId);
}}
addCustom={async (memberId, name, aliases) => {
  await api.addCustomAllergy(memberId, name, aliases);
  await finalizeAllergyChange(memberId);
}}
```

アレルギー追加がrejectした場合は`finalizeAllergyChange`へ到達しないため、保留中の`registered`は保存されない。追加後の家族保存が失敗した場合は`save()`が失敗メッセージを設定し、`finalizeAllergyChange`が追加済みアレルギーに対する安全条件無効化だけを実行する。

- [ ] **Step 4: UnitテストをGREENにする**

Run:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/household-settings-page.test.tsx
```

Expected: 対象ファイルの全テスト成功、終了コード0。

- [ ] **Step 5: Task 1の型・Lint・フォーマットを検証する**

Run:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

Expected: 終了コード0。

Run:

```bash
docker compose run --rm --no-deps app npm run lint
```

Expected: 終了コード0。既存のFast Refresh warning以外を追加しない。

Run:

```bash
docker compose run --rm --no-deps app npx prettier --check src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx
```

Expected: 終了コード0。

Run: `git diff --check -- src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx`

Expected: 出力なし、終了コード0。

- [ ] **Step 6: Task 1をコミットする**

Run: `git add src/features/household/household-settings-page.tsx src/features/household/household-settings-page.test.tsx`

Run: `git commit -m "fix: 完了済み家族のアレルギー登録を直す"`

Expected: 家族設定の二段階保存とUnitテストだけを含む日本語Conventional Commitが作成される。

- [ ] **Step 7: Task 1を独立レビューする**

親エージェントはTask 1のbaseからHEADまでのreview packageを作る。freshな一次ReviewerはDB制約、保存queue、失敗経路、安全条件無効化、draft/既存registered/none/unconfirmedの回帰を確認する。別のfreshな二次Reviewerは一次判定を独立検証する。妥当なCriticalまたはImportantがあれば単一Implementerで修正し、Step 4から再実行する。

---

### Task 2: 段階的な確認フローをE2Eへ反映する

**Files:**
- Modify: `e2e/specs/menu-domain-pantry.spec.ts`

**Interfaces:**
- Consumes: Task 1のcomplete家族における`registered`保存保留と、期限切れ食材の既存確認dialog。
- Produces: `click -> dialog中は未選択 -> 確認後は選択済み`と、`registered選択 -> アレルギー追加 -> DB保存`を検証するE2E。

- [ ] **Step 1: 保存済みRED証拠を確認する**

Read:

- `.superpowers/sdd/task-3-smoke-report.md`
- `test-results/menu-domain-pantry-pantry--88098-heck-and-all-reviewed-meals-desktop-chromium/error-context.md`
- `test-results/menu-domain-pantry-keeps-a-1d096-xplicit-no-candidate-result-desktop-chromium/error-context.md`

Expected: 期限切れcheckboxはdialog表示中に未選択であるため`check()`が失敗し、complete家族のアレルギー0件`registered` PATCHは`member_registered_allergy_required`で失敗する。artifactが直前実行で置き換わっている場合は、親の診断記録を正とする。

- [ ] **Step 2: 期限確認を開く操作を`click()`へ変更する**

`menu-domain-pantry.spec.ts`にある、期限切れ食材の確認dialogを開く3か所だけを次の形へ変更する。

```ts
await page.getByRole("checkbox", { name: "キャベツ" }).click();
await expect(page.getByRole("alertdialog")).toContainText("アプリは食べられるか判断しません");
```

対象は最初の期限切れ食材選択、reload後に再確認を要求する選択、削除検証前の期限切れ食材選択である。確認済みの同一attemptで最終checked状態を要求する既存`check()`は維持する。

- [ ] **Step 3: complete家族のE2Eを二段階保存へ合わせる**

`keeps an incompatible current allergy as an explicit no-candidate result`の冒頭を次へ置き換える。

```ts
await page.goto("/settings");
await page.getByLabel("アレルギーの確認").selectOption("registered");
await expect(page.getByRole("status")).toContainText("登録ありの場合は1つ以上選んでください");
await page.getByRole("button", { name: "鶏肉を追加" }).click();
const selectedAllergies = page.getByRole("list", { name: "選択済みアレルギー" });
await expect(
  selectedAllergies.getByRole("button", { name: "鶏肉を削除", exact: true }),
).toBeVisible();
await expect(page.getByRole("button", { name: "鶏肉を追加" })).toBeDisabled();
await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
await page.reload();
await expect(page.getByLabel("アレルギーの確認")).toHaveValue("registered");
await expect(
  page
    .getByRole("list", { name: "選択済みアレルギー" })
    .getByRole("button", { name: "鶏肉を削除", exact: true }),
).toBeVisible();
```

reload後の検証により、画面のローカル値だけでなくDBへ`registered`とアレルギーが保存されたことを確認する。後続のplannerと緊急献立の検証は維持する。

- [ ] **Step 4: 2つの失敗ケースをfocused実行する**

main checkoutのstackをボリューム削除なしで停止し、worktree stackを起動してから実行する。stack操作は親エージェントが独立コマンドで行う。

Run:

```bash
./scripts/run-e2e.sh e2e/specs/menu-domain-pantry.spec.ts --project=desktop-chromium --grep "pantry CRUD|keeps an incompatible"
```

Expected: 2 tests passed、終了コード0。期限確認dialog、確認後checked、DBへ保存された`registered + 鶏肉`、緊急献立のno-candidate結果を確認する。

- [ ] **Step 5: Task 2のフォーマットと差分を検証する**

Run:

```bash
docker compose run --rm --no-deps app npx prettier --check e2e/specs/menu-domain-pantry.spec.ts
```

Expected: 終了コード0。

Run: `git diff --check -- e2e/specs/menu-domain-pantry.spec.ts`

Expected: 出力なし、終了コード0。

- [ ] **Step 6: Task 2をコミットする**

Run: `git add e2e/specs/menu-domain-pantry.spec.ts`

Run: `git commit -m "test: 段階的な安全確認をE2Eへ反映"`

Expected: 対象E2Eだけを含む日本語Conventional Commitが作成される。

- [ ] **Step 7: Task 2を独立レビューする**

親エージェントはTask 2のbaseからHEADまでのreview packageを作る。freshな一次Reviewerは`click()`へ変更した3か所、確認済みattemptの`check()`維持、reloadによるDB永続化、既存後続assertionの維持を確認する。別のfreshな二次Reviewerは一次判定を独立検証する。妥当なCriticalまたはImportantがあれば単一Implementerで修正し、Step 4から再実行する。

---

### Task 3: 失敗ステップ以降の提出前検証を完了する

**Files:**
- Verify: repository全体
- Modify: `.superpowers/sdd/progress.md`（ignored ledger）

**Interfaces:**
- Consumes: Task 1とTask 2のコミット、既にPASSした必須検証1〜6、稼働中のworktree stack。
- Produces: 必須検証7〜9の成功証拠、main stack復元、元計画Task 3のcomplete ledger。

- [ ] **Step 1: Docker実行前のworktree baselineを保存する**

Run: `git diff --cached --name-status`

Run: `git diff --name-status`

Run: `git ls-files --others --exclude-standard`

Expected: 3コマンドとも出力なし。意図しない差分があれば検証を開始しない。

- [ ] **Step 2: 必須検証7を再実行する**

Run:

```bash
./scripts/run-e2e.sh
```

Expected: 全E2E成功、終了コード0。通常のAuthとappの復元も成功する。

- [ ] **Step 3: 必須検証8を再実行する**

Run:

```bash
docker compose run --rm --no-deps app npm run build
```

Expected: TypeScriptチェックとVite本番ビルド成功、終了コード0。

- [ ] **Step 4: 必須検証9を再実行する**

Run: `git diff --check`

Expected: 出力なし、終了コード0。

- [ ] **Step 5: Docker実行後のworktree baselineを比較する**

Run: `git diff --cached --name-status`

Run: `git diff --name-status`

Run: `git ls-files --others --exclude-standard`

Expected: 実行前と同じく3コマンドとも出力なし。意図しない差分があれば新しい作業を開始しない。

- [ ] **Step 6: worktree stackを停止してmain stackを復元する**

Run from worktree: `docker compose down`

Expected: `--volumes`を使用せず、worktree側コンテナとnetworkだけを停止・削除する。

Run from `/home/dev/projects/kondate`: `docker compose up -d --wait`

Expected: main側の既存volumeを再利用し、全healthcheck成功、migrate exit 0。

- [ ] **Step 7: 元計画Task 3をledgerでcompleteにする**

Run: `git rev-parse --short HEAD`

`.superpowers/sdd/progress.md`のTask 3行を`Task 3: complete`で始め、上のコマンドが返した実在する短縮commit hashと、MCP smoke完了、最終一次・二次レビュー承認、必須検証成功、EOF順序の監査証跡に関する非blocking Minor 1件、main stack復元済みを同じ行へ記録する。

- [ ] **Step 8: ブランチ全体のreview packageと最終レビューへ戻る**

merge base `203df0c`からHEADまでのreview packageを`superpowers:subagent-driven-development`の`review-package` scriptで作る。`superpowers:requesting-code-review`を使用し、freshな最終Reviewerへ設計、計画、package、Task reports、Task 3の一次・二次レビュー結果を渡す。Critical/Importantがあれば単一Implementerでまとめて修正し、影響するfocused検証と必要な提出前検証を再実行する。

- [ ] **Step 9: 完了検証と統合方法の提示を行う**

`superpowers:verification-before-completion`で最終証拠とclean状態を確認する。続いて`superpowers:finishing-a-development-branch`を使用し、ユーザーへmerge、PR、保持、破棄の選択肢を提示する。
