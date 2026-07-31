# 初回家族設定: 複数登録アテンション強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/onboarding` で1人目完了後に即 `/planner` へ飛ばさず、見逃しにくい callout と次アクション（献立を始める / 続けて家族を追加 / 条件付き skip）を出し、複数登録できることを伝える。

**Architecture:** `HouseholdOnboardingForm` 内で `completeMember` と `setProgress("complete")` を分離する。次アクション条件は `draft === null && completeMembers.length > 0`。CTA 分岐のため既存 `getProfile` + `householdKeys.profile` を読む（RPC 変更なし）。静的案内は `InlineNotice`。

**Tech Stack:** React 19 / TanStack Query 5 / TypeScript strict / Vitest / RTL / Playwright E2E

**仕様書:** `docs/superpowers/specs/2026-07-31-onboarding-multi-member-attention-design.md`（敵対的レビュー反映済み）  
**敵対的レビュー:** `docs/reviews/2026-07-31-onboarding-multi-member-attention-design-adversarial.md`

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

## Locked interfaces produced by this plan

| 名前 | 場所 | 契約 |
|------|------|------|
| `HouseholdOnboardingApi.getProfile` | `household-onboarding-page.tsx` | `() => Promise<ProfileRow>`。テスト注入必須 |
| `createHouseholdApi` | 同 | `getProfile: () => getProfile(client, userId)` を追加 |
| 次アクション条件 | 同 | `draft === null && completeMembers.length > 0` |
| skip 表示 | 同 | `onboarding_status === "not_started" \|\| === "in_progress"` のみ。未取得・error は非表示 |
| 主 CTA ラベル | 同 | **常に** `献立を始める`（再訪でも同じ。設計の「献立に戻る」は採用しない） |
| 主 CTA 動作 | 同 | status が `complete` なら `setProgress` 省略して `onDone()` のみ。それ以外は `setProgress("complete")` 成功後 `onDone()` |
| 副 CTA | 同 | `続けて家族を追加` → `startMutation` / `createDraft(members.length)` |
| callout | 同 | `InlineNotice` `tone="notice"`。文言は §5.1 固定 |
| 人数行 | 同 | 常に `` `${n}人の設定が完了しています。` `` |
| focus | 同 | 次アクション `h1` に `tabIndex={-1}` + mount/切替時 `focus()` |
| pending | 同 | `actionPending`（complete/skip/start のいずれか）中は次アクションとフォームの全関連 CTA を disable |

### 固定 copy（転記禁止のゆれを防ぐ）

```ts
// 1人目 callout
const CALLOUT_FIRST_TITLE = "まずは1人分から登録しましょう";
const CALLOUT_FIRST_BODY =
  "家族が複数いる場合も、最初は1人で十分です。追加の家族は、このあとや設定画面からいつでも登録できます。";

// 2人目以降 callout
const CALLOUT_MORE_TITLE = "続けて家族を登録できます";
const CALLOUT_MORE_BODY =
  "何人でも登録できます。登録が終わったら「献立を始める」で先に進めます。あとから設定の「家族設定」でも追加・編集できます。";

// 次アクション
// h1: n===1 ? "1人目の登録が完了しました" : "登録が完了しました"
// body: "ほかの家族も続けて登録できます。あとから設定の「家族設定」でも追加できます。"
// primary: "献立を始める"
// secondary: "続けて家族を追加"
// skip: "あとで設定する（アイデアから始める）"
```

## File Structure

| ファイル | 責務 |
|----------|------|
| `src/features/household/household-onboarding-page.tsx` | profile 読取、callout、次アクション UI、complete/setProgress 分離、focus、pending |
| `src/features/household/household-onboarding-page.test.tsx` | 設計 §7.1 の置換表・必須ケース |
| `e2e/specs/onboarding.spec.ts` | 次アクション経由で planner（必須） |
| 触らない | `household-settings-page.*`、welcome、RPC、migrations |

---

### Task 1: complete 後は navigate せず次アクションへ（コアフロー）

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`
- Test: 同 test ファイル

**Interfaces:**
- Consumes: 既存 `HouseholdOnboardingApi`（本 Task で `getProfile` を追加）
- Produces: `getProfile` on API; completeMember 成功後に次アクション UI; 主 CTA「献立を始める」

- [ ] **Step 1: `HouseholdOnboardingApi` に `getProfile` を足し、テスト用ヘルパを用意する**

`household-onboarding-page.tsx` の interface と factory を拡張:

```ts
import type { ProfileRow } from "./household-api";
import { getProfile /* 既存 import 群に追加 */ } from "./household-api";

export interface HouseholdOnboardingApi {
  listMembers: () => Promise<HouseholdMemberRow[]>;
  getProfile: () => Promise<ProfileRow>;
  createDraft: (sortOrder: number) => Promise<HouseholdMemberRow>;
  // ...既存のまま
  setProgress: (status: "in_progress" | "complete" | "skipped") => Promise<unknown>;
}

function createHouseholdApi(userId: string): HouseholdOnboardingApi {
  const client = getBrowserSupabaseClient();
  return {
    listMembers: () => listHouseholdMembers(client, userId),
    getProfile: () => getProfile(client, userId),
    // ...既存
  };
}
```

テスト側に共通 mock を追加（`household-onboarding-page.test.tsx` 先頭付近）:

```ts
import type { ProfileRow } from "./household-api";

function mockProfile(status: string): ProfileRow {
  // profiles.Row は user_id / onboarding_status / onboarding_completed_at / created_at / updated_at のみ
  return {
    user_id: "user-1",
    onboarding_status: status,
    onboarding_completed_at:
      status === "complete" || status === "skipped" ? "2026-07-11T00:00:00.000Z" : null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
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
```

`ProfileRow` の必須フィールドが `as ProfileRow` で足りない場合は、生成型に合わせてフィールドを足す（`database.generated.ts` の `profiles.Row` を読む）。

- [ ] **Step 2: 失敗するテストを書く（旧 happy path を置換）**

既存の  
`resumes one draft, saves each required selection, and completes through completeMember->setProgress->navigate`  
を次に**置き換える**（削除して新規）:

```ts
it("completes member without setProgress or navigate, then shows next-action screen", async () => {
  const user = userEvent.setup();
  let currentDraft = draft;
  const updateDraft = vi.fn((_memberId: string, patch: HouseholdDraftPatch) => {
    currentDraft = { ...currentDraft, ...patch };
    return Promise.resolve(currentDraft);
  });
  const completeMember = vi.fn(() =>
    Promise.resolve({
      ...currentDraft,
      age_band: "adult" as const,
      allergy_status: "none" as const,
      unsupported_diet_status: "none" as const,
      status: "complete" as const,
    }),
  );
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([draft]),
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
});

it("starts planner from next-action via setProgress complete then onDone", async () => {
  const user = userEvent.setup();
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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
```

既存の  
`completes onboarding through setProgress->navigate when a complete member already exists and no draft is open`  
はボタン名が旧「この家族の設定を完了する」のため、上記2本目に置き換える（重複削除）。

既存の  
`stays on the page and shows a retryable error when setProgress fails after completeMember succeeds`  
は削除し、代わりに（本 Task または Task 3 で）:

```ts
it("keeps next-action and shows error when setProgress complete fails on primary CTA", async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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
  expect(screen.getByRole("heading", { level: 1, name: "1人目の登録が完了しました" })).toBeInTheDocument();
});
```

既存の  
`stays on the page with a retryable error when setProgress fails for an already-complete member`  
も主 CTA 名を「献立を始める」に合わせて更新する。

**すべての** `HouseholdOnboardingApi` リテラルに `getProfile: vi.fn().mockResolvedValue(mockProfile("in_progress"))` を足す（コンパイルを通す）。一括で `baseApi` 経由に寄せてよい。

- [ ] **Step 3: テストを実行し、失敗を確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: FAIL（次アクション見出しが無い / 旧テストがまだ complete→navigate を期待 / `getProfile` 不足 など）

- [ ] **Step 4: 最小実装 — profile query・次アクション分岐・complete 分離**

`HouseholdOnboardingForm` 内:

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

// completeMember 成功後は finishOnboarding を呼ばない
const handleCompleteClick = (): void => {
  // ... validation / completeMember 既存どおり
  // 成功後:
  replaceMember(completed);
  await invalidateHouseholdSafetyDependents(queryClient, userId);
  // finishOnboarding() を削除
};

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
```

`draft === null` 分岐を分割:

```tsx
if (draft === null && completeMembers.length === 0) {
  // 既存の「家族設定を始める」+ skip（canShowSkip のときだけ）
}

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

focus effect（次アクション表示時）:

```ts
useEffect(() => {
  if (draft !== null || completeMembers.length === 0) return;
  nextActionHeadingRef.current?.focus();
}, [draft, completeMembers.length]);
```

フォーム末尾の skip も `canShowSkip` で囲む。開始画面（member 0）の skip も同様。

- [ ] **Step 5: テストを実行し、Task 1 分が通ることを確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: 本 Task で追加・置換したケースが PASS。未更新の旧ケースが残っていれば FAIL → すべて `getProfile` 付きに直し、旧 complete→navigate 期待を消す。

- [ ] **Step 6: Commit**

```bash
git add src/features/household/household-onboarding-page.tsx src/features/household/household-onboarding-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: 家族オンボーディング完了後に次アクション画面を挟む

1人目 complete で即 setProgress/navigate せず、献立開始と家族追加を選べる。
EOF
)"
```

---

### Task 2: 入力中 callout（1人目 / 2人目以降）と skip 分岐テスト

**Files:**
- Modify: `src/features/household/household-onboarding-page.tsx`
- Modify: `src/features/household/household-onboarding-page.test.tsx`

**Interfaces:**
- Consumes: Task 1 の次アクション・`canShowSkip`・`getProfile`
- Produces: draft フォーム先頭の `InlineNotice` 分岐 copy

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("shows first-person callout while editing the initial draft", async () => {
  const api = baseApi({ listMembers: vi.fn().mockResolvedValue([draft]) });
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
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
      secondDraft,
    ]),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderOnboarding(<HouseholdOnboardingForm userId="user-1" api={api} onDone={vi.fn()} />, client);

  expect(await screen.findByText("続けて家族を登録できます")).toBeInTheDocument();
  expect(screen.queryByText("まずは1人分から登録しましょう")).not.toBeInTheDocument();
});

it("hides skip on next-action when profile is already complete", async () => {
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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
  const createDraft = vi.fn().mockResolvedValue({ ...draft, id: "member-2", sort_order: 1 });
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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
  const setProgress = vi.fn().mockResolvedValue({});
  const onDone = vi.fn();
  const api = baseApi({
    listMembers: vi.fn().mockResolvedValue([
      {
        ...draft,
        status: "complete" as const,
        age_band: "adult" as const,
        allergy_status: "none" as const,
        unsupported_diet_status: "none" as const,
      },
    ]),
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

- [ ] **Step 2: テストを実行し、失敗を確認する**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: callout / skip 非表示 / createDraft 後 callout などが FAIL

- [ ] **Step 3: callout 実装**

```ts
import { InlineNotice } from "@/shared/ui/wizard/inline-notice";
```

draft フォームの `h1` 直後（進捗の前）:

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

`role="status"` を自分で付けない（`InlineNotice` の `role="note"` を使う）。

- [ ] **Step 4: テスト PASS を確認**

Run:

```bash
docker compose run --rm --no-deps app npm test -- --run src/features/household/household-onboarding-page.test.tsx
```

Expected: PASS（本ファイル全体）

- [ ] **Step 5: typecheck / lint / format:check**

Run（各コマンド独立）:

```bash
docker compose run --rm --no-deps app npm run typecheck
```

```bash
docker compose run --rm --no-deps app npm run lint
```

```bash
docker compose run --rm --no-deps app npm run format:check
```

Expected: いずれも exit 0

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
- Consumes: Task 1–2 の UI 文言・ボタン名
- Produces: CI が次アクション経由の完了フローを検証

- [ ] **Step 1: E2E を設計 §7.2 どおりに書き換える**

`e2e/specs/onboarding.spec.ts` を次の内容に置き換える（テスト名も更新）:

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

  // 入力中 callout（1人目）
  await expect(page.getByText("まずは1人分から登録しましょう")).toBeVisible();

  await page.getByRole("button", { name: "この家族の設定を完了する" }).click();

  // 次アクション: まだ planner に行かない
  await expect(page).toHaveURL((url) => url.pathname === "/onboarding");
  await expect(page.getByRole("heading", { name: "1人目の登録が完了しました" })).toBeVisible();
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(page.getByRole("button", { name: "献立を始める" })).toBeVisible();
  await expect(page.getByRole("button", { name: "続けて家族を追加" })).toBeVisible();

  await page.getByRole("button", { name: "献立を始める" }).click();

  // 家族設定完了はAI利用同意を一切経由せず/plannerへ遷移する。
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // /privacyを独立して開いて同意を保存する。
  await page.goto("/privacy?returnTo=%2Fplanner");
  await expect(page.getByRole("button", { name: "確認して進む" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /説明を確認しました/u }).check();
  await page.getByRole("button", { name: "確認して進む" }).click();
  await expect(page).toHaveURL(/\/planner$/u);
  await expect(page.getByRole("navigation", { name: "メインメニュー" })).toBeVisible();

  // /onboardingへ戻っても complete のまま。次アクション相当 + skip 非表示。
  await page.goto("/onboarding");
  await expect(page.getByText("1人の設定が完了しています。")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "あとで設定する（アイデアから始める）" }),
  ).toHaveCount(0);
});
```

- [ ] **Step 2: E2E を実行する**

ホストで（`app` コンテナ内の `npm run e2e` は使わない）:

```bash
./scripts/run-e2e.sh e2e/specs/onboarding.spec.ts
```

スクリプトが引数を受け取らない場合はプロジェクトの README / `scripts/run-e2e.sh` を読み、onboarding だけに絞れるなら絞る。無理ならフル e2e のうち onboarding 失敗有無を確認。

Expected: PASS

失敗時: 文言・タイミング（保存済み待ち）をログで確認し、実装またはセレクタを直す。`getByLabel` が複数ある場合は既存どおりのラベルを維持。

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
| §5.1 callout 分岐・InlineNotice・status 禁止 | Task 2 |
| §5.2 次アクション見出し・人数行・本文・3 CTA | Task 1 |
| §5.2 skip 条件・complete で非表示 | Task 1–2 |
| §5.2 主 CTA complete 時 setProgress 省略 | Task 2 テスト + Task 1 finishOnboarding |
| §5.2 focus h1 | Task 1 |
| §5.2 pending disable | Task 1 `actionPending` |
| §5.3 complete 後 setProgress しない | Task 1 |
| §4.2 中間状態（コードは分離のみ、welcome 非変更） | Task 1（意図どおり） |
| §4.4 getProfile | Task 1 |
| §7.1 単体 | Task 1–2 |
| §7.2 E2E 必須 | Task 3 |
| 設定ディープリンク非対象 | 全 Task で Link を追加しない |
| DB/API 非変更 | 全 Task |

## Placeholder / type consistency check

- 主 CTA ラベルは **「献立を始める」に固定**（設計の「献立に戻る」任意は不採用）。
- `getProfile` は API と factory と全テスト mock で一致。
- `canShowSkip` は `not_started | in_progress` のみ。
- コマンドは `&&` 連結なしで記載。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-31-onboarding-multi-member-attention.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — タスクごとに新しい subagent、間にレビュー
2. **Inline Execution** — このセッションで executing-plans に沿って逐次実装

どちらで進めますか？
