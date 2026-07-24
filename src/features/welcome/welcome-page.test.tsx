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

it("3枚の説明を順番に表示し、先頭と末尾では進めない向きを無効にする", async () => {
  const user = userEvent.setup();
  render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 1, name: "どちらから始めますか？" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 2, name: "質問に答えて、献立を作れます" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/かんたんな質問に答えるだけで献立アイデア/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "戻る" })).toBeDisabled();
  expect(screen.getByLabelText("チュートリアル 1 / 3")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "家族情報は、あとからでも登録できます",
    }),
  ).toHaveFocus();
  expect(screen.getByText(/家族情報の登録は任意/)).toBeInTheDocument();
  expect(screen.getByLabelText("チュートリアル 2 / 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "戻る" })).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "次へ" }));
  expect(
    screen.getByRole("heading", {
      level: 2,
      name: "献立を見返して、買い物にもつなげられます",
    }),
  ).toHaveFocus();
  expect(screen.getByText(/履歴からいつでも見返せます/)).toBeInTheDocument();
  expect(screen.getByText(/買い物リストにできます/)).toBeInTheDocument();
  expect(screen.getByLabelText("チュートリアル 3 / 3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "次へ" })).toBeDisabled();
});

it("どの説明からでも2つの開始操作を使える", async () => {
  const user = userEvent.setup();
  const onStartIdea = vi.fn().mockResolvedValue(undefined);
  const onStartHousehold = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={onStartIdea}
      onStartHousehold={onStartHousehold}
    />,
  );

  await user.click(screen.getByRole("button", { name: "次へ" }));
  await user.click(screen.getByRole("button", { name: "次へ" }));

  expect(screen.getByRole("button", { name: "献立アイデアを考える" })).toBeVisible();
  expect(screen.getByRole("button", { name: "家族情報を登録する" })).toBeVisible();
  expect(container.querySelectorAll(".primary-button")).toHaveLength(1);
  expect(container.querySelectorAll(".secondary-button")).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "献立アイデアを考える" }));
  await user.click(screen.getByRole("button", { name: "家族情報を登録する" }));
  expect(onStartIdea).toHaveBeenCalledOnce();
  expect(onStartHousehold).toHaveBeenCalledOnce();
});

it("現在位置をスクリーンリーダーへ伝え、戻る操作でも見出しへフォーカスする", async () => {
  const user = userEvent.setup();
  render(
    <WelcomePage
      onboardingStatus="not_started"
      onStartIdea={vi.fn().mockResolvedValue(undefined)}
      onStartHousehold={vi.fn().mockResolvedValue(undefined)}
    />,
  );

  expect(screen.getByText("1", { selector: '[aria-current="step"]' })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "次へ" }));
  await user.click(screen.getByRole("button", { name: "戻る" }));
  expect(
    screen.getByRole("heading", { level: 2, name: "質問に答えて、献立を作れます" }),
  ).toHaveFocus();
  expect(screen.getByText("1", { selector: '[aria-current="step"]' })).toBeInTheDocument();
});
