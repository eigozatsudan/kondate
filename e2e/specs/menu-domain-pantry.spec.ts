import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/auth";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPantryPriority(body: Readonly<Record<string, unknown>>, priority: string): boolean {
  const selections = body.p_pantry_selections;
  return (
    Array.isArray(selections) &&
    selections.some((selection) => isRecord(selection) && selection.priority === priority)
  );
}

async function updatePlannerAndAwaitAutosave(
  page: Page,
  update: () => Promise<unknown>,
  matchesBody: (body: Readonly<Record<string, unknown>>) => boolean,
): Promise<void> {
  const saveResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    const postData = response.request().postData();
    if (
      response.request().method() === "POST" &&
      url.pathname.endsWith("/rest/v1/rpc/save_generation_draft") &&
      postData !== null
    ) {
      const body = JSON.parse(postData) as unknown;
      return isRecord(body) && matchesBody(body);
    }
    return false;
  });
  await update();
  await expect(page.getByText("保存中…", { exact: true })).toBeVisible();
  expect((await saveResponse).ok()).toBe(true);
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
}

async function savePlannerMeal(page: Page, mealName: "朝食" | "昼食" | "夕食"): Promise<void> {
  await page.goto("/planner");
  const mealType = { 朝食: "breakfast", 昼食: "lunch", 夕食: "dinner" }[mealName];
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByRole("radio", { name: mealName }).check(),
    (body) => body.p_meal_type === mealType,
  );
}

async function expectCompleteCandidate(
  page: Page,
  input: {
    heading: string;
    timeline: readonly string[];
    dishes: readonly {
      heading: string;
      ingredients: readonly (readonly [name: string, quantity: string])[];
      steps: readonly string[];
    }[];
    adaptation: {
      portion: string;
      cutting: string | null;
      heating: string;
      servingCheck: string;
    };
    safetyAction: string;
  },
): Promise<void> {
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  const candidate = page.locator("article.emergency-candidate").filter({
    has: page.getByRole("heading", { name: input.heading }),
  });
  await expect(candidate).toBeVisible();
  await expect(page.getByText("AI利用回数は消費しません。")).toBeVisible();
  await expect(candidate.getByText("食卓まで全体 15分・2人分")).toBeVisible();
  await expect(candidate.getByRole("heading", { name: "全体の段取り" })).toBeVisible();
  for (const timelineStep of input.timeline) {
    await expect(candidate.getByText(timelineStep, { exact: false })).toBeVisible();
  }
  for (const dish of input.dishes) {
    const dishSection = candidate.getByRole("heading", { name: dish.heading }).locator("..");
    await expect(dishSection).toBeVisible();
    for (const [ingredient, quantity] of dish.ingredients) {
      const ingredientRow = dishSection.locator("li.emergency-ingredient").filter({
        hasText: ingredient,
      });
      await expect(ingredientRow).toContainText(ingredient);
      await expect(ingredientRow).toContainText(quantity);
    }
    for (const [index, step] of dish.steps.entries()) {
      const stepRow = dishSection.getByRole("listitem").filter({
        hasText: `手順${String(index + 1)} ${step}`,
      });
      await expect(stepRow).toBeVisible();
    }
  }
  const adaptation = candidate.getByRole("heading", { name: "家族向けの取り分け" }).locator("..");
  await expect(adaptation.getByRole("term")).toContainText(input.adaptation.portion);
  if (input.adaptation.cutting !== null) {
    await expect(
      adaptation.getByText(`切り方: ${input.adaptation.cutting}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    adaptation.getByText(`加熱: ${input.adaptation.heating}`, { exact: true }),
  ).toBeVisible();
  await expect(
    adaptation.getByText(`配膳時: ${input.adaptation.servingCheck}`, { exact: true }),
  ).toBeVisible();
  const safetyAction = adaptation.getByText("安全のための手順", { exact: true }).locator("..");
  await expect(safetyAction.getByRole("listitem")).toHaveText(input.safetyAction);
  await expect(candidate.getByRole("heading", { name: "冷蔵庫食材の使い方" })).toBeVisible();
  await expect(candidate.getByText("今回選んだ冷蔵庫食材はありません。")).toBeVisible();
  await expect(
    candidate.getByRole("heading", { name: "加工品は原材料表示を確認してください" }),
  ).toHaveCount(0);
  await expect(candidate.getByText(/安全を保証する表示ではありません/u)).toBeVisible();

  const details = candidate.locator("details");
  const summary = details.locator("summary", { hasText: "材料と作り方を表示" });
  await summary.focus();
  await summary.press("Enter");
  await expect(details).not.toHaveAttribute("open", "");
  await summary.press("Enter");
  await expect(details).toHaveAttribute("open", "");

  const renderedText = await candidate.innerText();
  expect(renderedText).not.toMatch(/member_[1-9][0-9]*/u);
  expect(renderedText).not.toMatch(/dishes\.[0-9]+\.(?:ingredients|steps)\.[0-9]+/u);
  expect(renderedText).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

test("pantry CRUD, restored planner, attempt-local expiry check, and all reviewed meals", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });

  await page.goto("/pantry");
  await page.getByLabel("食材名").fill("キャベツ");
  await page.getByLabel("分量").fill("1");
  await page.getByLabel("単位").fill("個");
  await page.getByLabel("期限日").fill("2000-01-01");
  await page.getByLabel("期限の種類").selectOption("use_by");
  await page.getByLabel("開封状態").selectOption("opened");
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByRole("heading", { name: "キャベツ", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "キャベツを編集" }).click();
  await page.getByLabel("分量").fill("2");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("2個", { exact: true })).toBeVisible();

  await page.goto("/planner");
  await expect(page.getByText("現在の家族・安全条件")).toBeVisible();
  await page.getByRole("radio", { name: "夕食" }).check();
  await page.getByLabel("メイン食材").fill("鶏肉");
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByRole("radio", { name: "和食" }).check();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toContainText("アプリは食べられるか判断しません");
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await page.getByRole("checkbox", { name: "キャベツ" }).uncheck();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeChecked();
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByLabel("キャベツの使い方").selectOption("must_use"),
    (body) => hasPantryPriority(body, "must_use"),
  );

  await page.reload();
  await expect(page.getByRole("radio", { name: "夕食" })).toBeChecked();
  await expect(page.getByText("鶏肉を外す")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeChecked();
  await expect(page.getByLabel("キャベツの使い方")).toHaveValue("must_use");
  await page.getByRole("checkbox", { name: "キャベツ" }).uncheck();
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).not.toBeChecked();
  await expect
    .poll(() =>
      page
        .getByRole("button", { name: "実物を確認して今回だけ選ぶ" })
        .evaluate((element) => element === document.activeElement),
    )
    .toBe(true);
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeChecked();
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByLabel("キャベツの使い方").selectOption("must_use"),
    (body) => hasPantryPriority(body, "must_use"),
  );

  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByRole("checkbox", { name: "キャベツ" }).uncheck(),
    (body) => Array.isArray(body.p_pantry_selections) && body.p_pantry_selections.length === 0,
  );
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).not.toBeChecked();
  await expect(page.getByLabel("キャベツの使い方")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();

  await expectCompleteCandidate(page, {
    heading: "鶏肉とキャベツの塩蒸し・きゅうりの塩もみ・玉ねぎの塩スープ",
    timeline: [
      "0分〜（目安3分） 湯を沸かしながら材料を切る",
      "3分〜（目安10分） 主菜を蒸し、同時にスープを煮る",
      "13分〜（目安2分） 副菜の水気を絞って盛り付ける",
    ],
    dishes: [
      {
        heading: "主菜・鶏肉とキャベツの塩蒸し",
        ingredients: [
          ["鶏肉", "250g"],
          ["キャベツ", "1/4個"],
          ["塩", "少々"],
        ],
        steps: [
          "鶏肉を一口大、キャベツを食べやすい大きさに切る",
          "フライパンに入れて塩を振り、ふたをして中心まで十分に加熱する",
        ],
      },
      {
        heading: "副菜・きゅうりの塩もみ",
        ingredients: [["きゅうり", "1本"]],
        steps: ["薄切りにして塩でもみ、水気を絞る"],
      },
      {
        heading: "汁物・玉ねぎの塩スープ",
        ingredients: [["玉ねぎ", "1/2個"]],
        steps: ["薄切りの玉ねぎを水でやわらかく煮、塩で味を整える"],
      },
    ],
    adaptation: {
      portion: "年齢と食欲に合わせた量",
      cutting: "鶏肉を食べやすい大きさに切る",
      heating: "鶏肉の中心まで十分に加熱する",
      servingCheck: "生焼けがないことを確認する",
    },
    safetyAction: "鶏肉の中心まで十分に加熱する",
  });

  await savePlannerMeal(page, "朝食");
  await expectCompleteCandidate(page, {
    heading: "鮭おにぎり・やわらか野菜",
    timeline: [
      "0分〜（目安3分） 鮭を焼き始め、野菜を小さく切る",
      "3分〜（目安9分） 野菜を煮ながら鮭の骨を完全に除く",
      "12分〜（目安3分） 鮭をごはんに混ぜて握り、野菜を盛る",
    ],
    dishes: [
      {
        heading: "主菜・鮭おにぎり",
        ingredients: [
          ["ごはん", "300g"],
          ["鮭", "1切れ"],
        ],
        steps: [
          "鮭を中心まで十分に焼き、骨を完全に除いて細かくほぐす",
          "ごはんに鮭を混ぜ、食べやすい大きさに握る",
        ],
      },
      {
        heading: "副菜・やわらか野菜",
        ingredients: [
          ["にんじん", "1/2本"],
          ["キャベツ", "2枚"],
        ],
        steps: ["野菜を小さく切り、鍋で歯ぐきでつぶせるやわらかさまで煮る"],
      },
    ],
    adaptation: {
      portion: "年齢と食欲に合わせた量",
      cutting: "鮭を細かくほぐす",
      heating: "鮭の中心まで十分に加熱する",
      servingCheck: "鮭の骨が残っていないことを確認する",
    },
    safetyAction: "鮭の小骨を完全に除く",
  });

  await savePlannerMeal(page, "昼食");
  await expectCompleteCandidate(page, {
    heading: "鶏そぼろ丼・やわらか温野菜",
    timeline: [
      "0分〜（目安4分） 野菜を切り、鶏ひき肉を火にかける",
      "4分〜（目安8分） 鶏そぼろと温野菜を同時に十分加熱する",
      "12分〜（目安3分） 丼と温野菜を盛り付ける",
    ],
    dishes: [
      {
        heading: "主菜・鶏そぼろ丼",
        ingredients: [
          ["鶏ひき肉", "200g"],
          ["ごはん", "300g"],
        ],
        steps: ["鶏ひき肉をほぐしながら中心まで十分に加熱する", "ごはんに鶏そぼろをのせる"],
      },
      {
        heading: "副菜・やわらか温野菜",
        ingredients: [
          ["かぼちゃ", "100g"],
          ["にんじん", "1/2本"],
        ],
        steps: ["野菜を小さく切り、歯ぐきでつぶせるやわらかさまで加熱する"],
      },
    ],
    adaptation: {
      portion: "年齢と食欲に合わせた量",
      cutting: null,
      heating: "鶏ひき肉の中心まで十分に加熱する",
      servingCheck: "生焼けがないことを確認する",
    },
    safetyAction: "鶏ひき肉の中心まで十分に加熱する",
  });

  await page.goto("/planner");
  await page.getByRole("checkbox", { name: "キャベツ" }).check();
  await expect(page.getByRole("alertdialog")).toContainText("アプリは食べられるか判断しません");
  await page.getByRole("button", { name: "実物を確認して今回だけ選ぶ" }).click();
  await expect(page.getByRole("checkbox", { name: "キャベツ" })).toBeChecked();
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByLabel("キャベツの使い方").selectOption("must_use"),
    (body) => hasPantryPriority(body, "must_use"),
  );

  await page.goto("/pantry");
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "キャベツを削除" }).click();
  await expect(page.getByRole("heading", { name: "キャベツ", exact: true })).toHaveCount(0);
  await page.goto("/planner");
  await expect(page.getByRole("alert")).toContainText("冷蔵庫から削除された食材");
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeDisabled();
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByRole("button", { name: "削除された食材の選択を解除" }).click(),
    (body) => Array.isArray(body.p_pantry_selections) && body.p_pantry_selections.length === 0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();

  await page.reload();
  await expect(page.getByText("冷蔵庫から削除された食材")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "献立を作る" })).toBeEnabled();
});

test("keeps an incompatible current allergy as an explicit no-candidate result", async ({
  completedOnboardingPage: page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/settings");
  await page.getByLabel("アレルギーの確認").selectOption("registered");
  await expect(page.getByRole("status")).toContainText("最新条件で再確認します");
  await page.getByRole("button", { name: "鶏肉を追加" }).click();
  const selectedAllergies = page.getByRole("list", { name: "選択済みアレルギー" });
  await expect(
    selectedAllergies.getByRole("button", { name: "鶏肉を削除", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "鶏肉を追加" })).toBeDisabled();
  await page.goto("/planner");
  await updatePlannerAndAwaitAutosave(
    page,
    () => page.getByRole("radio", { name: "夕食" }).check(),
    (body) => body.p_meal_type === "dinner",
  );
  await page.getByRole("link", { name: "AIを使わない緊急献立を見る" }).click();
  await expect(page.getByText("条件に合う緊急献立がありません")).toBeVisible();
  await expect(page.getByText("条件を緩めず、候補を表示していません。")).toBeVisible();
  await expect(page.getByText(/条件を緩め/u)).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
