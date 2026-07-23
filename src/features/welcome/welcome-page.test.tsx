import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { expect, it, vi } from "vitest";
import { WelcomePage } from "./welcome-page";

// WelcomePage は onboardingStatus によって表示する導線が変わるだけの薄い表示コンポーネントとし、
// setOnboardingStatus / navigate の実際の呼び出し順は router 層のテストで固定する。
// ここでは Props 契約（brief の WelcomePageProps）だけを検証する。

it("not_started では「献立アイデアを考える」と「家族情報を登録する」を表示する", () => {
  render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "家族情報を登録する" })).toBeInTheDocument();
});

it("in_progress では「設定せず献立アイデアを考える」と「家族設定を続ける」を表示する", () => {
  render(
    <WelcomePage
      onboardingStatus="in_progress"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(screen.getByRole("button", { name: "設定せず献立アイデアを考える" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "家族設定を続ける" })).toBeInTheDocument();
});

it("idea 導線をクリックすると onStartIdea を呼ぶ", async () => {
  const user = userEvent.setup();
  const onStartIdea = vi.fn().mockResolvedValue(undefined);
  render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={onStartIdea}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
  expect(onStartIdea).toHaveBeenCalledOnce();
});

it("家族導線をクリックすると onStartHousehold を呼ぶ", async () => {
  const user = userEvent.setup();
  const onStartHousehold = vi.fn().mockResolvedValue(undefined);
  render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={onStartHousehold}
    />,
  );
  await user.click(screen.getByRole("button", { name: "家族情報を登録する" }));
  expect(onStartHousehold).toHaveBeenCalledOnce();
});

it.each(["complete", "skipped"] as const)(
  "%s で /welcome へ直接アクセスした場合は操作を表示せず /planner へ replace redirect する",
  async (status) => {
    const router = createMemoryRouter(
      [
        {
          path: "/welcome",
          element: (
            <WelcomePage
              onboardingStatus={status}
              onStartIdea={vi.fn().mockResolvedValue(undefined)}
              onStartHousehold={vi.fn().mockResolvedValue(undefined)}
            />
          ),
        },
        { path: "/planner", element: <h1>献立</h1> },
      ],
      { initialEntries: ["/welcome"] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/planner");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);

it("表示ルートに .guided-planner-theme を付与する", () => {
  const { container } = render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(container.querySelector(".guided-planner-theme")).not.toBeNull();
});
