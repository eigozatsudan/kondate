# 初回家族設定: 複数登録アテンション強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/onboarding` で1人目完了後に即 `/planner` へ飛ばさず、見逃しにくい callout と次アクション（献立を始める / 続けて家族を追加 / 条件付き skip）を出し、複数登録できることを伝える。

**Architecture:** `HouseholdOnboardingForm` 内で `completeMember` と `setProgress("complete")` を分離する。次アクション条件は `draft === null && completeMembers.length > 0`。CTA 分岐のため既存 `getProfile` + `householdKeys.profile` を読む（RPC 変更なし）。静的案内は `InlineNotice`。complete 後も `invalidateHouseholdSafetyDependents` は維持する（members refetch が走るため **unit の listMembers は stateful 必須**）。

**Tech Stack:** React 19 / TanStack Query 5 / TypeScript strict / Vitest / RTL / Playwright E2E

**仕様書:** `docs/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md`（敵対的レビュー反映済み）  
**設計敵対的レビュー:** `docs/reviews/2026-07-31-onboarding-multi-member-attention-design-adversarial.md`  
**計画レビュー:** `docs/reviews/2026-07-31-onboarding-multi-member-attention-plan-reviews.md`（一次・二次・敵対）→ **本版 r1 で C-P1〜C-P3 / I-P1〜I-P5 を吸収**

## Plan revision summary (r1)

| ID | 反映 |
|----|------|
| C-P1 | `createMembersApiState` + complete/createDraft で upsert。invalidate 後も complete が残る |
| C-P2 | factory / `handleCompleteClick` / 開始画面 JSX を全文掲載。`// ...` 禁止 |
| C-P3 | 旧 it 削除リストと置換コードを明示 |
| I-P1 | completeMember 中も `actionPending` |
| I-P2 | member 0 開始画面の全文 |
| I-P3 | 全テスト `baseApi` 化、直書き API を grep 0 件 |
| I-P4 | `./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts` のみ |
| I-P5 | setProgress 成功後は `invalidateQueries(profile)` を維持（setQueryData 任意） |
| M-P2 | Execution Handoff の選択質問を削除 |

## Global Constraints

- Node.js `>=24 <25`。Node/npm は `docker compose run --rm --no-deps app ...`。**コマンドを `&&` / `;` で連結しない**（AGENTS.md）。
- RED → GREEN → focused verify → 日本語 Conventional Commit。1 Task = 1 単位。
- UI・コメント・コミットは日本語。識別子・テスト名は英語。`any` / 未検査 cast 禁止。
- 320 CSS px・タッチ 44×44（`min-h-11` / `primary-button` 等既存クラス）。
- **DB / RPC / マイグレーション変更禁止。** `set_onboarding_status` 遷移表を変えない。
- Welcome / settings 画面の大改修禁止。`/settings` ディープリンク禁止（文言のみ）。
- `git push` / PR / 本番 deploy / `--no-verify` 禁止。
- 検証は `format:check`（`format` の write は使わない）。
- プレースホルダ禁止: `// ...`、「同様に」「流用」だけのステップを置かない。
- **unit で members を返す mock は stateful にする**（C-P1）。`invalidateHouseholdSafetyDependents` を onboarding から外さない。

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `HouseholdOnboardingApi.getProfile` | `household-onboarding-page.tsx` | `() => Promise<ProfileRow>`。必須 |
| `createHouseholdApi` | 同 | `getProfile: () => getProfile(client, userId)` を含む全文 |
| 次アクション条件 | 同 | `draft === null && completeMembers.length > 0` |
| skip 表示 | 同 | `onboarding_status === "not_started" \|\| === "in_progress"` のみ。未取得・error は非表示 |
| 主 CTA ラベル | 同 | **常に** `献立を始める` |
| 主 CTA 動作 | 同 | status が `complete` なら `setProgress` 省略して `onDone()` のみ。それ以外は `setProgress("complete")` 成功後 `onDone()`。成功後 profile は `invalidateQueries(householdKeys.profile)` |
| 副 CTA | 同 | `続けて家族を追加` → `startMutation.mutate()` → `createDraft(members.length)` |
| callout | 同 | `InlineNotice` `tone="notice"`。文言は下表固定 |
| 人数行 | 同 | 常に `` `${n}人の設定が完了しています。` `` |
| focus | 同 | 次アクション `h1` に `tabIndex={-1}` + `draft===null && completeMembers.length>0` のとき `focus()` |
| pending | 同 | `actionPending` は **completeMember 実行中**・finish・skip 中に true。フォーム完了ボタンと次アクション CTA を disable。`startMutation.isPending` も副 CTA に併用 |

### 固定 copy

```ts
const CALLOUT_FIRST_TITLE = "まずは1人分から登録しましょう";
const CALLOUT_FIRST_BODY =
  "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。";
const CALLOUT_MORE_TITLE = "続けて家族を登録できます";
const CALLOUT_MORE_BODY =
  "何人でも登録できます。登録が終わったら「献立を始める」で先に進めます。あとから設定の「家族設定」でも追加・編集できます。";
const NEXT_ACTION_BODY =
  "ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。";
// h1: n===1 ? "1人目の登録が完了しました" : "登録が完了しました"
// primary: "献立を始める" / secondary: "続けて家族を追加"
// skip: "あとで設定する（アイデアから始める）"
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/household/household-onboarding-page.tsx` | profile 読取、callout、次アクション UI、complete/setProgress 分離、focus、pending |
| `src/features/household/household-onboarding-page.test.tsx` | stateful members + baseApi + 設計 §7.1 |
| `e2e/specs/onboarding.spec.ts` | 次アクション経由（必須） |
| 触らない | `household-settings-page.*`、welcome、RPC、migrations |

### 削除する既存 it（Task 1 で必ず消す）

| 旧 it 名（完全一致） | 理由 |
|----------------------|------|
| `resumes one draft, saves each required selection, and completes through completeMember->setProgress->navigate` | complete→navigate 廃止 |
| `stays on the page and shows a retryable error when setProgress fails after completeMember succeeds` | setProgress が complete 直列でない |
| `completes onboarding through setProgress->navigate when a complete member already exists and no draft is open` | ボタン名・契約変更 |
| `stays on the page with a retryable error when setProgress fails for an already-complete member` | 主 CTA 名変更（置換 it で再掲） |
| `draft が無く complete member が既にいる場合も任意性が明確な完了ボタン文言を使う` | 旧「この家族の設定を完了する」期待 |

---

### Task 1: complete 後は navigate せず次アクションへ（コアフロー）

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`
- Test: 同 test ファイル

**Interfaces:**
- Consumes: 既存 `HouseholdOnboardingApi` フィールド + 本 Task で `getProfile`
- Produces: 次アクション UI、`canShowSkip`、`actionPending`、stateful テストヘルパ

- [ ] **Step 1: 実装側 interface / factory を拡張する（テストより先に型だけでも可。本 Step では page の型と factory を先に直し、テストがコンパイルできるようにする）**

`household-onboarding-page.tsx` の import に追加:

```ts
import {
  addCustomMemberAllergy,
  addStandardMemberAllergy,
  completeHouseholdMember,
  deleteMemberAllergy,
  getProfile,
  listAllergenAliases,
  listAllergenCatalog,
  listHouseholdMembers,
  listMemberAllergies,
  setOnboardingStatus,
  startHouseholdOnboarding,
  updateHouseholdMemberDraft,
  type HouseholdDraftPatch,
  type HouseholdMemberRow,
  type ProfileRow,
} from "./household-api";
```

（既存 import をこの集合に置き換える。欠けていた `getProfile` / `ProfileRow` を必ず含める。）

```ts
export interface HouseholdOnboardingApi {
  listMembers: () => Promise<HouseholdMemberRow[]>;
  getProfile: () => Promise<ProfileRow>;
  createDraft: (sortOrder: number) => Promise<HouseholdMemberRow>;
  updateDraft: (memberId: string, patch: HouseholdDraftPatch) => Promise<HouseholdMemberRow>;
  completeMember: (memberId: string) => Promise<HouseholdMemberRow>;
  listAllergies: (memberId: string) => Promise<Awaited<ReturnType<typeof listMemberAllergies>>>;
  listCatalog?: () => Promise<Awaited<ReturnType<typeof listAllergenCatalog>>>;
  listAliases?: () => Promise<Awaited<ReturnType<typeof listAllergenAliases>>>;
  addStandardAllergy?: (memberId: string, allergenId: string) => Promise<unknown>;
  addCustomAllergy: (memberId: string, name: string, aliases: string[]) => Promise<unknown>;
  removeAllergy?: (allergyId: string) => Promise<unknown>;
  setProgress: (status: "in_progress" | "complete" | "skipped") => Promise<unknown>;
}

function createHouseholdApi(userId: string): HouseholdOnboardingApi {
  const client = getBrowserSupabaseClient();
  return {
    listMembers: () => listHouseholdMembers(client, userId),
    getProfile: () => getProfile(client, userId),
    createDraft: (sortOrder) => startHouseholdOnboarding(client, sortOrder),
    updateDraft: (memberId, patch) => updateHouseholdMemberDraft(client, userId, memberId, patch),
    completeMember: (memberId) => completeHouseholdMember(client, userId, memberId),
    listAllergies: (memberId) => listMemberAllergies(client, userId, memberId),
    listCatalog: () => listAllergenCatalog(client),
    listAliases: () => listAllergenAliases(client),
    addStandardAllergy: (memberId, allergenId) =>
      addStandardMemberAllergy(client, userId, memberId, allergenId),
    addCustomAllergy: (memberId, name, aliases) =>
      addCustomMemberAllergy(client, userId, memberId, name, aliases),
    removeAllergy: (allergyId) => deleteMemberAllergy(client, userId, allergyId),
    setProgress: (status) => setOnboardingStatus(client, userId, status),
  };
}
```

- [ ] **Step 2: テストヘルパ（stateful members + baseApi + mockProfile）を test ファイル先頭に追加する**

`household-onboarding-page.test.tsx` の import と draft 定数の直後に:

```ts
import type { ProfileRow } from "./household-api";

function mockProfile(status: string): ProfileRow {
  return {
    user_id: "user-1",
    onboarding_status: status,
    onboarding_completed_at:
      status === "complete" || status === "skipped" ? "2026-07-11T00:00:00.000Z" : null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

/** invalidate → listMembers refetch 後も complete が残るようにする（C-P1） */
function createMembersApiState(initial: HouseholdMemberRow[]) {
  let members = initial.map((member) => ({ ...member }));
  return {
    listMembers: vi.fn(async () => members.map((member) => ({ ...member }))),
    upsert(member: HouseholdMemberRow) {
      const index = members.findIndex((item) => item.id === member.id);
      if (index >= 0) {
        members[index] = { ...member };
      } else {
        members = [...members, { ...member }];
      }
    },
    snapshot(): HouseholdMemberRow[] {
      return members.map((member) => ({ ...member }));
    },
  };
}

function baseApi(overrides: Partial<HouseholdOnboardingApi> = {}): HouseholdOnboardingApi {
  return {
    listMembers: vi.fn().mockResolvedValue([draft]),
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    completeMember: vi.fn(),
    listAllergies: vi.fn().mockResolvedValue([]),
    addCustomAllergy: vi.fn(),
    setProgress: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

const completeAdult = {
  ...draft,
  status: "complete" as const,
  age_band: "adult" as const,
  allergy_status: "none" as const,
  unsupported_diet_status: "none" as const,
};
```

- [ ] **Step 3: 失敗するテストを書く（削除リストの it を消し、以下を追加）**

```ts
it("completes member without setProgress or navigate, then shows next-action screen", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([draft]);
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    membersState.upsert(currentDraft);
    return Promise.resolve(currentDraft);
  });
  const completeMember = vi.fn(() => {
    const completed = {
      ...currentDraft,
      age_band: "adult" as const,
      allergy_status: "none" as const,
      unsupported_diet_status: "none" as const,
      status: "complete" as const,
    };
    membersState.upsert(completed);
    return Promise.resolve(completed);
  });
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    updateDraft,
    completeMember,
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await user.selectOptions(screen.getByLabelText("食べない食事はありますか"), "none");
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了する" }));

  await waitFor(() => {
    expect(
      screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
    ).toBeInTheDocument();
  });
  expect(screen.getByText("1人の設定が完了しています。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "献立を始める" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "続けて家族を追加" })).toBeInTheDocument();
  expect(completeMember).toHaveBeenCalledWith("member-1");
  expect(setProgress).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  // invalidate 後も listMembers は complete を返す
  await waitFor(() => {
    expect(membersState.listMembers.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  expect(screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" })).toBeInTheDocument();
});

it("starts planner from next-action via setProgress complete then onDone", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setProgress).toHaveBeenCalledWith("complete");
});

it("keeps next-action and shows error when setProgress complete fails on primary CTA", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress: vi.fn().mockRejectedValue(new Error("network")),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  expect(
    await screen.findByText("設定を完了できませんでした。通信を確認して再試行してください。"),
  ).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  expect(
    screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
  ).toBeInTheDocument();
});

it("uses 献立を始める as primary CTA when complete members exist without draft", async () => {
  const membersState = createMembersApiState([completeAdult]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByRole("button", { name: "献立を始める" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "続けて家族を追加" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "この家族の設定を完了する" }),
  ).not.toBeInTheDocument();
});
```

残りの既存 it（validation / skip / serial save 等）は **すべて `baseApi({ ... })` に書き換え**、`getProfile` 欠けを無くす。  
完了後に `invalidateHouseholdSafetyDependents` が走る it では `createMembersApiState` を使う。

移行完了条件:

```bash
# ホストで。test 内の API 直書きが 0 件であること（baseApi 経由のみ）
rg -n "const api: HouseholdOnboardingApi" src/features/household/household-onboarding-page.test.tsx
```

Expected: マッチ 0 件（またはコメントのみ）。

- [ ] **Step 4: テストを実行し、失敗を確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: FAIL（次アクション UI 未実装 / getProfile 未配線 等）

- [ ] **Step 5: 最小実装 — profile query・分岐 UI・complete 分離・pending**

`HouseholdOnboardingForm` 本体に追加・変更するコード（要点を**全文**で適用する）:

```ts
const profileQuery = useQuery({
  queryKey: householdKeys.profile(userId),
  queryFn: api.getProfile,
});
const onboardingStatus = profileQuery.data?.onboarding_status;
const canShowSkip =
  onboardingStatus === "not_started" || onboardingStatus === "in_progress";

const nextActionHeadingRef = useRef<HTMLHeadingElement>(null);
const [actionPending, setActionPending] = useState(false);

const finishOnboarding = async (): Promise<void> => {
  setActionPending(true);
  setCompleteError(false);
  try {
    if (onboardingStatus !== "complete") {
      await api.setProgress("complete");
      await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
    }
    dismissToast();
    onDone();
  } catch {
    setCompleteError(true);
  } finally {
    setActionPending(false);
  }
};

const skipOnboarding = async (): Promise<void> => {
  setSkipPending(true);
  setSkipError(false);
  setActionPending(true);
  try {
    await api.setProgress("skipped");
    await queryClient.invalidateQueries({ queryKey: householdKeys.profile(userId) });
    onDone();
  } catch {
    setSkipError(true);
  } finally {
    setSkipPending(false);
    setActionPending(false);
  }
};

const handleCompleteClick = (): void => {
  if (draft === null) return;
  void saveQueue.current.then(async (saved) => {
    if (!saved) {
      setSaveState("failed");
      return;
    }
    const nextErrors = validateOnboardingDraft(draft, allergies.length);
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      const lead = firstOnboardingFieldError(nextErrors);
      showToast({
        message: lead?.message ?? FALLBACK_VALIDATION_TOAST,
        tone: "error",
      });
      focusFirstInvalid(nextErrors);
      return;
    }
    setFieldErrors({});
    dismissToast();
    setActionPending(true);
    let completed: HouseholdMemberRow;
    try {
      completed = await api.completeMember(draft.id);
    } catch {
      setSaveState("failed");
      setActionPending(false);
      return;
    }
    replaceMember(completed);
    try {
      await invalidateHouseholdSafetyDependents(queryClient, userId);
    } finally {
      setActionPending(false);
    }
    // finishOnboarding は呼ばない — 次アクションへ
  });
};

useEffect(() => {
  if (draft !== null || completeMembers.length === 0) return;
  nextActionHeadingRef.current?.focus();
}, [draft, completeMembers.length]);
```

**開始画面（draft null・complete 0）全文:**

```tsx
if (draft === null && completeMembers.length === 0) {
  return (
    <main className="page-frame stack">
      <h1>家族の初回設定</h1>
      <p>年齢のめやす、アレルギー、食べない食事の3項目から始めます。</p>
      <p className="type-small">
        AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。
      </p>
      {startMutation.isError ? (
        <p className="error-message" role="alert">
          家族設定を開始できませんでした。通信を確認して再試行してください。
        </p>
      ) : null}
      <button
        className="primary-button min-h-11"
        type="button"
        disabled={startMutation.isPending || actionPending}
        onClick={() => {
          startMutation.mutate();
        }}
      >
        家族設定を始める
      </button>
      {canShowSkip ? (
        <button
          className="text-button min-h-11"
          type="button"
          disabled={skipPending || actionPending}
          onClick={() => {
            void skipOnboarding();
          }}
        >
          あとで設定する（アイデアから始める）
        </button>
      ) : null}
      {skipError && (
        <p className="error-message" role="alert">
          スキップできませんでした。通信を確認して再試行してください。
        </p>
      )}
    </main>
  );
}
```

**次アクション画面（draft null・complete ≥ 1）全文:**

```tsx
if (draft === null && completeMembers.length > 0) {
  const n = completeMembers.length;
  return (
    <main className="page-frame stack">
      <h1 ref={nextActionHeadingRef} tabIndex={-1}>
        {n === 1 ? "1人目の登録が完了しました" : "登録が完了しました"}
      </h1>
      <p>{n}人の設定が完了しています。</p>
      <p>
        ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。
      </p>
      {startMutation.isError ? (
        <p className="error-message" role="alert">
          家族設定を開始できませんでした。通信を確認して再試行してください。
        </p>
      ) : null}
      <button
        className="primary-button min-h-11"
        type="button"
        disabled={actionPending || profileQuery.isPending}
        onClick={() => {
          void finishOnboarding();
        }}
      >
        献立を始める
      </button>
      <button
        className="secondary-button min-h-11"
        type="button"
        disabled={actionPending || startMutation.isPending || profileQuery.isPending}
        onClick={() => {
          startMutation.mutate();
        }}
      >
        続けて家族を追加
      </button>
      {canShowSkip ? (
        <button
          className="text-button min-h-11"
          type="button"
          disabled={actionPending || skipPending}
          onClick={() => {
            void skipOnboarding();
          }}
        >
          あとで設定する（アイデアから始める）
        </button>
      ) : null}
      {completeError && (
        <p className="error-message" role="alert">
          設定を完了できませんでした。通信を確認して再試行してください。
        </p>
      )}
      {skipError && (
        <p className="error-message" role="alert">
          スキップできませんでした。通信を確認して再試行してください。
        </p>
      )}
    </main>
  );
}
```

**フォーム末尾**の完了・skip:

```tsx
<button
  className="primary-button min-h-11"
  type="button"
  disabled={saveState === "failed" || actionPending}
  onClick={handleCompleteClick}
>
  この家族の設定を完了する
</button>
{canShowSkip ? (
  <button
    className="text-button min-h-11"
    type="button"
    disabled={skipPending || actionPending}
    onClick={() => {
      void skipOnboarding();
    }}
  >
    あとで設定する（アイデアから始める）
  </button>
) : null}
```

members 読込中・エラーの既存分岐は維持。`membersQuery.isPending` のあとに上記 `draft === null` 二分岐を置く。

- [ ] **Step 6: テスト PASS**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: Task 1 追加分 PASS。残り it も `baseApi` 化済みで PASS（callout 未実装 it は Task 2 まで無いので本ファイル全体が PASS すること）。

- [ ] **Step 7: Commit**

```bash
git add src/features/household/household-onboarding-page.tsx src/features/household/household-onboarding-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: 家族オンボーディング完了後に次アクション画面を挟む

1人目 complete で即 setProgress/navigate せず、献立開始と家族追加を選べる。
EOF
)"
```

---

### Task 2: 入力中 callout と skip / 追加 / complete 時 setProgress 省略

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 の次アクション・`canShowSkip`・`createMembersApiState`・`baseApi`
- Produces: `InlineNotice` 分岐、skip 非表示、createDraft 後 callout、complete 時 setProgress 省略

- [ ] **Step 1: 失敗するテストを追加する**

```ts
it("shows first-person callout while editing the initial draft", async () => {
  const membersState = createMembersApiState([draft]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("まずは1人分から登録しましょう")).toBeInTheDocument();
  expect(
    screen.getByText(
      "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。",
    ),
  ).toBeInTheDocument();
});

it("shows continue-callout when drafting after a complete member exists", async () => {
  const secondDraft = { ...draft, id: "member-2", sort_order: 1 };
  const membersState = createMembersApiState([completeAdult, secondDraft]);
  const api = baseApi({ listMembers: membersState.listMembers });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("続けて家族を登録できます")).toBeInTheDocument();
  expect(screen.queryByText("まずは1人分から登録しましょう")).not.toBeInTheDocument();
});

it("hides skip on next-action when profile is already complete", async () => {
  const membersState = createMembersApiState([completeAdult]);
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("complete")),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(
    await screen.findByRole("heading", { level: 1, name: "1人目の登録が完了しました" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).not.toBeInTheDocument();
});

it("shows skip on next-action when profile is in_progress and skips to onDone", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(
    await screen.findByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  );
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setProgress).toHaveBeenCalledWith("skipped");
});

it("adds another member from next-action and shows continue callout", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const createDraft = vi.fn(async () => {
    const created = { ...draft, id: "member-2", sort_order: 1, status: "draft" as const };
    membersState.upsert(created);
    return created;
  });
  const api = baseApi({
    listMembers: membersState.listMembers,
    createDraft,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  await user.click(await screen.findByRole("button", { name: "続けて家族を追加" }));
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalled();
  });
  expect(await screen.findByText("続けて家族を登録できます")).toBeInTheDocument();
});

it("omits setProgress when starting planner while profile is already complete", async () => {
  const user = userEvent.setup();
  const membersState = createMembersApiState([completeAdult]);
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: membersState.listMembers,
    getProfile: vi.fn().mockResolvedValue(mockProfile("complete")),
    setProgress,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={onDone} />, client);

  await user.click(await screen.findByRole("button", { name: "献立を始める" }));
  await waitFor(() => {
    expect(onDone).toHaveBeenCalledOnce();
  });
  expect(setProgress).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: RED 確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: callout 系 FAIL

- [ ] **Step 3: callout 実装**

```ts
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";
```

draft フォームヘッダ（`eyebrow` / `h1` の直後、進捗の前）:

```tsx
<p className="eyebrow">家族設定（任意）</p>
<h1>家族の初回設定</h1>
<InlineNotice
  tone="notice"
  title={
    completeMembers.length === 0
      ? "まずは1人分から登録しましょう"
      : "続けて家族を登録できます"
  }
>
  {completeMembers.length === 0
    ? "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。"
    : "何人でも登録できます。登録が終わったら「献立を始める」で先に進めます。あとから設定の「家族設定」でも追加・編集できます。"}
</InlineNotice>
<p>設定済み項目 {completedRequired} / 3</p>
```

`role="status"` を付けない（`InlineNotice` が `role="note"`）。

Task 1 の `finishOnboarding` が既に `onboardingStatus !== "complete"` 分岐を持っていれば本 Step の実装追加は callout のみ。分岐が無ければ Task 1 の `finishOnboarding` 全文を再適用する。

- [ ] **Step 4: GREEN**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: PASS（ファイル全体）

- [ ] **Step 5: typecheck / lint / format:check**

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/features/household/household-onboarding-page.tsx src/features/household/household-onboarding-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: 家族オンボーディングに callout と profile 分岐 skip を追加

1人目/2人目以降の案内と complete 再訪時の skip 非表示を固定する。
EOF
)"
```

---

### Task 3: E2E を次アクション経由に更新する

**Files:**
- Modify: `e2e/specs/onboarding.spec.ts`

**Interfaces:**
- Consumes: Task 1–2 の UI 文言
- Produces: CI が次アクション経由を検証

- [ ] **Step 1: E2E 全文置換**

`e2e/specs/onboarding.spec.ts`:

```ts
import { expect, test } from "../fixtures/auth";

test("resumes a partially saved member, shows next-action after complete, then reaches /planner without privacy consent", async ({
  authenticatedPage: page,
}) => {
  // 新規利用者はログイン直後に/welcomeへ着地する。
  // 家族導線を選んでから/onboardingへ進む。
  await page.getByRole("button", { name: "家族情報を登録する" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/onboarding");
  await page.getByRole("button", { name: "家族設定を始める" }).click();
  await page.getByLabel("年齢のめやす").selectOption("adult");
  await expect(page.getByText("保存済み")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("年齢のめやす")).toHaveValue("adult");
  await page.getByLabel("アレルギーの確認").selectOption("none");
  await page.getByLabel("食べない食事はありますか").selectOption("none");

  await expect(page.getByText("まずは1人分から登録しましょう")).toBeVisible();

  await page.getByRole("button", { name: "この家族の設定を完了する" }).click();

  // 次アクション: まだ planner に行かない
  await expect(page).toHaveURL((url) => url.pathname === "/onboarding");
  await expect(page.getByRole("heading", { name: "1人目の登録が完了しました" })).toBeVisible();
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を始める" })).toBeVisible();
  await expect(page.getByRole("button", { name: "続けて家族を追加" })).toBeVisible();

  await page.getByRole("button", { name: "献立を始める" }).click();

  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  await page.goto("/privacy?returnTo=%2Fplanner");
  await expect(page.getByRole("button", { name: "確認して進む" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // complete 再訪: 人数行 + skip 非表示
  await page.goto("/onboarding");
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).toHaveCount(0);
});
```

- [ ] **Step 2: E2E 実行（コマンド固定）**

```bash
./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts
```

Expected: PASS（`run-e2e.sh` は引数を playwright test に渡す）。

- [ ] **Step 3: 最終 focused 検証**

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

```bash
git diff --check
```

Expected: すべて成功

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/onboarding.spec.ts
git commit -m "$(cat <<'EOF'
test: 家族オンボーディング E2E を次アクション経由に更新する

完了直後の planner 直遷移前提をやめ、献立を始めるまでの導線を固定する。
EOF
)"
```

---

## Spec coverage (self-review)

| 設計 | Task |
|------|------|
| §5.1 callout 分岐・InlineNotice | Task 2 |
| §5.2 次アクション・人数行・3 CTA | Task 1 |
| §5.2 skip 条件 | Task 1–2 |
| §5.2 complete 時 setProgress 省略 | Task 1 finish + Task 2 テスト |
| §5.2 focus / pending（complete 含む） | Task 1 |
| §5.3 complete 後 setProgress しない | Task 1 |
| §4.4 getProfile | Task 1 |
| §7.1 単体 + stateful | Task 1–2 |
| §7.2 E2E | Task 3 |
| invalidate safety 維持 | Task 1（外さない） |
| DB/API 非変更 | 全 Task |

## Placeholder / type consistency check (r1)

- `// ...` 無し。
- 主 CTA は「献立を始める」のみ。
- `getProfile` / `createMembersApiState` / `baseApi` が一貫。
- E2E コマンドは `./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts` のみ。
