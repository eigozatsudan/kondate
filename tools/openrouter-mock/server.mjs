import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isDeepStrictEqual } from "node:util";
import { scenarios } from "./fixtures/scenarios.mjs";

const primaryModel = "mock/kondate-primary:free";
const repairModel = "mock/kondate-repair:free";
const maximumBodyBytes = 1_000_000;
// 本番 openrouter.ts と同一キー集合（temperature は送らない — luna 等 require_parameters 404 回避）
const expectedBodyKeys = ["messages", "models", "provider", "response_format", "stream"];
const menuResponseFormat = JSON.parse(
  await readFile(new URL("./fixtures/menu-response-format.json", import.meta.url), "utf8"),
);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasExactKeys = (value, keys) => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};

const isValidMessage = (value) =>
  isPlainObject(value) &&
  hasExactKeys(value, ["content", "role"]) &&
  (value.role === "system" || value.role === "user" || value.role === "assistant") &&
  typeof value.content === "string";

/** full_menu または dish regeneration の response_format を受け入れる */
const isDishRegenerationFormat = (responseFormat) =>
  isPlainObject(responseFormat) &&
  responseFormat.type === "json_schema" &&
  isPlainObject(responseFormat.json_schema) &&
  responseFormat.json_schema.name === "kondate_dish_regeneration";

const isValidBody = (body) => {
  if (!isPlainObject(body) || !hasExactKeys(body, expectedBodyKeys)) return false;
  const { models, messages, provider, response_format: responseFormat, stream } = body;
  const modelSequenceValid =
    Array.isArray(models) &&
    ((models.length === 2 && models[0] === primaryModel && models[1] === repairModel) ||
      (models.length === 1 && models[0] === repairModel));
  const responseFormatValid =
    isDeepStrictEqual(responseFormat, menuResponseFormat) ||
    isDishRegenerationFormat(responseFormat);
  return (
    modelSequenceValid &&
    models.every((model) => typeof model === "string" && model.endsWith(":free")) &&
    new Set(models).size === models.length &&
    Array.isArray(messages) &&
    messages.every(isValidMessage) &&
    isPlainObject(provider) &&
    hasExactKeys(provider, ["require_parameters"]) &&
    provider.require_parameters === true &&
    stream === false &&
    responseFormatValid
  );
};

const jsonResponse = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

/**
 * idea 判定: generation-prompt.ts の idea system 文にだけ含まれる句。
 * household 向け system には無い。
 */
const isIdeaSystemPrompt = (messages) => {
  if (!Array.isArray(messages)) return false;
  const system = messages.find((message) => message?.role === "system");
  const systemContent = typeof system?.content === "string" ? system.content : "";
  return systemContent.includes(
    "家族向け取り分け(adaptations)とラベル確認(labelConfirmations)は空配列",
  );
};

/**
 * user メッセージの kondate_input_data を読む。無ければ null。
 */
const readKondateInputPayload = (messages) => {
  if (!Array.isArray(messages)) return null;
  const user = messages.find((message) => message?.role === "user");
  const userContent = typeof user?.content === "string" ? user.content : "";
  const match = /<kondate_input_data>\n([\s\S]*?)\n<\/kondate_input_data>/u.exec(userContent);
  if (match === null) return null;
  try {
    const payload = JSON.parse(match[1]);
    return isPlainObject(payload) ? payload : null;
  } catch {
    return null;
  }
};

/**
 * idea 検証が要求する形へ success 系 full_menu を整える。
 * adaptations / labelConfirmations を空にし、人数を提出値に合わせる。
 */
const applyIdeaMenuShape = (fixture, servings) => {
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) {
    return fixture;
  }
  if (!isPlainObject(fixture.menu)) return fixture;
  return {
    ...fixture,
    menu: {
      ...fixture.menu,
      servings,
      adaptations: [],
      labelConfirmations: [],
    },
  };
};

/**
 * ブラウザ手動操作向け: 固定 fixture を提出 preferences に合わせて揃える。
 * - mealType / cuisineGenre（any 以外）を一致
 * - mainIngredients を主菜名と先頭材料へ埋め込み（main_ingredient_missing 回避）
 * - dinner は soup を足して 3 品にする
 * - idea は人数・空 adaptations/labels
 *
 * E2E は朝食+鶏肉+和食で fixture と一致させることが多いが、手動 UI は
 * 昼食/洋食/卵 なども選ぶ。未整列のままだと primary+repair とも invalid_ai_response になる。
 */
const applySubmissionMenuShape = (fixture, messages, ideaServingsOverride = null) => {
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) {
    return fixture;
  }
  if (!isPlainObject(fixture.menu) || fixture.outcome !== "success") return fixture;

  const payload = readKondateInputPayload(messages);
  const preferences = isPlainObject(payload?.preferences) ? payload.preferences : null;
  let menu = {
    ...fixture.menu,
    dishes: Array.isArray(fixture.menu.dishes) ? [...fixture.menu.dishes] : [],
  };

  if (preferences !== null) {
    const mealType = preferences.mealType;
    if (mealType === "breakfast" || mealType === "lunch" || mealType === "dinner") {
      menu.mealType = mealType;
    }
    const cuisineGenre = preferences.cuisineGenre;
    if (cuisineGenre === "japanese" || cuisineGenre === "western" || cuisineGenre === "chinese") {
      // any は validate が一致要求しないので fixture の japanese のままでよい
      menu.cuisineGenre = cuisineGenre;
    }
    const mains = Array.isArray(preferences.mainIngredients)
      ? preferences.mainIngredients.filter((name) => typeof name === "string" && name.length > 0)
      : [];
    if (mains.length > 0 && menu.dishes.length > 0) {
      menu.dishes = menu.dishes.map((dish, dishIndex) => {
        if (dishIndex !== 0 || !isPlainObject(dish)) return dish;
        const mainName = mains[0];
        const ingredients = Array.isArray(dish.ingredients)
          ? dish.ingredients.map((ingredient, ingredientIndex) => {
              if (!isPlainObject(ingredient)) return ingredient;
              if (ingredientIndex < mains.length) {
                return { ...ingredient, name: mains[ingredientIndex] };
              }
              return ingredient;
            })
          : dish.ingredients;
        return {
          ...dish,
          name: `${mainName}の${typeof dish.name === "string" ? dish.name : "主菜"}`,
          ingredients,
        };
      });
    }
  }

  // dinner は main+side+soup の 3 品が必須。固定 fixture は 2 品なので soup を足す。
  if (menu.mealType === "dinner" && menu.dishes.length === 2) {
    const side = menu.dishes[1];
    const soupBase = isPlainObject(side) ? side : menu.dishes[0];
    menu.dishes = [
      ...menu.dishes,
      {
        ...soupBase,
        dishRef: "dish_3",
        role: "soup",
        position: 3,
        name:
          isPlainObject(soupBase) && typeof soupBase.name === "string"
            ? `${soupBase.name}のスープ`
            : "野菜スープ",
        ingredients: Array.isArray(soupBase?.ingredients)
          ? soupBase.ingredients.map((ingredient, index) =>
              isPlainObject(ingredient)
                ? {
                    ...ingredient,
                    ingredientRef: `ingredient_soup_${String(index + 1)}`,
                  }
                : ingredient,
            )
          : [],
        steps: [
          {
            stepRef: "step_soup_1",
            position: 1,
            instruction: "材料を煮てスープに仕上げる",
          },
        ],
      },
    ];
  }

  const ideaMode = isIdeaSystemPrompt(messages) || ideaServingsOverride !== null;
  if (ideaMode) {
    const servingsFromPrefs =
      preferences !== null &&
      typeof preferences.servings === "number" &&
      Number.isInteger(preferences.servings) &&
      preferences.servings >= 1 &&
      preferences.servings <= 20
        ? preferences.servings
        : null;
    const servings = ideaServingsOverride ?? servingsFromPrefs;
    if (servings !== null) {
      menu = { ...menu, servings, adaptations: [], labelConfirmations: [] };
    } else {
      menu = { ...menu, adaptations: [], labelConfirmations: [] };
    }
  }

  return { ...fixture, menu };
};

/** full_menu fixture を provider の nullable 3-field wire 表現へ閉じる。 */
const toMenuGenerationWireResponse = (fixture) => {
  if (!isPlainObject(fixture)) return fixture;
  if (fixture.outcome === "success") {
    return { ...fixture, conflicts: null };
  }
  if (fixture.outcome === "constraint_conflict") {
    return { ...fixture, menu: null };
  }
  return fixture;
};

/**
 * idea の system 指示と user の kondate_input_data から人数を読む。
 * household プロンプト（members 非空・idea 指示なし）では null。
 */
const readIdeaServingsFromMessages = (messages) => {
  if (!isIdeaSystemPrompt(messages)) return null;
  const payload = readKondateInputPayload(messages);
  if (payload === null || !isPlainObject(payload.preferences)) return null;
  if (!Array.isArray(payload.members) || payload.members.length !== 0) return null;
  const servings = payload.preferences.servings;
  if (
    typeof servings !== "number" ||
    !Number.isInteger(servings) ||
    servings < 1 ||
    servings > 20
  ) {
    return null;
  }
  return servings;
};

const readRequestBody = (request, response) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let settled = false;
    let oversized = false;

    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      response.off("close", discardOversizedRequest);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const discardOversizedRequest = () => {
      request.destroy();
      settle(resolve, { oversized: true, body: null });
    };
    const onData = (chunk) => {
      received += chunk.length;
      if (received > maximumBodyBytes) {
        oversized = true;
        request.pause();
        response.shouldKeepAlive = false;
        response.writeHead(413, { connection: "close" });
        response.once("close", discardOversizedRequest);
        response.end(discardOversizedRequest);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () =>
      settle(
        resolve,
        oversized
          ? { oversized: true, body: null }
          : { oversized: false, body: Buffer.concat(chunks) },
      );
    const onError = (error) => {
      if (oversized) {
        discardOversizedRequest();
      } else {
        settle(reject, error);
      }
    };
    const onAborted = () => {
      if (oversized) {
        discardOversizedRequest();
      } else {
        settle(reject, new Error("request aborted"));
      }
    };

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });

async function handleRequest(request, response) {
  if (request.method === "GET" && request.url === "/health") {
    jsonResponse(response, 200, { status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/v1/chat/completions") {
    jsonResponse(response, 404, { error: "not_found" });
    return;
  }
  if (request.headers.authorization !== "Bearer local-mock-key") {
    jsonResponse(response, 401, { error: { message: "invalid authorization" } });
    return;
  }
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    contentType.split(";", 1)[0]?.trim() !== "application/json"
  ) {
    jsonResponse(response, 400, { error: { message: "invalid content type" } });
    return;
  }

  const requestBody = await readRequestBody(request, response);
  if (requestBody.oversized) return;

  let body;
  try {
    body = JSON.parse(requestBody.body.toString("utf8"));
  } catch {
    jsonResponse(response, 400, { error: { message: "invalid json" } });
    return;
  }
  if (!isValidBody(body)) {
    jsonResponse(response, 400, { error: { message: "invalid structured request" } });
    return;
  }

  const header = request.headers["x-kondate-mock-scenario"] ?? "success";
  const scenario = Array.isArray(header) ? header[0] : header;
  const repairRequest = body.models.length === 1 && body.models[0] === repairModel;
  const dishMode = isDishRegenerationFormat(body.response_format);
  // 料理単位再生成は default で dish-replacement を返す（success の full_menu 形は拒否される）
  const resolvedScenario =
    scenario === "invalid-then-success"
      ? repairRequest
        ? "success"
        : "malformed-json"
      : dishMode && (scenario === "success" || scenario === undefined)
        ? "dish-replacement"
        : scenario;
  const key = resolvedScenario;
  // idea-servings-N（1..20）は静的 scenarios に無い人数でも合成する。
  // ブラウザ手動操作は X-Kondate-Mock-Scenario を付けないため、default success も
  // idea プロンプトなら同じ変換を当てる（家族向け子行を落とす・人数一致）。
  const ideaServingsMatch = typeof key === "string" ? /^idea-servings-(\d{1,2})$/u.exec(key) : null;
  const ideaServingsFromKey = ideaServingsMatch !== null ? Number(ideaServingsMatch[1]) : null;
  const ideaServingsValid =
    ideaServingsFromKey !== null &&
    Number.isInteger(ideaServingsFromKey) &&
    ideaServingsFromKey >= 1 &&
    ideaServingsFromKey <= 20;

  if (typeof key !== "string" || (!Object.hasOwn(scenarios, key) && !ideaServingsValid)) {
    jsonResponse(response, 404, { error: "not_found" });
    return;
  }

  let fixture = ideaServingsValid
    ? structuredClone(scenarios.success)
    : structuredClone(scenarios[key]);
  // success: 手動 UI 向けに提出条件へ合わせる。
  // duplicate-menu: seed 時の success と同じ整形をしないと material 署名がずれ、
  // 「重複失敗」E2E が成功遷移してしまう（3f97b69 の applySubmissionMenuShape 導入後）。
  if (!dishMode && (key === "success" || key === "duplicate-menu" || ideaServingsValid)) {
    // 手動 UI / idea-servings-* : 提出 mealType・ジャンル・主食材・人数に合わせて fixture を整える。
    // 旧 applyIdeaMenuShape だけでは western/卵/昼食などで validate が落ち repair も同型失敗する。
    const ideaServings = ideaServingsValid
      ? ideaServingsFromKey
      : readIdeaServingsFromMessages(body.messages);
    fixture = applySubmissionMenuShape(fixture, body.messages, ideaServings);
    // idea-servings ヘッダだけで messages が idea でない合成経路向けに人数を再固定
    if (ideaServingsValid) {
      fixture = applyIdeaMenuShape(fixture, ideaServingsFromKey);
    }
  }
  if (!dishMode) {
    fixture = toMenuGenerationWireResponse(fixture);
  }
  const content = typeof fixture === "string" ? fixture : JSON.stringify(fixture);
  jsonResponse(response, 200, {
    id: "mock-fixed",
    object: "chat.completion",
    created: 0,
    model: repairRequest ? repairModel : body.models[0],
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  });
}

export function createOpenRouterMockServer() {
  return createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent && !response.writableEnded) {
        response.writeHead(400).end();
      } else if (!response.writableEnded) {
        response.destroy();
      }
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? "8787");
  createOpenRouterMockServer().listen(port, "0.0.0.0", () => {
    console.log(`openrouter-mock listening on ${port}`);
  });
}
