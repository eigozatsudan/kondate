import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import {
  createPendingGeneration,
  readPendingGeneration,
  savePendingGeneration,
} from "@/features/generation/model/pending-generation";
import { privacyNoticeVersion } from "@shared/contracts/domain";
import { WeeklyPlanResultPage } from "./weekly-plan-result-page";
import { DraftRevisionConflictError, plannerKeys } from "../../planner/planner-api";

const getWeeklyPlanByIdMock = vi.hoisted(() => vi.fn());
const getPlannerDraftMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const getGenerationStatusMock = vi.hoisted(() => vi.fn());
const savePendingGenerationMetaMock = vi.hoisted(() => vi.fn());

vi.mock("../weekly-plan-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../weekly-plan-api")>();
  return { ...original, getWeeklyPlanById: getWeeklyPlanByIdMock };
});

vi.mock("../../planner/planner-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../planner/planner-api")>();
  return {
    ...original,
    getPlannerDraft: getPlannerDraftMock,
    savePlannerDraft: saveMock,
  };
});

// 即生成経路の既存 pending reconcile でだけ呼ばれる。実 fetch はさせない。
vi.mock("../../generation/api/generation-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../generation/api/generation-api")>();
  return { ...original, getGenerationStatus: getGenerationStatusMock };
});

// meta 保存失敗経路を作るため save のみ差し替える（read/clear は実装のまま）。
vi.mock("../../generation/model/pending-generation-meta", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../generation/model/pending-generation-meta")>();
  return { ...original, savePendingGenerationMeta: savePendingGenerationMetaMock };
});

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router")>();
  return { ...original, useNavigate: () => navigateMock };
});

type SampleDay = {
  dayIndex: number;
  label: string;
  mainName: string;
  sideName: string | null;
  ingredients: string[];
  notes: string | null;
};

function makeDay(overrides: Partial<SampleDay> = {}): SampleDay {
  return {
    dayIndex: 1,
    label: "月",
    mainName: "鶏の照り焼き",
    sideName: null,
    ingredients: ["鶏もも肉"],
    notes: null,
    ...overrides,
  };
}

const dayLabels = ["月", "火", "水", "木", "金", "土", "日"];
const dayMains = [
  "鶏の照り焼き",
  "豚肉の生姜焼き",
  "鮭の塩焼き",
  "麻婆豆腐",
  "カレーライス",
  "餃子",
  "おでん",
];

function makeSampleDays(): SampleDay[] {
  return [1, 2, 3, 4, 5, 6, 7].map((dayIndex) =>
    makeDay({
      dayIndex,
      label: dayLabels[dayIndex - 1]!,
      mainName: dayMains[dayIndex - 1]!,
      ingredients: [`具材${String(dayIndex)}`],
    }),
  );
}

const samplePlan = {
  weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  weekStartJst: "2026-09-07",
  days: makeSampleDays(),
  targetMemberIds: ["m1"],
  cuisineGenre: "japanese" as const,
  budgetPreference: null,
  noveltyPreference: null,
  priorityIngredients: [] as string[],
  partialHousehold: false,
  staleSafety: false,
};

// createPendingGeneration は ownerUserId に uuid を要求するため、
// 即生成パスを通るテストでは実 uuid の userId を使う。
const uuidUserId = "11111111-1111-4111-8111-111111111111";

// savePlannerDraft の解決値。startDayGeneration は id（uuid）・revision・targetMode を使う。
function savedDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    revision: 1,
    targetMode: "household",
    ...overrides,
  };
}

function renderPage(options?: {
  currentCompleteMemberIds?: readonly string[];
  client?: QueryClient;
  userId?: string;
}) {
  const userId = options?.userId ?? "u1";
  const client =
    options?.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/weekly/33333333-3333-4333-8333-333333333333"]}>
        <WeeklyPlanResultPage
          accessToken="tok"
          weeklyPlanId={samplePlan.weeklyPlanId}
          userId={userId}
          currentCompleteMemberIds={options?.currentCompleteMemberIds ?? ["m1"]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WeeklyPlanResultPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mockClear は実装を消さないため、throw/未解決にさせた実装が後続テストへ
    // 漏れないよう明示 reset。
    savePendingGenerationMetaMock.mockReset();
    saveMock.mockReset();
    // 即生成経路は localStorage に sticky pending を書く。テスト間で持ち越さない。
    localStorage.clear();
    sessionStorage.clear();
    getGenerationStatusMock.mockResolvedValue({ status: "processing" });
  });

  it("renders 7 days and hands off a day to the planner draft", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("鶏の照り焼き")).toHaveLength(1);
    });
    const buttons = screen.getAllByRole("button", { name: "この日の献立を作る" });
    expect(buttons).toHaveLength(7);
    await userEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    const [, , input] = saveMock.mock.calls[0] as [unknown, string, { mealType: string }];
    expect(input.mealType).toBe("dinner");
  });

  it("shows the partialHousehold notice when true", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({ ...samplePlan, partialHousehold: true });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText("外した家族の条件は見ていません。全員分を作るには作り直してください"),
      ).toBeInTheDocument();
    });
  });

  it("shows the staleSafety notice when true, and keeps the day CTA enabled", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({ ...samplePlan, staleSafety: true });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByText("家族の設定が変わっています。作り直してください"),
      ).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "この日の献立を作る" })[0]).toBeEnabled();
  });

  it("renders day notes only when present", async () => {
    const withNotes = {
      ...samplePlan,
      days: samplePlan.days.map((day: SampleDay, index: number) =>
        index === 0 ? { ...day, notes: "冷凍保存できます" } : day,
      ),
    };
    getWeeklyPlanByIdMock.mockResolvedValue(withNotes);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("冷凍保存できます")).toBeInTheDocument();
    });
    // 他の6日は notes が null なので描画されない
    expect(screen.queryAllByText("冷凍保存できます")).toHaveLength(1);
  });

  it("renders day headings sorted by dayIndex even when the API returns days out of order, and navigates to /generation after handoff", async () => {
    const shuffledPlan = { ...samplePlan, days: [...samplePlan.days].reverse() };
    getWeeklyPlanByIdMock.mockResolvedValue(shuffledPlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage({ userId: uuidUserId });
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(7);
    });
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(dayLabels);

    const buttons = screen.getAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
  });

  it("mints a new_menu pending generation for the clicked day and navigates to /generation", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
    const pending = readPendingGeneration(uuidUserId, new Date());
    // request は kind 別の union。narrow しないと draftId へアクセスできない。
    expect(pending?.kind).toBe("new_menu");
    if (pending?.kind === "new_menu") {
      expect(pending.request.draftId).toBe(savedDraft().id);
      // 引き継ぎ下書きは pantry 非連携なので当日確認は空固定
      expect(pending.request.expiredPantryConfirmations).toEqual([]);
    }
  });

  it("navigates to the planner review screen via 条件を変えて作る", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "条件を変えて作る" });
    expect(buttons).toHaveLength(7);
    await userEvent.click(buttons[1]!);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    expect(navigateMock).toHaveBeenCalledWith("/planner?resume=review");
  });

  it("resumes an in-flight pending generation instead of overwriting it", async () => {
    // 先に別の生成 pending を sticky に残す（C2: 上書きしない）
    const existing = createPendingGeneration(
      {
        commandVersion: "generation-command.v3",
        kind: "new_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "99999999-9999-4999-8999-999999999999",
          draftId: "44444444-4444-4444-8444-444444444444",
          draftRevision: 1,
          privacyNoticeVersion,
          expiredPantryConfirmations: [],
        },
      },
      uuidUserId,
    );
    savePendingGeneration(existing);
    // reconcile: processing → kept → 既存 pending の再開画面へ
    getGenerationStatusMock.mockResolvedValue({ status: "processing" });
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation?resumed=1");
    });
    // 下書きは保存されるが、sticky pending は既存のまま（idempotencyKey が変わらない）
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(readPendingGeneration(uuidUserId, new Date())?.request.idempotencyKey).toBe(
      "99999999-9999-4999-8999-999999999999",
    );
  });

  it("clears a terminal pending and mints a fresh one for the clicked day", async () => {
    // terminal 済みの stale pending を残す（前回生成の残骸。reconcile が cleared にする）
    const stale = createPendingGeneration(
      {
        commandVersion: "generation-command.v3",
        kind: "new_menu",
        qualityMode: false,
        request: {
          idempotencyKey: "99999999-9999-4999-8999-999999999999",
          draftId: "55555555-5555-4555-8555-555555555555",
          draftRevision: 3,
          privacyNoticeVersion,
          expiredPantryConfirmations: [],
        },
      },
      uuidUserId,
    );
    savePendingGeneration(stale);
    getGenerationStatusMock.mockResolvedValue({ status: "succeeded" });
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
    const pending = readPendingGeneration(uuidUserId, new Date());
    expect(pending?.kind).toBe("new_menu");
    if (pending?.kind === "new_menu") {
      // stale key ではなく、今回保存した下書き pin + 新規 idempotencyKey で mint される
      expect(pending.request.draftId).toBe(savedDraft().id);
      expect(pending.request.idempotencyKey).not.toBe("99999999-9999-4999-8999-999999999999");
    }
  });

  it("clears the minted pending and falls back to /planner?resume=review when meta save fails", async () => {
    savePendingGenerationMetaMock.mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue(savedDraft());

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/planner?resume=review");
    });
    // body→meta 非アトミック: meta 失敗時は sticky ごと消す（planner-route と同型）
    expect(readPendingGeneration(uuidUserId, new Date())).toBeNull();
  });

  it("shows the priority ingredients chosen at creation time", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({
      ...samplePlan,
      priorityIngredients: ["鶏むね肉", "キャベツ"],
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("優先的に使う食材: 鶏むね肉・キャベツ")).toBeInTheDocument();
    });
  });

  it("hands off the confirmed day's data after an overwrite confirmation, not a stale one", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    // targetMode: "idea" は draftNeedsOverwriteConfirmation を無条件に true にする既存下書き
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });
    saveMock.mockResolvedValue(savedDraft({ revision: 6 }));

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    expect(buttons).toHaveLength(7);
    await userEvent.click(buttons[6]!); // 7日目（日）

    const confirmButton = await screen.findByRole("button", { name: "置き換える" });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(1);
    });
    const [, , input] = saveMock.mock.calls[0] as [unknown, string, { memo: string }];
    expect(input.memo).toBe(`主菜: ${dayMains[6]!}`);
  });

  // pendingConfirm は { dayIndex, target } を保持する。「条件を変えて作る」起点の
  // 確認確定が即生成へ流れる退行（target 落ち）を防ぐため、遷移先まで検証する。
  it("keeps the planner-review target through the overwrite confirmation", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    // targetMode: "idea" の既存下書きは draftNeedsOverwriteConfirmation を無条件に true にする
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });
    saveMock.mockResolvedValue(savedDraft({ revision: 6 }));

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "条件を変えて作る" });
    await userEvent.click(buttons[0]!);

    const confirmButton = await screen.findByRole("button", { name: "置き換える" });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/planner?resume=review");
    });
    // 確認経路では生成 pending を mint しない（uuid ユーザーで /generation 未遷移も担保）
    expect(readPendingGeneration(uuidUserId, new Date())).toBeNull();
    expect(navigateMock).not.toHaveBeenCalledWith("/generation");
  });

  // 確認経由の即生成側も同じく target 維持を検証する。確認無し経路の mint テストは
  // 上にあるため、ここでは「置き換える」確定後に pending mint → /generation までを通す。
  it("keeps the generate target through the overwrite confirmation", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });
    saveMock.mockResolvedValue(savedDraft({ revision: 6 }));

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    const confirmButton = await screen.findByRole("button", { name: "置き換える" });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/generation");
    });
    const pending = readPendingGeneration(uuidUserId, new Date());
    expect(pending?.kind).toBe("new_menu");
    if (pending?.kind === "new_menu") {
      expect(pending.request.draftId).toBe(savedDraft().id);
      expect(pending.request.draftRevision).toBe(6);
    }
    // meta は targetMode: household で保存される（引き継ぎ下書きは household 固定）
    expect(savePendingGenerationMetaMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "new_menu", targetMode: "household" }),
    );
  });

  // 追加前確認ダイアログと同型のフォーカス管理: 開いたら主ボタンへ、
  // キャンセルで閉じたら元の CTA へ戻す。
  it("restores focus to the clicked CTA when the overwrite dialog is cancelled", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    const trigger = buttons[2]!;
    await userEvent.click(trigger);

    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: "置き換える" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "やめる" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("closes the overwrite dialog on Escape without saving", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue({ targetMode: "idea", revision: 5 });

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  // handoff 中は全 CTA が disabled になるだけでなく status を出す
  // （既存 pending の reconcile が状態確認 GET を伴い、待ちが長くなり得るため）。
  it("shows a busy status while the handoff is in progress", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    let resolveSave: ((value: unknown) => void) | undefined;
    saveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderPage({ userId: uuidUserId });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    expect(await screen.findByRole("status")).toHaveTextContent("献立の作成準備をしています…");

    resolveSave?.(savedDraft());
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
  });

  it("shows an error when no household member is eligible for handoff", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    renderPage({ currentCompleteMemberIds: [] });

    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(
        screen.getByText("引き継ぎできる家族がいません。作り直してください。"),
      ).toBeInTheDocument();
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  // F-1: spec §4.3「日次と同じ安全性注記」。文言のハードコピーではなく共有定数で検証する。
  it("shows the shared safety disclaimer used by the daily/flyer menus", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(MENU_LABEL_DISCLAIMER)).toBeInTheDocument();
    });
  });

  // F-3: P-11 の主見出しが対象人数を表示すること
  it("shows the partial-household member count in the h1 when partialHousehold is true", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue({
      ...samplePlan,
      partialHousehold: true,
      targetMemberIds: ["m1", "m2"],
    });
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 1, name: "2 人分の今週の献立" }),
      ).toBeInTheDocument();
    });
  });

  // F-4: I-1 で追加した invalidateQueries が実際に呼ばれること
  it("invalidates the planner draft query after a successful handoff", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValue(null);
    saveMock.mockResolvedValue({ revision: 1 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderPage({ client });
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: plannerKeys.draft("u1") });
    });
  });

  // F-4: DraftRevisionConflictError 時の1回リトライ
  it("retries the save once after a DraftRevisionConflictError, using the refreshed revision", async () => {
    getWeeklyPlanByIdMock.mockResolvedValue(samplePlan);
    getPlannerDraftMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      targetMode: "household",
      mealType: "",
      mainIngredients: [],
      cuisineGenre: "",
      targetMemberIds: [],
      servings: null,
      timeLimitMinutes: null,
      budgetPreference: null,
      ingredientPreference: null,
      noveltyPreference: null,
      avoidIngredients: [],
      memo: "",
      pantrySelections: [],
      revision: 9,
    });
    saveMock
      .mockRejectedValueOnce(new DraftRevisionConflictError())
      .mockResolvedValueOnce({ revision: 10 });

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: "この日の献立を作る" });
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledTimes(2);
    });
    const secondCall = saveMock.mock.calls[1] as [unknown, string, unknown, number];
    expect(secondCall[3]).toBe(9);
  });
});
