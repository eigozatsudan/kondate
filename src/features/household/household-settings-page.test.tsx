import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { AppToastProvider } from "@/shared/ui/app-toast";
import type {
  AllergenCatalogRow,
  HouseholdMemberPatch,
  HouseholdMemberRow,
  MemberAllergyRow,
  MemberDislikeRow,
} from "./household-api";
import { HouseholdMemberVersionConflictError } from "./household-api";
import { householdKeys } from "./household-queries";
import { HouseholdSettingsForm, type HouseholdSettingsApi } from "./household-settings-page";
import {
  UNSUPPORTED_DIET_EMPTY_ADD_HELP,
  UNSUPPORTED_DIET_KIND_LABELS,
  UNSUPPORTED_DIET_KINDS_REQUIRED,
  UNSUPPORTED_DIET_PRESENT_HELP,
  UNSUPPORTED_DIET_STATUS_HELP,
} from "./unsupported-diet-copy";

const navigateMock = vi.hoisted(() => vi.fn());
const clearLocalAuthAndDraftsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const requireAccessTokenMock = vi.hoisted(() => vi.fn().mockResolvedValue("token"));
const useAuthMock = vi.hoisted(() => vi.fn());

const emptySearchParams = new URLSearchParams();
const setSearchParamsMock = vi.hoisted(() => vi.fn());

// AccountSettingsSection が依存するナビ・掃除・トークン境界だけをモックし、家族 CRUD テストを壊さない
vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return {
    ...original,
    useNavigate: () => navigateMock,
    // Router 無し unit でも ?billing= を読めるように空 params を返す（参照安定）
    useSearchParams: () => [emptySearchParams, setSearchParamsMock],
  };
});
vi.mock("@/features/auth/auth-cleanup", () => ({
  clearLocalAuthAndDrafts: clearLocalAuthAndDraftsMock,
  // AccountSettingsSection が re-export 参照する定数（部分 mock でも export を満たす）
  SIGN_OUT_TIMEOUT_MS: 4_000,
}));
vi.mock("@/features/auth/session", () => ({
  requireAccessToken: requireAccessTokenMock,
}));
// FeedbackSection が useAuth を要求する。家族 CRUD は AuthProvider に依存させない。
vi.mock("@/features/auth/use-auth", () => ({
  useAuth: useAuthMock,
}));
vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({ auth: {} }),
}));
// プラン UI は billing 専用テストで検証。家族 CRUD は entitlement API に依存させない。
vi.mock("@/features/billing/plan-settings-section", () => ({
  PlanSettingsSection: () => <section aria-label="プラン">プラン</section>,
}));
// 共有同意 UI は privacy 専用テストで検証。家族 CRUD は share RPC に依存させない。
vi.mock("@/features/privacy/share-consent-settings-section", () => ({
  ShareConsentSettingsSection: () => (
    <section aria-label="匿名の緊急候補への協力">共有設定</section>
  ),
}));

beforeEach(() => {
  navigateMock.mockReset();
  clearLocalAuthAndDraftsMock.mockReset();
  requireAccessTokenMock.mockReset();
  useAuthMock.mockReset();
  clearLocalAuthAndDraftsMock.mockResolvedValue(undefined);
  requireAccessTokenMock.mockResolvedValue("token");
  useAuthMock.mockReturnValue({
    status: "authenticated",
    session: { user: { id: "user-1" }, access_token: "token" },
    refreshSession: vi.fn(),
    sessionProbeDegraded: false,
  });
  if (typeof HTMLDialogElement !== "undefined") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

const member: HouseholdMemberRow = {
  id: "member-1",
  user_id: "user-1",
  status: "complete",
  display_name: "大人",
  age_band: "adult",
  portion_size: "regular",
  spice_level: "regular",
  ease_preferences: [],
  required_safety_constraints: [],
  allergy_status: "none",
  unsupported_diet_status: "none",
  unsupported_diet_kinds: [],
  sort_order: 0,
  created_at: "2026-07-11T00:00:00.000Z",
  updated_at: "2026-07-11T00:00:00.000Z",
};

const catalog: AllergenCatalogRow[] = [
  {
    id: "walnut",
    display_name: "くるみ",
    regulatory_class: "standard",
    catalog_version: "2026-07-11",
    created_at: "2026-07-11T00:00:00.000Z",
  },
];

const standardAllergy: MemberAllergyRow = {
  id: "allergy-1",
  user_id: "user-1",
  member_id: "member-1",
  allergen_id: "walnut",
  custom_name: null,
  custom_aliases: [],
  custom_confirmed: false,
  created_at: "2026-07-11T00:00:00.000Z",
};
const walnutAllergy = standardAllergy;

/**
 * 設定画面を描画する。
 * 製品の初期表示は編集を閉じるが、操作系テストの大半はフォーム前提のため、
 * メンバーがあるときは先頭の「編集」を自動で開く（startClosed: true で閉じたまま）。
 */
async function renderSettings(
  overrides: Partial<HouseholdSettingsApi> = {},
  options: { startClosed?: boolean } = {},
) {
  const updateMember = vi.fn().mockResolvedValue(member);
  const invalidateSafety = vi.fn().mockResolvedValue(undefined);
  const api: HouseholdSettingsApi = {
    listMembers: vi.fn().mockResolvedValue([member]),
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockResolvedValue(member),
    updateMember,
    completeMember: vi.fn().mockResolvedValue(member),
    deleteMember: vi.fn().mockResolvedValue(undefined),
    listCatalog: vi.fn().mockResolvedValue(catalog),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy: vi.fn(),
    addCustomAllergy: vi.fn(),
    removeAllergy: vi.fn(),
    listDislikes: vi.fn().mockResolvedValue([]),
    addDislike: vi.fn(),
    removeDislike: vi.fn(),
    invalidateSafety,
    ...overrides,
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <HouseholdSettingsForm api={api} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  if (!options.startClosed) {
    await screen.findByRole("heading", { name: "登録済みの家族" });
    const editButtons = screen.queryAllByRole("button", { name: /を編集$/u });
    if (editButtons[0] !== undefined) {
      await userEvent.click(editButtons[0]);
      await screen.findByRole("region", { name: "家族情報を追加・編集" });
    }
  }
  return { api, queryClient, updateMember, invalidateSafety };
}

async function waitForAllergies(queryClient: QueryClient, memberId = "member-1") {
  await waitFor(() => {
    expect(
      queryClient.getQueryState(["household", "allergies", "settings", memberId])?.status,
    ).toBe("success");
  });
}

/** 追加前確認ダイアログで「登録を続ける」を押す（createDraft は OK 後のみ） */
async function confirmAddScopeNotice() {
  await userEvent.click(screen.getByRole("button", { name: "登録を続ける" }));
}

const unsupportedDietStatusLabel = /このアプリで献立を作れない事情はありますか/u;

it("登録済み一覧と追加・編集領域を分け、同名・未設定でも一覧から一意に選べる", async () => {
  const second: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    status: "draft",
    display_name: null,
    age_band: "age_3_5",
    sort_order: 1,
  };
  const third: HouseholdMemberRow = {
    ...second,
    id: "member-3",
    sort_order: 2,
  };
  await renderSettings(
    { listMembers: vi.fn().mockResolvedValue([member, second, third]) },
    { startClosed: true },
  );

  expect(await screen.findByRole("heading", { name: "登録済みの家族" })).toBeVisible();
  // 登録済みがある初期表示は一覧のみ。編集領域は自動で開かない。
  expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
  expect(screen.getByText("大人", { selector: ".household-member-name" })).toBeVisible();
  expect(screen.getByText(/登録完了/u)).toBeVisible();
  expect(screen.getAllByText("名前未設定", { selector: ".household-member-name" })).toHaveLength(2);
  expect(screen.getAllByText(/3〜5歳/u)[0]).toBeVisible();
  expect(screen.getAllByText(/入力途中/u)).toHaveLength(2);
  // 一覧の各行に編集と削除が並ぶ
  expect(screen.getByRole("button", { name: "1人目の大人を削除" })).toBeVisible();
  expect(screen.getByRole("button", { name: "2人目の名前未設定を削除" })).toBeVisible();

  const secondButton = screen.getByRole("button", { name: "2人目の名前未設定を編集" });
  expect(screen.getByRole("button", { name: "3人目の名前未設定を編集" })).toBeVisible();
  await userEvent.click(secondButton);
  const editor = screen.getByRole("region", { name: "家族情報を追加・編集" });
  expect(editor).toBeVisible();
  expect(editor).toContainElement(screen.getByLabelText("呼び名"));
  // 末尾操作は横並び: 完了 / 追加をやめる。編集中は「家族を追加」を出さない。
  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  const cancelAddButton = screen.getByRole("button", { name: "追加をやめる" });
  expect(editor).toContainElement(completeButton);
  expect(editor).toContainElement(cancelAddButton);
  expect(completeButton.parentElement).toHaveClass("household-editor-actions");
  expect(completeButton.parentElement).toContainElement(cancelAddButton);
  expect(screen.queryByRole("button", { name: "家族を追加" })).not.toBeInTheDocument();
  const editorHeading = screen.getByRole("heading", { name: "「名前未設定」を編集中" });
  expect(editorHeading).toBeVisible();
  expect(editorHeading).toHaveFocus();
  expect(screen.getByLabelText("呼び名")).toHaveValue("");
});

it("closes the editor after a successful complete-member save and reopens it from the list", async () => {
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ updateMember });

  await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("status")).toHaveTextContent("家族設定が変わりました");
  expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
  expect(screen.getByRole("button", { name: "ログアウト" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
  expect(screen.getByLabelText("呼び名")).toHaveValue("大人");
});

it("keeps the editor open when completing the member fails", async () => {
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定を保存できませんでした"));
  await renderSettings({ updateMember });

  await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));

  expect(await screen.findByRole("status")).toHaveTextContent("家族設定を保存できませんでした");
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
});

it.each(["complete", "draft"] as const)(
  "locks %s member mutations and navigation until completion settles",
  async (status) => {
    const target = { ...member, status };
    const secondMember: HouseholdMemberRow = {
      ...member,
      id: "member-2",
      display_name: "子ども",
      sort_order: 1,
    };
    let resolveSave: ((saved: HouseholdMemberRow) => void) | undefined;
    const updateMember = vi.fn(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const updateDraft = vi.fn(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveSave = resolve;
        }),
    );
    let resolveComplete: ((saved: HouseholdMemberRow) => void) | undefined;
    const completeMember = vi.fn(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveComplete = resolve;
        }),
    );
    const createDraft = vi.fn();
    await renderSettings({
      listMembers: vi.fn().mockResolvedValue([target, secondMember]),
      updateMember,
      updateDraft,
      completeMember,
      createDraft,
    });

    await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));
    const saveApi = status === "draft" ? updateDraft : updateMember;
    await waitFor(() => {
      expect(saveApi).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByLabelText("呼び名")).toBeDisabled();
    expect(screen.getByLabelText("年齢のめやす")).toBeDisabled();
    expect(screen.getByLabelText("骨を除く")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "変更後" } });
    fireEvent.change(screen.getByLabelText("年齢のめやす"), { target: { value: "senior" } });
    fireEvent.click(screen.getByLabelText("骨を除く"));
    fireEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
    // 編集中は「家族を追加」非表示（完了ロック中の誤追加経路を塞ぐ）
    expect(screen.queryByRole("button", { name: "家族を追加" })).not.toBeInTheDocument();

    expect(saveApi).toHaveBeenCalledTimes(1);
    expect(createDraft).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "「大人」を編集中" })).toBeVisible();

    await act(async () => {
      resolveSave?.(target);
      await Promise.resolve();
      await Promise.resolve();
    });

    if (status === "draft") {
      await waitFor(() => {
        expect(completeMember).toHaveBeenCalledWith(target.id);
      });
      expect(screen.getByLabelText("呼び名")).toBeDisabled();
      fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "さらに変更" } });
      expect(updateDraft).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveComplete?.({ ...target, status: "complete" });
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "家族情報を追加・編集" }),
      ).not.toBeInTheDocument();
    });
  },
);

it("does not start completion while an allergy addition is pending", async () => {
  const existingCustomAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "マンゴー",
    custom_confirmed: true,
  };
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const addStandardAllergy = vi.fn(() => new Promise<MemberAllergyRow>(() => undefined));
  const updateMember = vi.fn().mockResolvedValue(registeredMember);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn().mockResolvedValue([existingCustomAllergy]),
    addStandardAllergy,
    updateMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledTimes(1);
  });

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(completeButton).toBeDisabled();
  fireEvent.click(completeButton);
  expect(updateMember).not.toHaveBeenCalled();
});

it("does not start completion while the last draft allergy deletion is pending", async () => {
  const draft = {
    ...member,
    id: "draft-1",
    status: "draft" as const,
    allergy_status: "registered" as const,
  };
  const removeAllergy = vi.fn(() => new Promise<void>(() => undefined));
  const updateDraft = vi.fn().mockResolvedValue(draft);
  const completeMember = vi.fn().mockResolvedValue({ ...draft, status: "complete" as const });
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([draft]),
    listAllergies: vi.fn().mockResolvedValue([{ ...standardAllergy, member_id: draft.id }]),
    removeAllergy,
    updateDraft,
    completeMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));
  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledTimes(1);
  });

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(completeButton).toBeDisabled();
  fireEvent.click(completeButton);
  expect(updateDraft).not.toHaveBeenCalled();
  expect(completeMember).not.toHaveBeenCalled();
});

it("does not start completion while adding a dislike is pending", async () => {
  const addDislike = vi.fn(() => new Promise<MemberDislikeRow>(() => undefined));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ addDislike, updateMember });

  await userEvent.type(await screen.findByLabelText("苦手食材を追加"), "ピーマン");
  await userEvent.click(screen.getByRole("button", { name: "苦手食材を追加" }));
  expect(addDislike).toHaveBeenCalledWith(member.id, "ピーマン");

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(completeButton).toBeDisabled();
  await userEvent.click(completeButton);

  expect(updateMember).not.toHaveBeenCalled();
});

it("does not start completion while removing a dislike is pending", async () => {
  const dislike: MemberDislikeRow = {
    id: "dislike-1",
    user_id: "user-1",
    member_id: member.id,
    ingredient_name: "ピーマン",
    created_at: "2026-07-11T00:00:00.000Z",
  };
  const removeDislike = vi.fn(() => new Promise<void>(() => undefined));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({
    listDislikes: vi.fn().mockResolvedValue([dislike]),
    removeDislike,
    updateMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "削除" }));
  expect(removeDislike).toHaveBeenCalledWith(dislike.id);

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(completeButton).toBeDisabled();
  await userEvent.click(completeButton);

  expect(updateMember).not.toHaveBeenCalled();
});

it("keeps the editor open and reports a failed dislike addition", async () => {
  const addDislike = vi.fn().mockRejectedValue(new Error("苦手食材を追加できませんでした"));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ addDislike, updateMember });

  await userEvent.type(await screen.findByLabelText("苦手食材を追加"), "ピーマン");
  await userEvent.click(screen.getByRole("button", { name: "苦手食材を追加" }));

  expect(await screen.findByRole("status")).toHaveTextContent("苦手食材を追加できませんでした");
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
  expect(screen.getByLabelText("苦手食材を追加")).toHaveValue("ピーマン");
  expect(updateMember).not.toHaveBeenCalled();
});

it("keeps the editor open and reports a failed dislike deletion", async () => {
  const dislike: MemberDislikeRow = {
    id: "dislike-1",
    user_id: "user-1",
    member_id: member.id,
    ingredient_name: "ピーマン",
    created_at: "2026-07-11T00:00:00.000Z",
  };
  const removeDislike = vi.fn().mockRejectedValue(new Error("苦手食材を削除できませんでした"));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({
    listDislikes: vi.fn().mockResolvedValue([dislike]),
    removeDislike,
    updateMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "削除" }));

  expect(await screen.findByRole("status")).toHaveTextContent("苦手食材を削除できませんでした");
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
  expect(screen.getByText("ピーマン")).toBeVisible();
  expect(updateMember).not.toHaveBeenCalled();
});

it("does not start completion while deleting the selected member", async () => {
  const deleteMember = vi.fn(() => new Promise<void>(() => undefined));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ deleteMember, updateMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));
  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledTimes(1);
  });

  const completeButton = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(completeButton).toBeDisabled();
  fireEvent.click(completeButton);
  expect(updateMember).not.toHaveBeenCalled();
});

it("does not start completion while creating another draft", async () => {
  const createDraft = vi.fn(() => new Promise<HouseholdMemberRow>(() => undefined));
  const updateMember = vi.fn().mockResolvedValue(member);
  // 一覧から追加する（編集中は「家族を追加」非表示）
  await renderSettings({ createDraft, updateMember }, { startClosed: true });

  const addButton = await screen.findByRole("button", { name: /^家族を追加$/u });
  await userEvent.click(addButton);
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  // 作成中は一覧の追加ボタンを二重押しできない
  expect(addButton).toBeDisabled();
  expect(screen.queryByRole("button", { name: "この家族の設定を完了" })).not.toBeInTheDocument();
  expect(updateMember).not.toHaveBeenCalled();
});

it("still completes the original member after createDraft fails", async () => {
  // 下書き作成失敗で selectedMemberIdRef が失われると、残った元フォームの完了で
  // 成功 message もフォーム close も出ない回帰を防ぐ。
  const createDraft = vi.fn().mockRejectedValue(new Error("家族の追加に失敗しました"));
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ createDraft, updateMember }, { startClosed: true });

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  expect(await screen.findByRole("status")).toHaveTextContent("家族の追加に失敗しました");

  // 失敗後は一覧のまま。元の家族を編集して完了できる
  await userEvent.click(screen.getByRole("button", { name: /を編集$/u }));
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
  expect(screen.getByLabelText("呼び名")).toHaveValue("大人");

  await userEvent.click(screen.getByRole("button", { name: "この家族の設定を完了" }));

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("status")).toHaveTextContent("家族設定が変わりました");
  expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
});

it("clears an earlier completion failure as soon as a new draft is requested", async () => {
  const firstDraft: HouseholdMemberRow = {
    ...member,
    id: "draft-1",
    status: "draft",
    display_name: "追加中",
  };
  const nextDraft: HouseholdMemberRow = {
    ...firstDraft,
    id: "draft-2",
    display_name: null,
    sort_order: 1,
  };
  // H9: 既存 draft があると createDraft せず再利用するため、
  // 削除後の invalidate → listMembers では draft が消えている必要がある
  let membersList: HouseholdMemberRow[] = [firstDraft];
  const listMembers = vi.fn(() => Promise.resolve(membersList.map((row) => ({ ...row }))));
  let resolveCreate: ((saved: HouseholdMemberRow) => void) | undefined;
  const createDraft = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveCreate = resolve;
      }),
  );
  const deleteMember = vi.fn((memberId: string): Promise<void> => {
    membersList = membersList.filter((row) => row.id !== memberId);
    return Promise.resolve();
  });
  await renderSettings({
    listMembers,
    updateDraft: vi.fn().mockResolvedValue(firstDraft),
    completeMember: vi.fn().mockRejectedValue(new Error("古い下書きの完了に失敗しました")),
    createDraft,
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));
  expect(await screen.findByRole("status")).toHaveTextContent("古い下書きの完了に失敗しました");

  // 編集中は追加できないため、追加をやめて一覧へ戻ってから新規追加する
  await userEvent.click(screen.getByRole("button", { name: "追加をやめる" }));
  await waitFor(() => {
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledWith("draft-1");
  });
  await userEvent.click(screen.getByRole("button", { name: /^家族を追加$/u }));
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  // 追加要求時点で古い完了失敗メッセージは消えている
  expect(screen.queryByText("古い下書きの完了に失敗しました")).not.toBeInTheDocument();

  await act(async () => {
    membersList = [nextDraft];
    resolveCreate?.(nextDraft);
    await Promise.resolve();
  });

  expect(await screen.findByRole("heading", { name: "「名前未設定」を編集中" })).toBeVisible();
  expect(screen.queryByText("古い下書きの完了に失敗しました")).not.toBeInTheDocument();
});

it("clears the previous member's validation feedback when switching members", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
  });

  fireEvent.change(await screen.findByLabelText("年齢のめやす"), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "この家族の設定を完了" }));
  // validation toast（status）+ フォーム先頭 alert。文言は先頭 field message
  expect(screen.getByRole("status")).toHaveTextContent(/選んでください|確認してください|入力内容/);
  expect(screen.getByRole("alert")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  expect(await screen.findByRole("heading", { name: "「子ども」を編集中" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows toast field error and focuses first invalid on incomplete save", async () => {
  const user = userEvent.setup();
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ updateMember });

  fireEvent.change(await screen.findByLabelText("年齢のめやす"), { target: { value: "" } });
  const complete = screen.getByRole("button", { name: "この家族の設定を完了" });
  expect(complete).not.toBeDisabled();
  await user.click(complete);

  expect(updateMember).not.toHaveBeenCalled();
  // toast は role=status（設計 §6.3）
  expect(screen.getByRole("status")).toHaveTextContent(/選んでください|確認してください|入力内容/);
  // フォームレベル role=alert は先頭エラー1つ
  const alerts = screen.getAllByRole("alert");
  expect(alerts.length).toBeGreaterThanOrEqual(1);
  expect(alerts[0]).toHaveTextContent(/選んでください|確認してください|入力内容/);
  // 先頭 invalid field へ focus
  expect(document.activeElement).toBeTruthy();
  expect(screen.getByLabelText("年齢のめやす")).toHaveFocus();
  expect(screen.getByLabelText("年齢のめやす")).toHaveAttribute("aria-invalid", "true");
});

it("focuses kinds checkbox and clears leftover status on present-without-kinds complete", async () => {
  // present + kinds 0 件だけが lead のとき fieldset 先頭 checkbox へ focus。
  // autosave 成功の role=status を残したまま toast すると status が二重になるため消す。
  const user = userEvent.setup();
  const updateMember = vi.fn().mockResolvedValue(member);
  await renderSettings({ updateMember });

  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "保存済み" } });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定が変わりました");
  });
  const saveCallsBeforeKindsError = updateMember.mock.calls.length;

  await user.selectOptions(screen.getByLabelText(unsupportedDietStatusLabel), "present");
  // present + 空 kinds は autosave が schema で止まり、成功 status は残り得る
  const complete = screen.getByRole("button", { name: "この家族の設定を完了" });
  await user.click(complete);

  // present / 完了どちらも保存に進まない
  expect(updateMember.mock.calls.length).toBe(saveCallsBeforeKindsError);
  // toast 1 つだけ（autosave の status 行は消えている）
  const statuses = screen.getAllByRole("status");
  expect(statuses).toHaveLength(1);
  expect(statuses[0]).toHaveTextContent(UNSUPPORTED_DIET_KINDS_REQUIRED);
  expect(screen.getByRole("alert")).toHaveTextContent(UNSUPPORTED_DIET_KINDS_REQUIRED);
  // kinds 先頭 checkbox へ focus。status select にも aria-invalid
  expect(
    screen.getByRole("checkbox", { name: UNSUPPORTED_DIET_KIND_LABELS.weaning_food }),
  ).toHaveFocus();
  expect(screen.getByLabelText(unsupportedDietStatusLabel)).toHaveAttribute("aria-invalid", "true");
});

it("shows toast for registered allergy with zero items on complete", async () => {
  const user = userEvent.setup();
  const updateMember = vi.fn().mockResolvedValue(member);
  const { queryClient } = await renderSettings({
    updateMember,
    listAllergies: vi.fn().mockResolvedValue([]),
  });
  await waitForAllergies(queryClient);

  await user.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await user.click(screen.getByRole("button", { name: "この家族の設定を完了" }));

  expect(updateMember).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
});

it("does not publish a queued validation error after switching to another member", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveFirstSave: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveFirstSave = resolve;
      }),
  );
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    updateMember,
  });

  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "保存中" } });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  fireEvent.change(screen.getByLabelText("年齢のめやす"), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  await act(async () => {
    resolveFirstSave?.({ ...member, display_name: "保存中" });
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(await screen.findByRole("heading", { name: "「子ども」を編集中" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not publish a queued save failure after switching to another member", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveFirstSave: ((saved: HouseholdMemberRow) => void) | undefined;
  let rejectSecondSave: ((error: Error) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstSave = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((_resolve, reject) => {
          rejectSecondSave = reject;
        }),
    );
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    updateMember,
  });

  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "保存中" } });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  await act(async () => {
    resolveFirstSave?.({ ...member, display_name: "保存中" });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  await act(async () => {
    rejectSecondSave?.(new Error("前の家族の保存に失敗しました"));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(await screen.findByRole("heading", { name: "「子ども」を編集中" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps a draft editor open when completeMember fails", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "draft-1",
    status: "draft",
    display_name: "追加中",
  };
  const completeMember = vi.fn().mockRejectedValue(new Error("家族設定を完了できませんでした"));
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([draft]),
    updateDraft: vi.fn().mockResolvedValue(draft),
    completeMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));

  expect(await screen.findByRole("status")).toHaveTextContent("家族設定を完了できませんでした");
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
});

it("家族0件でも登録済み領域と追加領域を分けて表示する", async () => {
  await renderSettings({ listMembers: vi.fn().mockResolvedValue([]) });

  expect(await screen.findByRole("heading", { name: "登録済みの家族" })).toBeVisible();
  expect(screen.getByText("まだ家族は登録されていません。")).toBeVisible();
  expect(screen.getByRole("heading", { name: "家族を追加する" })).toBeVisible();
  expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
});

it("keeps family CRUD controls and composes the account danger zone on the same Plan 1 page", async () => {
  const second: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const addDislike = vi.fn().mockResolvedValue({
    id: "dislike-1",
    user_id: "user-1",
    member_id: "member-1",
    ingredient_name: "ピーマン",
    created_at: "2026-07-11T00:00:00.000Z",
  });
  const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  const { updateMember } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, second]),
    addDislike,
    addStandardAllergy,
    deleteMember,
    listAllergies: vi.fn().mockResolvedValue([]),
    listDislikes: vi.fn().mockResolvedValue([]),
  });

  // 既存の家族 CRUD が引き続き同一ページ所有者上で動くこと
  expect(await screen.findByRole("heading", { name: "家族設定" })).toBeVisible();
  expect(screen.getByLabelText("呼び名")).toHaveValue("大人");
  await userEvent.clear(screen.getByLabelText("呼び名"));
  await userEvent.type(screen.getByLabelText("呼び名"), "保護者");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalled();
  });

  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(await screen.findByRole("button", { name: "くるみを追加" }));
  expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "walnut");

  await userEvent.type(screen.getByLabelText("苦手食材を追加"), "ピーマン");
  await userEvent.click(screen.getByRole("button", { name: "苦手食材を追加" }));
  expect(addDislike).toHaveBeenCalledWith("member-1", "ピーマン");

  await userEvent.click(screen.getByRole("button", { name: "家族を削除" }));
  expect(screen.getByRole("button", { name: "家族だけを削除" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "キャンセル" }));

  // Plan 6 の DangerZone は同一 main 内に合成される（ページ所有者は置換しない）
  expect(screen.getAllByRole("heading", { name: "家族設定" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "ログアウト" })).toBeVisible();
  expect(screen.getByRole("region", { name: "危険な操作" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "アカウントを削除" }));
  expect(screen.getByText(/家族設定、献立履歴、冷蔵庫の食材、買い物リスト/u)).toBeVisible();
  // アカウント削除と家族削除は別操作
  expect(deleteMember).not.toHaveBeenCalled();
});

it("creates and selects a new draft while an existing member is present", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    status: "draft",
    display_name: null,
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
    sort_order: 1,
  };
  const createDraft = vi.fn().mockResolvedValue(draft);
  const { queryClient } = await renderSettings({ createDraft }, { startClosed: true });

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();

  expect(createDraft).toHaveBeenCalledWith(1);
  expect(await screen.findByLabelText("呼び名")).toHaveValue("");
  expect(screen.getByLabelText("年齢のめやす")).toHaveValue("");
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("");
  expect(screen.getByLabelText(unsupportedDietStatusLabel)).toHaveValue("");
  expect(screen.getByRole("button", { name: "この家族の設定を完了" })).toBeVisible();
  expect(screen.getByRole("button", { name: "追加をやめる" })).toBeVisible();
  // 下書き追加中は「家族を削除」を出さず、中止操作だけに絞る
  expect(screen.queryByRole("button", { name: "家族を削除" })).not.toBeInTheDocument();

  await act(async () => {
    queryClient.setQueryData(["household", "members", "settings"], [member]);
    await Promise.resolve();
  });
  // 選択中draftがcacheから消えても、残存memberへ同期して空画面へ落とさない。
  expect(await screen.findByLabelText("呼び名")).toHaveValue("大人");
  expect(screen.queryByText("家族を追加してください")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "家族を削除" })).toBeVisible();
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([member]);
});

it("cancels a newly added draft without completing it", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    status: "draft",
    display_name: null,
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
    sort_order: 1,
  };
  const createDraft = vi.fn().mockResolvedValue(draft);
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  const { queryClient } = await renderSettings(
    { createDraft, deleteMember },
    { startClosed: true },
  );

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();
  expect(await screen.findByRole("button", { name: "追加をやめる" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "家族を削除" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "追加をやめる" }));

  expect(deleteMember).toHaveBeenCalledWith("member-2");
  // 編集フォームを閉じ、末尾の「家族を削除」すり替わり連打を防ぐ
  expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "追加をやめる" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "家族を追加" })).toBeVisible();
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([member]);
  expect(await screen.findByText("家族の追加をやめました")).toBeVisible();
  // 視線・フォーカスはページ見出し（上部）へ戻る
  expect(screen.getByRole("heading", { name: "家族設定" })).toHaveFocus();
});

it("removes a deleted member from cache and closes the editor", async () => {
  const remaining = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, remaining])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = await renderSettings({ listMembers });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  // 編集中の家族を削除したらフォームを閉じ、残った家族は一覧に残る
  await waitFor(() => {
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "1人目の子どもを編集" })).toBeVisible();
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([remaining]);
  expect(await screen.findByText("家族の設定を削除しました")).toBeVisible();
});

it("shows the empty add screen immediately after deleting the last member", async () => {
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = await renderSettings({ listMembers });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  expect(await screen.findByRole("heading", { name: "家族を追加する" })).toBeVisible();
  expect(screen.getByText(UNSUPPORTED_DIET_EMPTY_ADD_HELP)).toBeVisible();
  expect(screen.queryByLabelText("呼び名")).not.toBeInTheDocument();
  // 空状態でもアカウント操作は常時表示し、家族追加の結果としてログアウトが現れるようにしない
  expect(screen.getByRole("button", { name: "ログアウト" })).toBeVisible();
  expect(queryClient.getQueryData(["household", "members", "settings"])).toEqual([]);
});

it("closes a member delete confirmation when another member is selected", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
});

it("can delete a list member who is not the currently edited one", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    deleteMember,
  });

  // renderSettings は先頭（大人）を編集中。一覧から子どもを削除できること。
  expect(screen.getByRole("heading", { name: "「大人」を編集中" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを削除" }));
  expect(screen.getByRole("dialog", { name: "家族の削除確認" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledWith("member-2");
  });
  expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  // 編集中の大人は残る（削除対象は子ども）
  expect(screen.getByRole("heading", { name: "「大人」を編集中" })).toBeVisible();
});

it("does not delete either member after switching during the delete target's allergy add", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy,
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
});

it("deletes only the captured member and preserves a newly selected member", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  let resolveDelete: (() => void) | undefined;
  const pendingDelete = new Promise<void>((resolve) => {
    resolveDelete = resolve;
  });
  const deleteMember = vi.fn().mockReturnValue(pendingDelete);
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, secondMember])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = await renderSettings({ listMembers, deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });

  await act(async () => {
    resolveDelete?.();
    await pendingDelete;
  });

  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledWith(member.id);
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  expect(queryClient.getQueryData(householdKeys.members("settings"))).toEqual([secondMember]);
});

it("closes a delete confirmation when its target disappears from the member cache", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    deleteMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const staleConfirm = screen.getByRole("button", { name: "家族だけを削除" });
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [secondMember]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  });
  // 外部削除相当で選択中memberが消え、残存先頭memberへeditor・一覧・cacheが同期する。
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  expect(
    screen.getByRole("heading", {
      name: "「子ども」を編集中",
    }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "1人目の子どもを編集" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(queryClient.getQueryData(householdKeys.members("settings"))).toEqual([secondMember]);
  expect(screen.queryByRole("dialog", { name: "家族の削除確認" })).not.toBeInTheDocument();
  fireEvent.click(staleConfirm);
  expect(deleteMember).not.toHaveBeenCalled();
});

it("submits a member delete confirmation only once", async () => {
  let resolveDelete: (() => void) | undefined;
  const pendingDelete = new Promise<void>((resolve) => {
    resolveDelete = resolve;
  });
  const deleteMember = vi.fn().mockReturnValue(pendingDelete);
  await renderSettings({ deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const confirm = screen.getByRole("button", { name: "家族だけを削除" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(deleteMember).toHaveBeenCalledTimes(1);
  expect(confirm).toBeDisabled();
  await act(async () => {
    resolveDelete?.();
    await pendingDelete;
  });
});

it("prevents duplicate draft creation from the empty add screen", async () => {
  let resolveCreate: ((member: HouseholdMemberRow) => void) | undefined;
  const createDraft = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveCreate = resolve;
      }),
  );
  await renderSettings({ listMembers: vi.fn().mockResolvedValue([]), createDraft });
  const add = await screen.findByRole("button", { name: /^家族を追加$/u });

  await userEvent.click(add);
  expect(createDraft).not.toHaveBeenCalled();
  await confirmAddScopeNotice();
  // 作成中は追加ボタンが disabled（single-flight / isPending）
  await waitFor(() => {
    expect(createDraft).toHaveBeenCalledTimes(1);
  });
  expect(add).toBeDisabled();
  await userEvent.click(add);
  expect(createDraft).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveCreate?.({ ...member, id: "member-2", status: "draft" });
    await Promise.resolve();
  });
  expect(await screen.findByLabelText("呼び名")).toBeVisible();
});

it("keeps every new draft field through consecutive autosaves and completes with the latest payload", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-draft",
    status: "draft",
    display_name: "子ども",
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
  };
  const pendingSaves: Array<{
    patch: HouseholdMemberPatch;
    resolve(savedMember: HouseholdMemberRow): void;
  }> = [];
  const updateDraft = vi.fn(
    (_memberId: string, patch: HouseholdMemberPatch) =>
      new Promise<HouseholdMemberRow>((resolve) => {
        pendingSaves.push({ patch, resolve });
      }),
  );
  const completeMember = vi.fn().mockResolvedValue({ ...draft, status: "complete" });
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([]),
    createDraft: vi.fn().mockResolvedValue(draft),
    updateDraft,
    completeMember,
  });

  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  await confirmAddScopeNotice();
  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "adult");
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await userEvent.selectOptions(screen.getByLabelText(unsupportedDietStatusLabel), "none");
  await userEvent.click(screen.getByLabelText("骨を除く"));

  for (let index = 0; index < 2; index += 1) {
    await waitFor(() => {
      expect(updateDraft).toHaveBeenCalledTimes(index + 1);
    });
    const pendingSave = pendingSaves[index];
    if (pendingSave === undefined) throw new Error("保留中の下書き保存を確認できませんでした");
    await act(async () => {
      pendingSave.resolve({ ...draft, ...pendingSave.patch });
      await Promise.resolve();
    });
  }

  await waitFor(() => {
    expect(screen.getByLabelText("年齢のめやす")).toHaveValue("adult");
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
    expect(screen.getByLabelText(unsupportedDietStatusLabel)).toHaveValue("none");
    expect(screen.getByLabelText("骨を除く")).toBeChecked();
  });
  expect(updateDraft.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({
      age_band: "adult",
      allergy_status: "none",
      unsupported_diet_status: "none",
      required_safety_constraints: ["remove_bones"],
    }),
  );

  await userEvent.click(screen.getByRole("button", { name: "この家族の設定を完了" }));
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledTimes(3);
  });
  const completionSave = pendingSaves[2];
  if (completionSave === undefined) throw new Error("完了前の下書き保存を確認できませんでした");
  await act(async () => {
    completionSave.resolve({ ...draft, ...completionSave.patch });
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith(draft.id);
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  expect(completionSave.patch).toEqual(
    expect.objectContaining({
      age_band: "adult",
      allergy_status: "none",
      unsupported_diet_status: "none",
      required_safety_constraints: ["remove_bones"],
    }),
  );
});

it("saves a changed safety field and invalidates dependents", async () => {
  const { updateMember, invalidateSafety } = await renderSettings();
  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");
  await waitFor(() => {
    expect(updateMember.mock.calls.length).toBeGreaterThan(0);
  });
  await waitFor(() => {
    expect(invalidateSafety.mock.calls.length).toBeGreaterThan(0);
  });
});

// H3/H4: DB コミット後の invalidate 失敗は soft（保存成功）。ただし「再確認します」は出さない
it("H3: treats post-commit invalidateSafety failure as soft success", async () => {
  const updateMember = vi.fn().mockResolvedValue({
    ...member,
    age_band: "age_3_5",
    updated_at: "2026-07-12T00:00:00.000Z",
  });
  const invalidateSafety = vi.fn().mockRejectedValue(new Error("安全条件の無効化に失敗しました"));
  await renderSettings({ updateMember, invalidateSafety });

  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    // H4: 保存済みだが再確認失敗を明示（false assurance を縮める）
    expect(screen.getByRole("status")).toHaveTextContent("家族設定を保存しました");
    expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
  expect(screen.getByRole("status")).not.toHaveTextContent("安全条件の無効化に失敗しました");
  expect(screen.getByRole("status")).not.toHaveTextContent("保存できませんでした");
});

// H9: CAS 衝突後は members 再取得と CAS 基準更新で再衝突ループを閉じる
it("H9: after version conflict, refetches members and advances CAS so retry succeeds", async () => {
  const serverAfterOtherTab: HouseholdMemberRow = {
    ...member,
    display_name: "他タブ更新",
    allergy_status: "unconfirmed",
    updated_at: "2026-07-20T00:00:00.000Z",
  };
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member])
    .mockResolvedValue([serverAfterOtherTab]);
  const updateMember = vi
    .fn()
    .mockRejectedValueOnce(new HouseholdMemberVersionConflictError())
    .mockImplementation(
      (_memberId: string, patch: HouseholdMemberPatch, expectedUpdatedAt: string) => {
        expect(expectedUpdatedAt).toBe(serverAfterOtherTab.updated_at);
        return Promise.resolve({
          ...serverAfterOtherTab,
          ...patch,
          updated_at: "2026-07-21T00:00:00.000Z",
        });
      },
    );
  await renderSettings({ listMembers, updateMember });

  // 初回 save は T0 基準で CAS miss
  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  expect(updateMember.mock.calls[0]?.[2]).toBe(member.updated_at);
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent(
      "家族設定が他の画面で更新されています。最新の内容を確認してください",
    );
  });
  // members 再取得後、form は他タブの正本へ戻る
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("他タブ更新");
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("unconfirmed");
  });
  expect(listMembers.mock.calls.length).toBeGreaterThanOrEqual(2);

  // 再編集は新 CAS 基準で成功する（T0 固定の再衝突ループに入らない）
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(updateMember.mock.calls[1]?.[2]).toBe(serverAfterOtherTab.updated_at);
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
  });
});

// H-RR1: draft complete 後の invalidate 失敗も soft。完了成功 UX を維持する
it("H-RR1: treats post-completeMember invalidateSafety failure as soft success", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "draft-1",
    status: "draft",
    display_name: "追加中",
  };
  const completed: HouseholdMemberRow = { ...draft, status: "complete" };
  const completeMember = vi.fn().mockResolvedValue(completed);
  const updateDraft = vi.fn().mockResolvedValue(draft);
  const invalidateSafety = vi.fn().mockRejectedValue(new Error("安全条件の無効化に失敗しました"));
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([draft]),
    updateDraft,
    completeMember,
    invalidateSafety,
  });

  await userEvent.click(await screen.findByRole("button", { name: "この家族の設定を完了" }));

  await waitFor(() => {
    expect(completeMember).toHaveBeenCalledWith(draft.id);
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    // H4: complete 成功だが再確認失敗を明示
    expect(screen.getByRole("status")).toHaveTextContent("家族設定を保存しました");
    expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
  expect(screen.getByRole("status")).not.toHaveTextContent("完了できませんでした");
  expect(screen.getByRole("status")).not.toHaveTextContent("安全条件の無効化に失敗しました");
  // complete コミット後の members cache は complete のまま（false failure で巻き戻さない）
  await waitFor(() => {
    const cached = queryClient.getQueryData<HouseholdMemberRow[]>(
      householdKeys.members("settings"),
    );
    expect(cached?.find((row) => row.id === draft.id)?.status).toBe("complete");
  });
  await waitFor(() => {
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
});

// H-RR2: アレルギー削除コミット後の invalidate 失敗は soft（削除は適用済み）
it("H-RR2: treats post-removeAllergy invalidateSafety failure as soft success", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  // H5: 削除後 list は残存行のみ（silent success 検知用に再取得する）
  const listAllergies = vi
    .fn()
    .mockResolvedValueOnce([standardAllergy, customAllergy])
    .mockResolvedValue([customAllergy]);
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  const invalidateSafety = vi.fn().mockRejectedValue(new Error("安全条件の無効化に失敗しました"));
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies,
    removeAllergy,
    invalidateSafety,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  // AllergyEditor onError 経由の総失敗文言を出さない。H4: 再確認失敗は status に出す
  expect(screen.queryByText("アレルギーを削除できませんでした")).not.toBeInTheDocument();
  expect(screen.queryByText("安全条件の無効化に失敗しました")).not.toBeInTheDocument();
  expect(screen.queryByText("アレルギー情報を更新できませんでした")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗");
  });
});

// H-RR2: 苦手追加コミット後の invalidate 失敗は soft（入力クリア＝成功 UX）
it("H-RR2: treats post-addDislike invalidateSafety failure as soft success", async () => {
  const added: MemberDislikeRow = {
    id: "dislike-1",
    user_id: "user-1",
    member_id: member.id,
    ingredient_name: "ピーマン",
    created_at: "2026-07-11T00:00:00.000Z",
  };
  const addDislike = vi.fn().mockResolvedValue(added);
  const invalidateSafety = vi.fn().mockRejectedValue(new Error("安全条件の無効化に失敗しました"));
  await renderSettings({ addDislike, invalidateSafety });

  await userEvent.type(await screen.findByLabelText("苦手食材を追加"), "ピーマン");
  await userEvent.click(screen.getByRole("button", { name: "苦手食材を追加" }));

  await waitFor(() => {
    expect(addDislike).toHaveBeenCalledWith(member.id, "ピーマン");
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  // 成功コールバックで入力が空。H4: 再確認失敗は status に出す
  await waitFor(() => {
    expect(screen.getByLabelText("苦手食材を追加")).toHaveValue("");
  });
  expect(screen.queryByText("苦手食材を追加できませんでした")).not.toBeInTheDocument();
  expect(screen.queryByText("安全条件の無効化に失敗しました")).not.toBeInTheDocument();
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗");
  });
});

// H-RR3: メンバー削除コミット後の invalidate 失敗は soft。削除成功 UX を維持する
it("H-RR3: treats post-deleteMember invalidateSafety failure as soft success", async () => {
  const secondMember = { ...member, id: "member-2", display_name: "子ども", sort_order: 1 };
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  const invalidateSafety = vi.fn().mockRejectedValue(new Error("安全条件の無効化に失敗しました"));
  // 初回は2人、削除後の members invalidateQueries 再取得は残存のみ（楽観削除を巻き戻さない）
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, secondMember])
    .mockResolvedValue([member]);
  const { queryClient } = await renderSettings({
    listMembers,
    deleteMember,
    invalidateSafety,
  });

  // 一覧から子どもを削除（編集中の大人は残す）
  await userEvent.click(await screen.findByRole("button", { name: "2人目の子どもを削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));

  await waitFor(() => {
    expect(deleteMember).toHaveBeenCalledWith("member-2");
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    // H4: 削除成功 + 再確認失敗を併記
    expect(screen.getByRole("status")).toHaveTextContent("家族の設定を削除しました");
    expect(screen.getByRole("status")).toHaveTextContent("画面の再確認に失敗");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("削除できませんでした");
  expect(screen.getByRole("status")).not.toHaveTextContent("安全条件の無効化に失敗しました");
  // 削除コミット後の members cache から対象が消えたまま（false failure で巻き戻さない）
  await waitFor(() => {
    const cached = queryClient.getQueryData<HouseholdMemberRow[]>(
      householdKeys.members("settings"),
    );
    expect(cached?.some((row) => row.id === "member-2")).toBe(false);
  });
  expect(screen.getByRole("heading", { name: "「大人」を編集中" })).toBeVisible();
});

// H12: DB の不正 enum を unchecked cast で select に載せない（空/年齢デフォルトへ）
it("initializes form from corrupt DB enums as empty selects and age defaults", async () => {
  const corrupt: HouseholdMemberRow = {
    ...member,
    age_band: "legacy_child",
    allergy_status: "maybe",
    unsupported_diet_status: "sometimes",
    portion_size: "huge",
    spice_level: "extra_hot",
    ease_preferences: ["soft", "not_an_ease"],
    required_safety_constraints: ["remove_bones", "bogus"],
  };
  await renderSettings({ listMembers: vi.fn().mockResolvedValue([corrupt]) });

  expect(await screen.findByLabelText("年齢のめやす")).toHaveValue("");
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("");
  expect(screen.getByLabelText(unsupportedDietStatusLabel)).toHaveValue("");
  // 年齢不正時は adult 既定（regular / regular）
  expect(screen.getByLabelText("食べる量")).toHaveValue("regular");
  expect(screen.getByLabelText("辛さ")).toHaveValue("regular");
  // 不正配列要素は落とす（soft の aria-label は enum キーのまま）
  expect(screen.getByLabelText("soft")).toBeChecked();
  expect(screen.getByLabelText("骨を除く")).toBeChecked();
  expect(screen.getByLabelText("小さく切る")).not.toBeChecked();
});

// RR1: 空年齢 + 保持した非デフォルト portion は、初回年齢選択で next 既定に潰さない
it("RR1: first age selection from empty keeps non-default portion from H12", async () => {
  // draft: age null + portion large（H12 が large を保持、age は ""）
  const draftWithLarge: HouseholdMemberRow = {
    ...member,
    id: "member-draft-rr1",
    status: "draft",
    display_name: "下書き",
    age_band: null,
    portion_size: "large",
    spice_level: "mild",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  const updateDraft = vi.fn().mockResolvedValue({
    ...draftWithLarge,
    age_band: "adult",
    portion_size: "large",
    spice_level: "mild",
  });
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([draftWithLarge]),
    updateDraft,
  });

  expect(await screen.findByLabelText("年齢のめやす")).toHaveValue("");
  expect(screen.getByLabelText("食べる量")).toHaveValue("large");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");

  // adult 既定は portion regular / spice regular。mild も adult 既定外なので保持。
  await userEvent.selectOptions(screen.getByLabelText("年齢のめやす"), "adult");

  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalled();
  });
  const patch = updateDraft.mock.calls.at(-1)?.[1] as HouseholdMemberPatch | undefined;
  expect(patch).toMatchObject({
    age_band: "adult",
    portion_size: "large",
    spice_level: "mild",
  });
  // UI も上書きされていないこと
  expect(screen.getByLabelText("食べる量")).toHaveValue("large");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
});

it("shows Japanese labels for unsupported diet kinds, not English enum keys", async () => {
  // 回帰: 設定編集フォームが weaning_food 等のキーをそのまま出していた
  await renderSettings();
  await userEvent.selectOptions(
    await screen.findByLabelText(unsupportedDietStatusLabel),
    "present",
  );
  expect(screen.getByText(UNSUPPORTED_DIET_STATUS_HELP)).toBeInTheDocument();
  expect(screen.getByText(UNSUPPORTED_DIET_PRESENT_HELP)).toBeInTheDocument();
  expect(screen.getByText(UNSUPPORTED_DIET_KIND_LABELS.weaning_food)).toBeInTheDocument();
  expect(screen.getByText(UNSUPPORTED_DIET_KIND_LABELS.swallowing_concern)).toBeInTheDocument();
  expect(screen.getByText(UNSUPPORTED_DIET_KIND_LABELS.therapeutic_diet)).toBeInTheDocument();
  expect(screen.queryByText("weaning_food")).not.toBeInTheDocument();
  expect(screen.queryByText("swallowing_concern")).not.toBeInTheDocument();
  expect(screen.queryByText("therapeutic_diet")).not.toBeInTheDocument();
});

it("shows add-scope notice before createDraft and cancel does not create", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    status: "draft",
    display_name: null,
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
    sort_order: 1,
  };
  const createDraft = vi.fn().mockResolvedValue(draft);
  await renderSettings({ createDraft }, { startClosed: true });
  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  const dialog = screen.getByRole("dialog", { name: "登録の前に" });
  expect(dialog).toBeVisible();
  expect(dialog).toHaveTextContent("その方個人向け");
  expect(dialog).toHaveTextContent("他の家族向け");
  expect(createDraft).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "やめる" }));
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
  expect(createDraft).not.toHaveBeenCalled();
});

it("reuses existing draft on add without calling createDraft (H9)", async () => {
  // 同タブに draft があるときは INSERT せず既存を開く（RPC 再利用と揃える）
  const existingDraft: HouseholdMemberRow = {
    ...member,
    id: "member-draft",
    status: "draft",
    display_name: "途中の家族",
    age_band: null,
    allergy_status: null,
    unsupported_diet_status: null,
    sort_order: 1,
  };
  const createDraft = vi.fn();
  await renderSettings(
    {
      listMembers: vi.fn().mockResolvedValue([member, existingDraft]),
      createDraft,
    },
    { startClosed: true },
  );
  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  await confirmAddScopeNotice();
  expect(createDraft).not.toHaveBeenCalled();
  expect(await screen.findByLabelText("呼び名")).toHaveValue("途中の家族");
});

it("does not open add-scope notice when editing an existing member", async () => {
  await renderSettings();
  expect(screen.getByRole("region", { name: "家族情報を追加・編集" })).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
  expect(screen.getByLabelText(unsupportedDietStatusLabel)).toBeVisible();
});

it("closes add-scope notice on Escape without createDraft", async () => {
  const createDraft = vi.fn().mockResolvedValue({
    ...member,
    id: "member-2",
    status: "draft",
  });
  await renderSettings({ createDraft }, { startClosed: true });
  await userEvent.click(await screen.findByRole("button", { name: /^家族を追加$/u }));
  expect(screen.getByRole("dialog", { name: "登録の前に" })).toBeVisible();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "登録の前に" })).not.toBeInTheDocument();
  expect(createDraft).not.toHaveBeenCalled();
});

it.each([
  { allergyKind: "standard" as const, label: "standard allergy" },
  { allergyKind: "custom" as const, label: "custom allergy" },
])(
  "defers a registered allergy status until the first $label is saved",
  async ({ allergyKind }) => {
    const registeredMember = { ...member, allergy_status: "registered" as const };
    const updateMember = vi.fn().mockResolvedValue(registeredMember);
    let allergies: MemberAllergyRow[] = [];
    const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
    const addStandardAllergy = vi.fn().mockImplementation(() => {
      allergies = [standardAllergy];
      return Promise.resolve(standardAllergy);
    });
    const addCustomAllergy = vi.fn().mockImplementation(() => {
      const customRow: MemberAllergyRow = {
        ...standardAllergy,
        id: "allergy-custom",
        allergen_id: null,
        custom_name: "えんどう豆たんぱく",
        custom_confirmed: true,
      };
      allergies = [customRow];
      return Promise.resolve(customRow);
    });
    await renderSettings({
      listAllergies,
      updateMember,
      addStandardAllergy,
      addCustomAllergy,
    });

    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
    expect(updateMember).not.toHaveBeenCalled();

    if (allergyKind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "えんどう豆たんぱく");
      await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    const addAllergy = allergyKind === "standard" ? addStandardAllergy : addCustomAllergy;
    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith(
        "member-1",
        expect.objectContaining({ allergy_status: "registered" }),
        expect.any(String),
      );
    });
    const [addCallOrder] = addAllergy.mock.invocationCallOrder;
    const [updateCallOrder] = updateMember.mock.invocationCallOrder;
    if (addCallOrder === undefined || updateCallOrder === undefined) {
      throw new Error("アレルギー追加と状態保存の呼び出し順を確認できませんでした");
    }
    expect(addCallOrder).toBeLessThan(updateCallOrder);
  },
);

it.each([
  { allergyKind: "standard" as const, label: "standard allergy" },
  { allergyKind: "custom" as const, label: "custom allergy" },
])(
  "keeps a deferred registered intent while an earlier save settles before the first $label",
  async ({ allergyKind }) => {
    let resolveEarlierSave: ((savedMember: HouseholdMemberRow) => void) | undefined;
    const earlierSave = new Promise<HouseholdMemberRow>((resolve) => {
      resolveEarlierSave = resolve;
    });
    let allergies: MemberAllergyRow[] = [];
    const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
    const updateMember = vi
      .fn()
      .mockReturnValueOnce(earlierSave)
      .mockResolvedValue({ ...member, allergy_status: "registered" });
    const addStandardAllergy = vi.fn().mockImplementation(() => {
      allergies = [standardAllergy];
      return Promise.resolve(standardAllergy);
    });
    const addCustomAllergy = vi.fn().mockImplementation(() => {
      const customRow: MemberAllergyRow = {
        ...standardAllergy,
        id: "allergy-custom",
        allergen_id: null,
        custom_name: "えんどう豆たんぱく",
        custom_confirmed: true,
      };
      allergies = [customRow];
      return Promise.resolve(customRow);
    });
    await renderSettings({ listAllergies, updateMember, addStandardAllergy, addCustomAllergy });

    await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");
    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledTimes(1);
    });
    expect(updateMember.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ allergy_status: "none" }),
    );
    await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");

    await act(async () => {
      resolveEarlierSave?.({ ...member, age_band: "age_3_5", allergy_status: "none" });
      await earlierSave;
    });

    await waitFor(() => {
      expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    });
    expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();

    if (allergyKind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "えんどう豆たんぱく");
      await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledTimes(2);
    });
    expect(updateMember.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ allergy_status: "registered" }),
    );
  },
);

it("keeps only the deferred registered status over newer member query values", async () => {
  const latestMember: HouseholdMemberRow = {
    ...member,
    display_name: "保護者",
    portion_size: "large",
    spice_level: "mild",
    updated_at: "2026-07-18T00:00:00.000Z",
  };
  const updateMember = vi.fn((_memberId: string, patch: HouseholdMemberPatch) =>
    Promise.resolve({ ...latestMember, ...patch }),
  );
  const { queryClient } = await renderSettings({ updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [latestMember]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    expect(screen.getByLabelText("呼び名")).toHaveValue("保護者");
    expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
  });
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({
        allergy_status: "none",
        display_name: "保護者",
        portion_size: "small",
        spice_level: "mild",
      }),
      expect.any(String),
    );
  });
  expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
});

it.each(["none", "unconfirmed"] as const)(
  "clears a deferred registered status when it is changed to %s",
  async (allergyStatus) => {
    const savedMember = { ...member, allergy_status: allergyStatus };
    const updateMember = vi.fn().mockResolvedValue(savedMember);
    const { queryClient } = await renderSettings({ updateMember });

    const allergyStatusSelect = await screen.findByLabelText("アレルギーの確認");
    await userEvent.selectOptions(allergyStatusSelect, "registered");
    await userEvent.selectOptions(allergyStatusSelect, allergyStatus);

    await waitFor(() => {
      expect(updateMember).toHaveBeenCalledWith(
        member.id,
        expect.objectContaining({ allergy_status: allergyStatus }),
        expect.any(String),
      );
    });
    await act(async () => {
      queryClient.setQueryData(householdKeys.members("settings"), [savedMember]);
      await Promise.resolve();
    });
    expect(allergyStatusSelect).toHaveValue(allergyStatus);
  },
);

it("keeps a deferred registered intent when the first allergy add fails", async () => {
  let resolveEarlierSave: ((savedMember: HouseholdMemberRow) => void) | undefined;
  const earlierSave = new Promise<HouseholdMemberRow>((resolve) => {
    resolveEarlierSave = resolve;
  });
  let rejectAdd: ((error: Error) => void) | undefined;
  const addFailure = new Promise<MemberAllergyRow>((_resolve, reject) => {
    rejectAdd = reject;
  });
  const addStandardAllergy = vi.fn().mockReturnValue(addFailure);
  const updateMember = vi
    .fn()
    .mockReturnValueOnce(earlierSave)
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    );
  await renderSettings({ addStandardAllergy, updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await userEvent.selectOptions(allergyStatus, "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await act(async () => {
    rejectAdd?.(new Error("アレルギーを追加できませんでした"));
    await addFailure.catch(() => undefined);
  });

  await waitFor(() => {
    expect(allergyStatus).toHaveValue("registered");
  });
  expect(await screen.findByRole("status")).toHaveTextContent("アレルギーを追加できませんでした");
  await userEvent.selectOptions(screen.getByLabelText("辛さ"), "mild");
  await act(async () => {
    resolveEarlierSave?.({ ...member, age_band: "age_3_5", allergy_status: "none" });
    await earlierSave;
  });
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(updateMember.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ allergy_status: "none", spice_level: "mild" }),
  );
});

it("keeps a deferred registered status when saving it after the first allergy fails", async () => {
  // H8: registered 確定は list 非空が条件。追加成功後 list が針を返す契約に揃える。
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定を保存できませんでした"));
  await renderSettings({
    updateMember,
    listAllergies,
    addStandardAllergy: vi.fn().mockImplementation(() => {
      allergies = [standardAllergy];
      return Promise.resolve(standardAllergy);
    }),
  });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await userEvent.selectOptions(allergyStatus, "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(await screen.findByRole("status")).toHaveTextContent("家族設定を保存できませんでした");
  expect(allergyStatus).toHaveValue("registered");
  expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
});

it("rejects removing the last allergy from a complete registered member", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn().mockResolvedValue([standardAllergy]),
    removeAllergy,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  expect(removeAllergy).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "登録ありの場合は1つ以上選んでください",
  );
});

it("shows a remove error when deleting from multiple registered allergies fails", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  const removeAllergy = vi.fn().mockRejectedValue(new Error("アレルギーを削除できませんでした"));
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn().mockResolvedValue([standardAllergy, customAllergy]),
    removeAllergy,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  expect(await screen.findByRole("status")).toHaveTextContent("アレルギーを削除できませんでした");
});

it("cleans up a deferred registered status when its member is deleted", async () => {
  const remainingMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const listMembers = vi
    .fn()
    .mockResolvedValueOnce([member, remainingMember])
    .mockImplementation(() => new Promise<HouseholdMemberRow[]>(() => undefined));
  const { queryClient } = await renderSettings({ listMembers });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "家族を削除" }));
  await userEvent.click(screen.getByRole("button", { name: "家族だけを削除" }));
  await waitFor(() => {
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });

  // 削除した大人をキャッシュへ戻して再編集しても、保留中の registered は残らない
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [member, remainingMember]);
    await Promise.resolve();
  });
  await userEvent.click(await screen.findByRole("button", { name: "1人目の大人を編集" }));

  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("none");
});

it("disables the allergy status until existing allergies finish loading", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const updateMember = vi.fn().mockResolvedValue({ ...member, allergy_status: "registered" });
  await renderSettings({ listAllergies, updateMember });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  expect(allergyStatus).toBeDisabled();

  await act(async () => {
    resolveAllergies?.([standardAllergy]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(allergyStatus).toBeEnabled();
  });
  await userEvent.selectOptions(allergyStatus, "registered");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

it("keeps newer edits in the registered save after a delayed standard allergy add", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const savedPatches: HouseholdMemberPatch[] = [];
  const updateMember = vi
    .fn()
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) => {
      savedPatches.push(patch);
      return Promise.resolve({
        ...member,
        display_name: patch.display_name ?? member.display_name,
        spice_level: patch.spice_level ?? member.spice_level,
        allergy_status: patch.allergy_status ?? member.allergy_status,
      });
    });
  await renderSettings({ listAllergies, addStandardAllergy, updateMember });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "保護者" } });
  await userEvent.selectOptions(screen.getByLabelText("辛さ"), "mild");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者", spice_level: "mild" }),
      expect.any(String),
    );
  });
  await act(async () => {
    allergies = [standardAllergy];
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(updateMember.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  const registeredPatches = savedPatches.filter((patch) => patch.allergy_status === "registered");
  expect(registeredPatches.at(-1)).toEqual(
    expect.objectContaining({
      allergy_status: "registered",
      display_name: "保護者",
      spice_level: "mild",
    }),
  );
});

it.each([
  {
    label: "none status",
    secondMember: {
      ...member,
      id: "member-2",
      display_name: "子ども",
      spice_level: "mild" as const,
      allergy_status: "none" as const,
      sort_order: 1,
    },
    secondAllergies: [] as MemberAllergyRow[],
  },
  {
    label: "registered status with different values",
    secondMember: {
      ...member,
      id: "member-2",
      display_name: "高齢者",
      spice_level: "none" as const,
      allergy_status: "registered" as const,
      sort_order: 1,
    },
    secondAllergies: [
      { ...standardAllergy, id: "allergy-2", member_id: "member-2" },
    ] as MemberAllergyRow[],
  },
])(
  "saves a delayed allergy transition with the initiating member when the next member has $label",
  async ({ secondMember, secondAllergies }) => {
    let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
    let member1Allergies: MemberAllergyRow[] = [];
    const addStandardAllergy = vi.fn(
      () =>
        new Promise<MemberAllergyRow>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    const updateCalls: Array<{ memberId: string; patch: HouseholdMemberPatch }> = [];
    const updateMember = vi.fn((memberId: string, patch: HouseholdMemberPatch) => {
      updateCalls.push({ memberId, patch });
      const source = memberId === member.id ? member : secondMember;
      return Promise.resolve({
        ...source,
        display_name: patch.display_name ?? source.display_name,
        spice_level: patch.spice_level ?? source.spice_level,
        allergy_status: patch.allergy_status ?? source.allergy_status,
      });
    });
    await renderSettings({
      listMembers: vi.fn().mockResolvedValue([member, secondMember]),
      listAllergies: vi.fn((memberId: string) =>
        Promise.resolve(
          memberId === member.id
            ? member1Allergies.map((row) => ({ ...row }))
            : secondAllergies.map((row) => ({ ...row })),
        ),
      ),
      addStandardAllergy,
      updateMember,
    });

    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
    await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    await userEvent.click(
      screen.getByRole("button", {
        name: `2人目の${secondMember.display_name}を編集`,
      }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("呼び名")).toHaveValue(secondMember.display_name);
    });

    await act(async () => {
      member1Allergies = [standardAllergy];
      resolveAdd?.(standardAllergy);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(updateCalls.length).toBe(1);
    });
    const [updateCall] = updateCalls;
    expect(updateCall?.memberId).toBe(member.id);
    expect(updateCall?.patch).toEqual(
      expect.objectContaining({
        allergy_status: "registered",
        display_name: member.display_name,
        spice_level: member.spice_level,
      }),
    );
  },
);

it("keeps an allergy add locked for its member across switching until success", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  let allergiesByMember: Record<string, MemberAllergyRow[]> = {
    [member.id]: [],
    [secondMember.id]: [],
  };
  const listAllergies = vi.fn((memberId: string) =>
    Promise.resolve((allergiesByMember[memberId] ?? []).map((row) => ({ ...row }))),
  );
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const updateMember = vi.fn((memberId: string, patch: HouseholdMemberPatch) =>
    Promise.resolve({ ...(memberId === member.id ? member : secondMember), ...patch }),
  );
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies,
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("子ども");
  });
  expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
  expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("大人");
  });
  // 追加中は当該 member の allergy 操作をロック（候補チップは mutationPending で disabled）
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toBeDisabled();
  });
  expect(screen.getByRole("button", { name: "くるみを追加" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "家族を削除" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  expect(addStandardAllergy).toHaveBeenCalledTimes(1);

  await act(async () => {
    allergiesByMember = { ...allergiesByMember, [member.id]: [standardAllergy] };
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });

  // autosave 等で updateMember が先に呼ばれ得るため回数固定ではなく registered PATCH を見る
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
  });
});

it("keeps the intent and unlocks a switched member after its allergy add fails", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let rejectAdd: ((error: Error) => void) | undefined;
  const pendingAdd = new Promise<MemberAllergyRow>((_resolve, reject) => {
    rejectAdd = reject;
  });
  const addStandardAllergy = vi.fn().mockReturnValue(pendingAdd);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn().mockResolvedValue([]),
    addStandardAllergy,
  });

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));

  expect(screen.getByLabelText("アレルギーの確認")).toBeDisabled();
  await act(async () => {
    rejectAdd?.(new Error("アレルギーを追加できませんでした"));
    await pendingAdd.catch(() => undefined);
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    expect(screen.getByLabelText("アレルギーの確認")).toBeEnabled();
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
  });
  expect(screen.getByRole("region", { name: "アレルギー編集" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("アレルギーを追加できませんでした");
});

it("blocks a previously opened member delete confirmation during an allergy add", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const deleteMember = vi.fn().mockResolvedValue(undefined);
  await renderSettings({ addStandardAllergy, deleteMember });

  await userEvent.click(await screen.findByRole("button", { name: "家族を削除" }));
  const confirmDelete = screen.getByRole("button", { name: "家族だけを削除" });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(screen.getByRole("button", { name: "家族を削除" })).toBeDisabled();
  expect(confirmDelete).toBeDisabled();
  fireEvent.click(confirmDelete);
  expect(deleteMember).not.toHaveBeenCalled();

  await act(async () => {
    resolveAdd?.(standardAllergy);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "家族を削除" })).toBeEnabled();
    expect(confirmDelete).toBeEnabled();
  });
});

it("disables every allergy operation while a registered member allergy query is pending", async () => {
  let resolveAllergies: ((allergies: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(
    () =>
      new Promise<MemberAllergyRow[]>((resolve) => {
        resolveAllergies = resolve;
      }),
  );
  const addStandardAllergy = vi.fn();
  const addCustomAllergy = vi.fn();
  const removeAllergy = vi.fn();
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([{ ...member, allergy_status: "registered" }]),
    listAllergies,
    addStandardAllergy,
    addCustomAllergy,
    removeAllergy,
  });

  expect(await screen.findByLabelText("アレルギーの確認")).toBeDisabled();
  const standardAdd = screen.getByRole("button", { name: "くるみを追加" });
  const customName = screen.getByLabelText("自由登録名");
  const customConfirm = screen.getByLabelText("一覧にないアレルギーとして登録");
  const customAdd = screen.getByRole("button", { name: "自由登録を追加" });
  expect(standardAdd).toBeDisabled();
  expect(customName).toBeDisabled();
  expect(customConfirm).toBeDisabled();
  expect(customAdd).toBeDisabled();

  fireEvent.click(standardAdd);
  fireEvent.click(customConfirm);
  fireEvent.click(customAdd);
  expect(addStandardAllergy).not.toHaveBeenCalled();
  expect(addCustomAllergy).not.toHaveBeenCalled();
  expect(removeAllergy).not.toHaveBeenCalled();

  await act(async () => {
    resolveAllergies?.([]);
    await Promise.resolve();
  });
});

it("keeps allergy operations disabled after failure and enables them only after retry succeeds", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  const listAllergies = vi
    .fn()
    .mockRejectedValueOnce(new Error("temporary failure"))
    .mockResolvedValue([standardAllergy, customAllergy]);
  const updateMember = vi.fn().mockResolvedValue(registeredMember);
  const addStandardAllergy = vi.fn().mockResolvedValue(standardAllergy);
  const addCustomAllergy = vi.fn().mockResolvedValue(customAllergy);
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies,
    updateMember,
    addStandardAllergy,
    addCustomAllergy,
    removeAllergy,
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "アレルギー情報を読み込めませんでした",
  );
  const allergyStatus = screen.getByLabelText("アレルギーの確認");
  const standardAdd = screen.getByRole("button", { name: "くるみを追加" });
  const customName = screen.getByLabelText("自由登録名");
  const customConfirm = screen.getByLabelText("一覧にないアレルギーとして登録");
  const customAdd = screen.getByRole("button", { name: "自由登録を追加" });
  // U3-I2: 一覧失敗でも status は なし/未確認 へ戻せる。追加操作だけ止める。
  expect(allergyStatus).toBeEnabled();
  expect(standardAdd).toBeDisabled();
  expect(customName).toBeDisabled();
  expect(customConfirm).toBeDisabled();
  expect(customAdd).toBeDisabled();
  fireEvent.click(standardAdd);
  fireEvent.click(customAdd);
  expect(updateMember).not.toHaveBeenCalled();
  expect(addStandardAllergy).not.toHaveBeenCalled();
  expect(addCustomAllergy).not.toHaveBeenCalled();
  expect(removeAllergy).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "アレルギー情報を再読み込み" }));
  await waitFor(() => {
    expect(listAllergies).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByRole("button", { name: "くるみを削除" })).toBeEnabled();
  expect(allergyStatus).toBeEnabled();
  expect(customName).toBeEnabled();
  expect(customConfirm).toBeEnabled();

  await userEvent.type(customName, "えんどう豆たんぱく");
  await userEvent.click(customConfirm);
  await userEvent.click(customAdd);
  await waitFor(() => {
    expect(addCustomAllergy).toHaveBeenCalledWith(member.id, "えんどう豆たんぱく", []);
  });
  await userEvent.click(screen.getByRole("button", { name: "くるみを削除" }));
  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  await userEvent.selectOptions(allergyStatus, "none");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({ allergy_status: "none" }),
      expect.any(String),
    );
  });
});

it("saves a registered allergy status immediately when an allergy already exists", async () => {
  const updateMember = vi.fn().mockResolvedValue({ ...member, allergy_status: "registered" });
  const { queryClient } = await renderSettings({
    updateMember,
    listAllergies: vi.fn().mockResolvedValue([standardAllergy]),
  });

  const allergyStatus = await screen.findByLabelText("アレルギーの確認");
  await waitFor(() => {
    expect(queryClient.getQueryData(householdKeys.allergies("settings", "member-1"))).toEqual([
      standardAllergy,
    ]);
  });
  await userEvent.selectOptions(allergyStatus, "registered");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

it("keeps explicitly empty saved preferences when loading and saving another field", async () => {
  const savedWithoutPreferences: HouseholdMemberRow = {
    ...member,
    age_band: "age_3_5",
    ease_preferences: [],
    required_safety_constraints: [],
  };
  const updateMember = vi.fn().mockResolvedValue(savedWithoutPreferences);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([savedWithoutPreferences]),
    updateMember,
  });

  expect(await screen.findByLabelText("骨を除く")).not.toBeChecked();
  expect(screen.getByLabelText("小さく切る")).not.toBeChecked();
  expect(screen.getByLabelText("小さめ")).not.toBeChecked();
  expect(screen.getByLabelText("boneless")).not.toBeChecked();
  expect(screen.getByLabelText("soft")).not.toBeChecked();

  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "子ども" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        display_name: "子ども",
        ease_preferences: [],
        required_safety_constraints: [],
      }),
      expect.any(String),
    );
  });
});

it("アレルギー0件のcomplete家族ではregisteredの保存を保留する", async () => {
  const { queryClient, updateMember } = await renderSettings();

  await waitForAllergies(queryClient);

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  expect(updateMember).not.toHaveBeenCalled();
});

it("0件確認中のsafe保存後はregisteredを送らず追加成功後に再開する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveNoneUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveNoneUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(registeredMember);
  const addStandardAllergy = vi.fn().mockImplementation(() => {
    allergies = [walnutAllergy];
    return Promise.resolve(walnutAllergy);
  });
  const { queryClient } = await renderSettings({
    listAllergies,
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "registered");

  await act(async () => {
    resolveNoneUpdate?.(member);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(updateMember).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");

  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      "2026-07-11T00:00:00.000Z",
    );
  });
});

it("最初のアレルギー追加成功後に保留したregisteredを保存する", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const { queryClient, updateMember, invalidateSafety } = await renderSettings({
    listAllergies,
    addStandardAllergy,
  });

  await waitForAllergies(queryClient);

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  expect(addStandardAllergy).toHaveBeenCalledWith("member-1", "walnut");
  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    // H8: 追加後 list が非空であること（empty のまま evidence だけで registered を進めない）
    allergies = [walnutAllergy];
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
  });
});

// H8 回帰: soft invalidate が allergies を再取得しても、registered コミット成功後の
// status が「確認しています」に潰されない（E2E menu-domain-pantry chicken allergy）。
it("H8: registered commit success status survives soft allergies invalidate during save", async () => {
  let currentMember: HouseholdMemberRow = member;
  let allergies: MemberAllergyRow[] = [];
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // require-await 回避: Promise を返す同期モックに揃える（同ファイル内の他 H 系テストと同様）
  const listMembers = vi.fn(() => Promise.resolve([currentMember]));
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn(() => {
    allergies = [walnutAllergy];
    return Promise.resolve(walnutAllergy);
  });
  const updateMember = vi.fn((_memberId: string, patch: HouseholdMemberPatch) => {
    currentMember = {
      ...currentMember,
      ...patch,
      updated_at: "2026-07-12T00:00:00.000Z",
    };
    return Promise.resolve(currentMember);
  });
  // 本番 H8 経路: invalidateSafety が allergies / members を stale にして再取得する
  const invalidateSafety = vi.fn(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: householdKeys.members("settings") }),
      queryClient.invalidateQueries({ queryKey: ["household", "allergies", "settings"] }),
      queryClient.invalidateQueries({ queryKey: ["household", "dislikes", "settings"] }),
    ]);
  });
  const api: HouseholdSettingsApi = {
    listMembers,
    createDraft: vi.fn(),
    updateDraft: vi.fn().mockResolvedValue(member),
    updateMember,
    completeMember: vi.fn().mockResolvedValue(member),
    deleteMember: vi.fn().mockResolvedValue(undefined),
    listCatalog: vi.fn().mockResolvedValue(catalog),
    listAllergies,
    addStandardAllergy,
    addCustomAllergy: vi.fn(),
    removeAllergy: vi.fn(),
    listDislikes: vi.fn().mockResolvedValue([]),
    addDislike: vi.fn(),
    removeDislike: vi.fn(),
    invalidateSafety,
  };

  render(
    <QueryClientProvider client={queryClient}>
      <AppToastProvider>
        <HouseholdSettingsForm api={api} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "登録済みの家族" });
  await userEvent.click(screen.getByRole("button", { name: /を編集$/u }));
  await screen.findByRole("region", { name: "家族情報を追加・編集" });
  await waitForAllergies(queryClient);

  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");

  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
  await waitFor(() => {
    expect(invalidateSafety).toHaveBeenCalled();
  });
  // soft invalidate 後も成功 status が残る（「確認しています」で潰されない）
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("最新条件で再確認します");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("アレルギー情報を確認しています");
  expect(screen.getByRole("status")).not.toHaveTextContent("登録ありの場合は1つ以上選んでください");
});

it("既存registered家族はアレルギー取得中でも通常の編集を保存する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  const updateMember = vi.fn().mockResolvedValue(registeredMember);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies: vi.fn(() => new Promise<MemberAllergyRow[]>(() => undefined)),
    updateMember,
  });

  fireEvent.change(await screen.findByLabelText("呼び名"), { target: { value: "保護者" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者", allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

it("標準アレルギー追加失敗時はregisteredも成功表示も保存しない", async () => {
  const addStandardAllergy = vi.fn().mockRejectedValue(new Error("追加失敗"));
  const { queryClient, updateMember } = await renderSettings({ addStandardAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("追加失敗");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
  expect(updateMember).not.toHaveBeenCalled();
});

it("自由登録アレルギー追加成功後に保留したregisteredを保存する", async () => {
  const customRow: MemberAllergyRow = {
    ...walnutAllergy,
    id: "allergy-mango",
    allergen_id: null,
    custom_name: "マンゴー",
    custom_confirmed: true,
  };
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addCustomAllergy = vi.fn().mockImplementation(() => {
    allergies = [customRow];
    return Promise.resolve(customRow);
  });
  const { queryClient, updateMember } = await renderSettings({ listAllergies, addCustomAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  expect(addCustomAllergy).toHaveBeenCalledWith("member-1", "マンゴー", []);
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

it("自由登録INSERT失敗時は入力と確認状態を保持する", async () => {
  let rejectAdd: ((reason?: unknown) => void) | undefined;
  const addCustomAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((_resolve, reject) => {
        rejectAdd = reject;
      }),
  );
  const { queryClient, updateMember } = await renderSettings({ addCustomAllergy });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.type(screen.getByLabelText("別名（カンマ区切り・任意）"), "南国果実");
  await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  await act(async () => {
    rejectAdd?.(new Error("自由登録の追加に失敗しました"));
    await Promise.resolve();
  });

  expect(screen.getByRole("status")).toHaveTextContent("自由登録の追加に失敗しました");
  expect(screen.getByLabelText("自由登録名")).toHaveValue("マンゴー");
  expect(screen.getByLabelText("別名（カンマ区切り・任意）")).toHaveValue("南国果実");
  expect(screen.getByLabelText("一覧にないアレルギーとして登録")).toBeChecked();
  expect(updateMember).not.toHaveBeenCalled();
});

it("自由登録INSERT成功後のregistered保存失敗では入力をクリアする", async () => {
  const customRow: MemberAllergyRow = {
    ...walnutAllergy,
    id: "allergy-mango",
    allergen_id: null,
    custom_name: "マンゴー",
    custom_aliases: ["南国果実"],
    custom_confirmed: true,
  };
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addCustomAllergy = vi.fn().mockImplementation(() => {
    allergies = [customRow];
    return Promise.resolve(customRow);
  });
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  const { queryClient } = await renderSettings({ listAllergies, addCustomAllergy, updateMember });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
  await userEvent.type(screen.getByLabelText("別名（カンマ区切り・任意）"), "南国果実");
  await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
  await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });
  expect(screen.getByLabelText("自由登録名")).toHaveValue("");
  expect(screen.getByLabelText("別名（カンマ区切り・任意）")).toHaveValue("");
  expect(screen.getByLabelText("一覧にないアレルギーとして登録")).not.toBeChecked();
});

it("アレルギー追加中の別フィールド変更を最新snapshotで保存する", async () => {
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const { queryClient, updateMember } = await renderSettings({
    listAllergies,
    addStandardAllergy,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });

  expect(updateMember).not.toHaveBeenCalled();

  await act(async () => {
    allergies = [walnutAllergy];
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        allergy_status: "registered",
        display_name: "更新後",
      }),
      expect.any(String),
    );
  });
});

it("registered保存中の別フィールド変更を後続の最新snapshotで保存する", async () => {
  const firstRegisteredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  const latestRegisteredMember: HouseholdMemberRow = {
    ...firstRegisteredMember,
    display_name: "更新後",
  };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(latestRegisteredMember);
  const { queryClient } = await renderSettings({
    listAllergies: vi.fn().mockResolvedValue([walnutAllergy]),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });

  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });
  expect(updateMember).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirstUpdate?.(firstRegisteredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({
        allergy_status: "registered",
        display_name: "更新後",
      }),
      "2026-07-11T00:00:00.000Z",
    );
  });
  await waitFor(() => {
    expect(screen.getByLabelText("呼び名")).toHaveValue("更新後");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([latestRegisteredMember]);
});

it("完了ロック後はregisteredの後続保存を追加せず最新snapshotで正常終了する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  const latestRegisteredMember: HouseholdMemberRow = {
    ...registeredMember,
    display_name: "更新後",
  };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstUpdate = resolve;
        }),
    )
    .mockResolvedValue(latestRegisteredMember);
  const { queryClient } = await renderSettings({
    listAllergies: vi.fn().mockResolvedValue([walnutAllergy]),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });
  fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });
  await userEvent.click(screen.getByRole("button", { name: "この家族の設定を完了" }));

  await act(async () => {
    resolveFirstUpdate?.(registeredMember);
    await Promise.resolve();
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("region", { name: "家族情報を追加・編集" })).not.toBeInTheDocument();
  });
  expect(updateMember).toHaveBeenLastCalledWith(
    member.id,
    expect.objectContaining({
      allergy_status: "registered",
      display_name: "更新後",
    }),
    expect.any(String),
  );
  expect(queryClient.getQueryData<HouseholdMemberRow[]>(householdKeys.members("settings"))).toEqual(
    [latestRegisteredMember],
  );
});

it("registered保存中のnone変更を後続保存して最終状態へ反映する", async () => {
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveFirstUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<HouseholdMemberRow>((resolve) => {
          resolveFirstUpdate = resolve;
        }),
    )
    .mockResolvedValueOnce(member);
  const { queryClient } = await renderSettings({
    listAllergies: vi.fn().mockResolvedValue([walnutAllergy]),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(1);
  });

  await userEvent.selectOptions(screen.getByLabelText("アレルギーの確認"), "none");
  expect(updateMember).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveFirstUpdate?.(registeredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenNthCalledWith(
      2,
      "member-1",
      expect.objectContaining({ allergy_status: "none" }),
      "2026-07-11T00:00:00.000Z",
    );
  });
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("none");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([member]);
});

it("アレルギー追加中に家族を往復してもregisteredを表示し元の家族だけへ保存する", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  let resolveAdd: ((allergy: MemberAllergyRow) => void) | undefined;
  let allergiesByMember: Record<string, MemberAllergyRow[]> = {
    [member.id]: [],
    [secondMember.id]: [],
  };
  const listAllergies = vi.fn((memberId: string) =>
    Promise.resolve((allergiesByMember[memberId] ?? []).map((row) => ({ ...row }))),
  );
  const addStandardAllergy = vi.fn(
    () =>
      new Promise<MemberAllergyRow>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const updateMember = vi.fn().mockResolvedValue(member);
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies,
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));

  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));
  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");

  await act(async () => {
    allergiesByMember = { ...allergiesByMember, [member.id]: [walnutAllergy] };
    resolveAdd?.(walnutAllergy);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-2",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );
});

it("registered保存中に家族を往復しても成功後の表示とcacheを一致させる", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const registeredMember: HouseholdMemberRow = {
    ...member,
    allergy_status: "registered",
  };
  let resolveUpdate: ((saved: HouseholdMemberRow) => void) | undefined;
  const updateMember = vi.fn(
    () =>
      new Promise<HouseholdMemberRow>((resolve) => {
        resolveUpdate = resolve;
      }),
  );
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn((memberId: string) =>
      Promise.resolve(memberId === "member-1" ? [walnutAllergy] : []),
    ),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });

  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));
  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");

  await act(async () => {
    resolveUpdate?.(registeredMember);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
  });
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([registeredMember, secondMember]);
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-2",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );
});

it("registered保存失敗後に家族を往復してもローカル値を保持する", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    listAllergies: vi.fn((memberId: string) =>
      Promise.resolve(memberId === "member-1" ? [walnutAllergy] : []),
    ),
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });

  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");
  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));

  expect(await screen.findByLabelText("アレルギーの確認")).toHaveValue("registered");
  expect(
    queryClient.getQueryData<HouseholdMemberRow[]>(["household", "members", "settings"]),
  ).toEqual([member, secondMember]);
});

it("アレルギー追加後のregistered保存失敗を成功表示で上書きしない", async () => {
  const updateMember = vi.fn().mockRejectedValue(new Error("家族設定の保存に失敗しました"));
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
  const addStandardAllergy = vi.fn().mockImplementation(() => {
    allergies = [walnutAllergy];
    return Promise.resolve(walnutAllergy);
  });
  const { queryClient } = await renderSettings({
    listAllergies,
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
  });
  expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
});

it.each(["standard", "custom"] as const)(
  "%s追加後のPATCH失敗文言をfallback無効化失敗で上書きしない",
  async (kind) => {
    const registeredMember: HouseholdMemberRow = {
      ...member,
      allergy_status: "registered",
      display_name: "更新後",
    };
    let allergies: MemberAllergyRow[] = [];
    const listAllergies = vi.fn(() => Promise.resolve(allergies.map((row) => ({ ...row }))));
    const updateMember = vi
      .fn()
      .mockRejectedValueOnce(new Error("家族設定の保存に失敗しました"))
      .mockResolvedValueOnce(registeredMember);
    const invalidateSafety = vi
      .fn()
      .mockRejectedValueOnce(new Error("安全条件の無効化に失敗しました"))
      .mockResolvedValue(undefined);
    const addStandardAllergy = vi.fn().mockImplementation(() => {
      allergies = [walnutAllergy];
      return Promise.resolve(walnutAllergy);
    });
    const addCustomAllergy = vi.fn().mockImplementation(() => {
      const customRow: MemberAllergyRow = {
        ...walnutAllergy,
        id: "allergy-mango",
        allergen_id: null,
        custom_name: "マンゴー",
        custom_confirmed: true,
      };
      allergies = [customRow];
      return Promise.resolve(customRow);
    });
    const { queryClient } = await renderSettings({
      listAllergies,
      addCustomAllergy,
      addStandardAllergy,
      invalidateSafety,
      updateMember,
    });

    await waitForAllergies(queryClient);
    await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
    if (kind === "standard") {
      await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
    } else {
      await userEvent.type(screen.getByLabelText("自由登録名"), "マンゴー");
      await userEvent.click(screen.getByLabelText("一覧にないアレルギーとして登録"));
      await userEvent.click(screen.getByRole("button", { name: "自由登録を追加" }));
    }

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("家族設定の保存に失敗しました");
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("安全条件の無効化に失敗しました");
    expect(screen.getByRole("status")).not.toHaveTextContent("最新条件で再確認します");
    expect(updateMember).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
    await waitFor(() => {
      expect(invalidateSafety).toHaveBeenCalledTimes(1);
    });
    if (kind === "custom") {
      await waitFor(() => {
        expect(screen.getByLabelText("自由登録名")).toHaveValue("");
      });
      expect(screen.getByLabelText("一覧にないアレルギーとして登録")).not.toBeChecked();
    }

    fireEvent.change(screen.getByLabelText("呼び名"), { target: { value: "更新後" } });

    await waitFor(() => {
      expect(updateMember).toHaveBeenNthCalledWith(
        2,
        "member-1",
        expect.objectContaining({ allergy_status: "registered", display_name: "更新後" }),
        expect.any(String),
      );
    });
  },
);

it("applies age defaults when the user selects an age band", async () => {
  const { updateMember } = await renderSettings();

  await userEvent.selectOptions(await screen.findByLabelText("年齢のめやす"), "age_3_5");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({
        age_band: "age_3_5",
        ease_preferences: ["small_pieces", "boneless", "soft"],
        required_safety_constraints: ["remove_bones", "cut_small"],
      }),
      expect.any(String),
    );
  });
});

it("persists an edit that only changes the display name", async () => {
  const { updateMember } = await renderSettings();
  const input = await screen.findByLabelText("呼び名");

  fireEvent.change(input, { target: { value: "保護者" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      "member-1",
      expect.objectContaining({ display_name: "保護者" }),
      expect.any(String),
    );
  });
});

it("keeps newer local edits when an older save response updates the member query", async () => {
  let resolveFirstSave: ((member: HouseholdMemberRow) => void) | undefined;
  const firstSave = new Promise<HouseholdMemberRow>((resolve) => {
    resolveFirstSave = resolve;
  });
  const updateMember = vi.fn().mockReturnValue(firstSave);
  await renderSettings({ updateMember });
  const input = await screen.findByLabelText("呼び名");

  fireEvent.change(input, { target: { value: "最初の入力" } });
  fireEvent.change(input, { target: { value: "新しい入力" } });
  resolveFirstSave?.({ ...member, display_name: "最初の入力" });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(input).toHaveValue("新しい入力");
  });
});

it("keeps the latest local snapshot after a queued success then failure", async () => {
  const updateMember = vi
    .fn()
    .mockImplementationOnce((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    )
    .mockRejectedValueOnce(new Error("後の保存に失敗しました"));
  const { queryClient } = await renderSettings({ updateMember });
  const displayName = await screen.findByLabelText("呼び名");

  fireEvent.change(displayName, { target: { value: "保護者" } });
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByRole("status")).toHaveTextContent("後の保存に失敗しました");
  expect(displayName).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [
      { ...member, display_name: "外部更新", spice_level: "regular" },
    ]);
    await Promise.resolve();
  });
  expect(displayName).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
});

it("clears a failed local snapshot after the next queued full save succeeds", async () => {
  const updateMember = vi
    .fn()
    .mockRejectedValueOnce(new Error("先の保存に失敗しました"))
    .mockImplementationOnce((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    );
  const { queryClient } = await renderSettings({ updateMember });
  const displayName = await screen.findByLabelText("呼び名");

  fireEvent.change(displayName, { target: { value: "保護者" } });
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledTimes(2);
  });
  expect(updateMember.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ display_name: "保護者", spice_level: "mild" }),
  );
  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [
      { ...member, display_name: "外部更新", spice_level: "none" },
    ]);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(displayName).toHaveValue("外部更新");
    expect(screen.getByLabelText("辛さ")).toHaveValue("none");
  });
});

it("uses the latest member query values after switching away and back", async () => {
  const secondMember: HouseholdMemberRow = {
    ...member,
    id: "member-2",
    display_name: "子ども",
    sort_order: 1,
  };
  const latestMember: HouseholdMemberRow = {
    ...member,
    display_name: "保護者",
    portion_size: "large",
    spice_level: "mild",
    updated_at: "2026-07-18T00:00:00.000Z",
  };
  const updateMember = vi.fn().mockResolvedValue(latestMember);
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([member, secondMember]),
    updateMember,
  });

  expect(await screen.findByLabelText("呼び名")).toHaveValue("大人");
  await userEvent.click(screen.getByRole("button", { name: "2人目の子どもを編集" }));
  expect(await screen.findByLabelText("呼び名")).toHaveValue("子ども");

  await act(async () => {
    queryClient.setQueryData(householdKeys.members("settings"), [latestMember, secondMember]);
    await Promise.resolve();
  });
  await userEvent.click(screen.getByRole("button", { name: "1人目の大人を編集" }));

  expect(await screen.findByLabelText("呼び名")).toHaveValue("保護者");
  expect(screen.getByLabelText("辛さ")).toHaveValue("mild");
  await userEvent.selectOptions(screen.getByLabelText("食べる量"), "small");

  await waitFor(() => {
    expect(updateMember).toHaveBeenCalledWith(
      member.id,
      expect.objectContaining({
        display_name: "保護者",
        portion_size: "small",
        spice_level: "mild",
      }),
      expect.any(String),
    );
  });
});

// H1: allergies list error でも residual 未確認警告を出す（empty fallback で消さない）
it("H1: shows residual unverified warning when allergy list fails on none status", async () => {
  const listAllergies = vi.fn().mockRejectedValue(new Error("list failed"));
  await renderSettings({ listAllergies });

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent("アレルギー情報を読み込めませんでした");
  });
  // なしのまま一覧 error → residual 断定不能の警告
  expect(
    screen.getByText(/アレルギー一覧を確認できないため、以前の登録が残っている可能性/u),
  ).toBeVisible();
});

// H1: success で residual 行があるときの従来警告
it("H1: shows residual warning when none status still has allergies", async () => {
  await renderSettings({
    listAllergies: vi.fn().mockResolvedValue([standardAllergy]),
  });
  await waitFor(() => {
    expect(screen.getByText(/以前登録したアレルギーが残っています/u)).toBeVisible();
  });
});

// H5: silent delete 後に行が残る場合は利用者へ説明
it("H5: surfaces delete miss when allergy row remains after RPC success", async () => {
  const registeredMember = { ...member, allergy_status: "registered" as const };
  const customAllergy: MemberAllergyRow = {
    ...standardAllergy,
    id: "allergy-custom",
    allergen_id: null,
    custom_name: "えんどう豆たんぱく",
    custom_confirmed: true,
  };
  // 削除後も両方残る（silent success）
  const listAllergies = vi.fn().mockResolvedValue([standardAllergy, customAllergy]);
  const removeAllergy = vi.fn().mockResolvedValue(undefined);
  await renderSettings({
    listMembers: vi.fn().mockResolvedValue([registeredMember]),
    listAllergies,
    removeAllergy,
  });

  await userEvent.click(await screen.findByRole("button", { name: "くるみを削除" }));

  await waitFor(() => {
    expect(removeAllergy).toHaveBeenCalledWith(standardAllergy.id);
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("アレルギーの削除を反映できませんでした");
  });
});

// H12: draft でも empty registered を DB に即書きせず、初回アレルゲン追加で commit（onboarding H13 と同方向）
it("H12: defers empty registered allergy_status on draft until first allergen is added", async () => {
  const draft: HouseholdMemberRow = {
    ...member,
    id: "draft-h12",
    status: "draft",
    display_name: "子ども",
    age_band: "adult",
    allergy_status: "none",
    unsupported_diet_status: "none",
  };
  let allergies: MemberAllergyRow[] = [];
  const listAllergies = vi.fn(() => Promise.resolve(allergies));
  const draftAllergy = { ...standardAllergy, id: "allergy-draft-h12", member_id: draft.id };
  const addStandardAllergy = vi.fn().mockImplementation(() => {
    allergies = [draftAllergy];
    return Promise.resolve(draftAllergy);
  });
  const updateDraft = vi
    .fn()
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...draft, ...patch }),
    );
  const { queryClient } = await renderSettings({
    listMembers: vi.fn().mockResolvedValue([draft]),
    listAllergies,
    addStandardAllergy,
    updateDraft,
  });

  await waitForAllergies(queryClient, draft.id);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  // UI は registered でも、証拠なしでは draft に registered を書かない
  await waitFor(() => {
    expect(screen.getByLabelText("アレルギーの確認")).toHaveValue("registered");
  });
  expect(updateDraft).not.toHaveBeenCalledWith(
    draft.id,
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );
  expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");

  // 他項目は旧 allergy_status のまま保存できる
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({ spice_level: "mild", allergy_status: "none" }),
      expect.any(String),
    );
  });
  const earlyRegistered = updateDraft.mock.calls.filter((call) => {
    const patch = call[1] as HouseholdMemberPatch;
    return patch.allergy_status === "registered";
  });
  expect(earlyRegistered).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalledWith(draft.id, "walnut");
  });
  await waitFor(() => {
    expect(updateDraft).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({ allergy_status: "registered" }),
      expect.any(String),
    );
  });
});

// H8: 追加後も一覧 empty なら registered を確定しない
it("H8: does not save registered when allergy-insert leaves empty list", async () => {
  const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
  // 追加後も list は常に空（競合削除・再取得 empty）
  const listAllergies = vi.fn().mockResolvedValue([]);
  const { queryClient, updateMember } = await renderSettings({
    listAllergies,
    addStandardAllergy,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));

  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  });
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );
});

// H-R1: allergy-insert（list 確認前）中の form 編集が registered PATCH を起こさない
it("H-R1: does not save registered while allergy-insert list confirmation is in flight", async () => {
  let holdList = false;
  let resolveHeldList: ((rows: MemberAllergyRow[]) => void) | undefined;
  const listAllergies = vi.fn(() => {
    if (holdList) {
      return new Promise<MemberAllergyRow[]>((resolve) => {
        resolveHeldList = resolve;
      });
    }
    return Promise.resolve([]);
  });
  const addStandardAllergy = vi.fn().mockResolvedValue(walnutAllergy);
  const updateMember = vi
    .fn()
    .mockImplementation((_memberId: string, patch: HouseholdMemberPatch) =>
      Promise.resolve({ ...member, ...patch }),
    );
  const { queryClient } = await renderSettings({
    listAllergies,
    addStandardAllergy,
    updateMember,
  });

  await waitForAllergies(queryClient);
  await userEvent.selectOptions(await screen.findByLabelText("アレルギーの確認"), "registered");

  // finalizeAllergyChange の fetchQuery 窓を止める（allergy-insert 期間）
  holdList = true;
  await userEvent.click(screen.getByRole("button", { name: "くるみを追加" }));
  await waitFor(() => {
    expect(addStandardAllergy).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(resolveHeldList).toBeTypeOf("function");
  });

  // 窓中に基本情報を触っても registered は確定しない（H-R1）
  fireEvent.change(screen.getByLabelText("辛さ"), { target: { value: "mild" } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );

  // list empty で H8 どおり registered を止める
  await act(async () => {
    resolveHeldList?.([]);
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(screen.getByRole("status")).toHaveTextContent("登録ありの場合は1つ以上選んでください");
  });
  expect(updateMember).not.toHaveBeenCalledWith(
    "member-1",
    expect.objectContaining({ allergy_status: "registered" }),
    expect.any(String),
  );
});
