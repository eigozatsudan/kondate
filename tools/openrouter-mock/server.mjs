import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isDeepStrictEqual } from "node:util";
import { scenarios } from "./fixtures/scenarios.mjs";

const primaryModel = "mock/kondate-primary:free";
const repairModel = "mock/kondate-repair:free";
const maximumBodyBytes = 1_000_000;
const expectedBodyKeys = [
  "messages",
  "models",
  "provider",
  "response_format",
  "stream",
  "temperature",
];
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
  const { models, messages, provider, response_format: responseFormat, temperature, stream } = body;
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
    temperature === 0.2 &&
    stream === false &&
    responseFormatValid
  );
};

const jsonResponse = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
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
 * idea の system 指示と user の kondate_input_data から人数を読む。
 * household プロンプト（members 非空・idea 指示なし）では null。
 */
const readIdeaServingsFromMessages = (messages) => {
  if (!Array.isArray(messages)) return null;
  const system = messages.find((message) => message?.role === "system");
  const systemContent = typeof system?.content === "string" ? system.content : "";
  // generation-prompt.ts の idea system 文と一致する判定（世帯向け system には無い）
  if (
    !systemContent.includes("家族向け取り分け(adaptations)とラベル確認(labelConfirmations)は空配列")
  ) {
    return null;
  }
  const user = messages.find((message) => message?.role === "user");
  const userContent = typeof user?.content === "string" ? user.content : "";
  const match = /<kondate_input_data>\n([\s\S]*?)\n<\/kondate_input_data>/u.exec(userContent);
  if (match === null) return null;
  try {
    const payload = JSON.parse(match[1]);
    if (!isPlainObject(payload) || !isPlainObject(payload.preferences)) return null;
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
  } catch {
    return null;
  }
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
  if (ideaServingsValid) {
    fixture = applyIdeaMenuShape(fixture, ideaServingsFromKey);
  } else if (key === "success" && !dishMode) {
    // ヘッダ無しの手動 idea 生成: プロンプトが idea なら default success を idea 形へ
    const ideaServings = readIdeaServingsFromMessages(body.messages);
    if (ideaServings !== null) {
      fixture = applyIdeaMenuShape(fixture, ideaServings);
    }
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
