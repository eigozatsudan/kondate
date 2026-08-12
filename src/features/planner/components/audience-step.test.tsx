import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PLANNER_TARGET_MEMBER_LIMIT } from "@shared/contracts/planner";
import { AppToastProvider } from "@/shared/ui/app-toast";
import type { PlannerSafetyMember } from "../planner-safety-member";
import { AudienceStep } from "./audience-step";

const memberA: PlannerSafetyMember = {
  id: "70000000-0000-4000-8000-000000000001",
  displayName: "はな",
  ageBandLabel: "大人",
  allergyLabel: "卵",
  safetyLabels: [],
  blockedReason: null,
};

const memberB: PlannerSafetyMember = {
  id: "70000000-0000-4000-8000-000000000002",
  displayName: "そら",
  ageBandLabel: "幼児",
  allergyLabel: "アレルギーなし",
  safetyLabels: [],
  blockedReason: null,
};

function renderAudience(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AppToastProvider>{ui}</AppToastProvider>
    </MemoryRouter>,
  );
}

describe("AudienceStep layout and selected safety summary", () => {
  it("orders idea radio before household", () => {
    renderAudience(
      <AudienceStep
        value={{ targetMode: null, targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(radios[0]).toHaveAccessibleName(/人数だけ/);
    expect(radios[1]).toHaveAccessibleName(/家族に合わせて/);
  });

  it("summary lists only selected members under checkboxes", () => {
    renderAudience(
      <AudienceStep
        value={{
          targetMode: "household",
          targetMemberIds: [memberA.id],
          servings: null,
        }}
        eligibleMembers={[memberA, memberB]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    // チェック群は A/B 両方。サマリー領域は選択した A のみ。
    expect(screen.getByRole("checkbox", { name: /はな/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /そら/ })).toBeInTheDocument();

    const summary = screen.getByRole("region", { name: "現在の家族・安全条件" });
    expect(within(summary).getByText("はな")).toBeVisible();
    expect(within(summary).queryByText("そら")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "ここに出ている条件だけが献立に使われます。選んでいない家族は含まれません。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "一覧の表示は選ぶときの参考です。チェックしていない人の条件は献立に入りません。",
      ),
    ).toBeInTheDocument();
  });

  it("household zero selection shows empty fixed body", () => {
    renderAudience(
      <AudienceStep
        value={{ targetMode: "household", targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(
      screen.getByText("家族を選ぶと、その人の条件がここに表示されます。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /家族設定を変更/ })).toBeInTheDocument();
    expect(screen.getByText("献立に合わせる家族を1人以上選んでください")).toBeInTheDocument();
  });

  it("P8: targetMemberIds onChange は LIMIT 超を slice する（disable 回避の連打相当）", () => {
    const members: PlannerSafetyMember[] = Array.from(
      { length: PLANNER_TARGET_MEMBER_LIMIT + 1 },
      (_, index) => ({
        id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        displayName: `家族${String(index + 1)}`,
        ageBandLabel: "大人",
        allergyLabel: "アレルギーなし",
        safetyLabels: [],
        blockedReason: null,
      }),
    );
    const selectedIds = members.slice(0, PLANNER_TARGET_MEMBER_LIMIT).map((member) => member.id);
    const onChange = vi.fn();
    renderAudience(
      <AudienceStep
        value={{
          targetMode: "household",
          targetMemberIds: selectedIds,
          servings: null,
        }}
        eligibleMembers={members}
        onChange={onChange}
        onNext={vi.fn()}
      />,
    );

    const overflow = screen.getByRole("checkbox", {
      name: new RegExp(members[PLANNER_TARGET_MEMBER_LIMIT]!.displayName),
    });
    expect(overflow).toBeDisabled();
    // UI disable をすり抜ける経路でも live 配列が LIMIT を超えないこと
    overflow.removeAttribute("disabled");
    fireEvent.click(overflow);

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as { targetMemberIds: string[] };
    expect(next.targetMemberIds).toHaveLength(PLANNER_TARGET_MEMBER_LIMIT);
    expect(next.targetMemberIds).not.toContain(members[PLANNER_TARGET_MEMBER_LIMIT]!.id);
  });
});

describe("AudienceStep incomplete UX", () => {
  it("household zero next: toast+alert+focus members group", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderAudience(
      <AudienceStep
        value={{ targetMode: "household", targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={onNext}
      />,
    );
    const next = screen.getByRole("button", { name: "次へ" });
    expect(next).not.toBeDisabled();
    await user.click(next);
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "献立に合わせる家族を1人以上選んでください",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "献立に合わせる家族を1人以上選んでください",
    );
    // focus はメンバー checkbox 群（mode radio ではない）
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("mode null next focuses mode radiogroup", async () => {
    const user = userEvent.setup();
    renderAudience(
      <AudienceStep
        value={{ targetMode: null, targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("作る相手の選び方を選んでください");
    expect(screen.getAllByRole("radio")[0]).toHaveFocus();
  });

  it("idea servings null next focuses person chips", async () => {
    const user = userEvent.setup();
    renderAudience(
      <AudienceStep
        value={{ targetMode: "idea", targetMemberIds: [], servings: null }}
        eligibleMembers={[]}
        onChange={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("人数を選んでください");
    expect(screen.getByRole("button", { name: "1人" })).toHaveFocus();
  });

  it("incomplete with suppressValidationToast: alert+focus only, no status toast", async () => {
    const user = userEvent.setup();
    renderAudience(
      <AudienceStep
        value={{ targetMode: null, targetMemberIds: [], servings: null }}
        eligibleMembers={[memberA]}
        onChange={vi.fn()}
        onNext={vi.fn()}
        suppressValidationToast
      />,
    );
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
