import { createServer } from "node:http";
import { once } from "node:events";
import { createServer as createViteServer } from "vite";

// Plan 4 履歴・再生成ジャーニーと Plan 5 買い物リストジャーニーが必要とする
// Function を含む閉じた一覧。
// Vite proxy が /api を 5174 へ転送するため、ここに無い path は E2E で 404 になる。
const functionModulePaths = [
  "/netlify/functions/auth-continuation-create.ts",
  "/netlify/functions/auth-continuation-deposit.ts",
  "/netlify/functions/auth-continuation-claim.ts",
  "/netlify/functions/emergency-menus.ts",
  "/netlify/functions/generate-menu.ts",
  "/netlify/functions/generate-dish.ts",
  "/netlify/functions/generation-status.ts",
  "/netlify/functions/revalidate-menu.ts",
  "/netlify/functions/usage-today.ts",
  "/netlify/functions/confirm-label-confirmation.ts",
  "/netlify/functions/shopping-list-from-menu.ts",
  "/netlify/functions/shopping-list-preview.ts",
  "/netlify/functions/shopping-list-reconcile.ts",
  "/netlify/functions/shopping-list-revalidate.ts",
  // Plan 6 アカウント削除 E2E（設定 DangerZone → DELETE /api/account）
  "/netlify/functions/delete-account.ts",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createMatcher(path) {
  const pattern = path
    .split("/")
    .map((segment) => {
      // ":xxx" 形式のパスパラメータ全般を名前付きキャプチャへ変換する。
      // continuationId 専用の特別扱いをやめ、idempotencyKey 等の他パラメータ名も
      // 汎用的にサポートする（generation-status.ts の :idempotencyKey で必要）。
      if (segment.startsWith(":")) return `(?<${segment.slice(1)}>[^/]+)`;
      return escapeRegex(segment);
    })
    .join("/");
  return new RegExp(`^${pattern}$`, "u");
}

function requestHeaders(rawHeaders) {
  const result = new Headers();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    result.append(rawHeaders[index], rawHeaders[index + 1]);
  }
  return result;
}

async function writeResponse(response, nodeResponse) {
  for (const [name, value] of response.headers) nodeResponse.setHeader(name, value);
  if (typeof response.headers.getSetCookie === "function") {
    nodeResponse.setHeader("set-cookie", response.headers.getSetCookie());
  }
  nodeResponse.writeHead(response.status);
  if (response.body !== null) {
    for await (const chunk of response.body) {
      if (!nodeResponse.write(chunk)) await once(nodeResponse, "drain");
    }
  }
  nodeResponse.end();
}

export async function createE2eFunctionServer({ loadModule, logger }) {
  const modules = await Promise.all(functionModulePaths.map(loadModule));
  const routes = modules.map((module) => ({
    handler: module.default,
    method: module.config.method,
    matcher: createMatcher(module.config.path),
  }));
  return createServer(async (nodeRequest, nodeResponse) => {
    const url = new URL(
      nodeRequest.url ?? "/",
      `http://${nodeRequest.headers.host ?? "127.0.0.1"}`,
    );
    const route = routes.find(
      // Netlify の Config.method は任意項目で、省略時は全メソッドを受ける。
      // Plan 5 の一部 Function は method を宣言しないため、undefined を
      // 「メソッド制限なし」として扱わないと E2E だけ 404 になる。
      ({ method, matcher }) =>
        (method === undefined || method === nodeRequest.method) && matcher.test(url.pathname),
    );
    if (route === undefined) {
      nodeResponse.statusCode = 404;
      nodeResponse.end();
      return;
    }

    const params = route.matcher.exec(url.pathname)?.groups ?? {};
    const request = new Request(url, {
      method: nodeRequest.method,
      headers: requestHeaders(nodeRequest.rawHeaders),
      ...(nodeRequest.method === "GET" || nodeRequest.method === "HEAD"
        ? {}
        : { body: nodeRequest, duplex: "half" }),
    });

    try {
      const shouldDropResponse =
        nodeRequest.headers["x-kondate-e2e-drop-response"] === "after-handler";
      const functionResponse = await route.handler(request, { params });
      if (shouldDropResponse) {
        // handlerのDB副作用を完了させた後、client responseだけを失わせるE2E専用seam。
        nodeResponse.destroy();
        return;
      }
      await writeResponse(functionResponse, nodeResponse);
    } catch {
      logger.error({
        code: "e2e_function_handler_failed",
        method: nodeRequest.method,
        path: url.pathname,
      });
      nodeResponse.statusCode = 500;
      nodeResponse.end();
    }
  });
}

export async function startE2eFunctionServer({ createVite = createViteServer } = {}) {
  const vite = await createVite({ server: { middlewareMode: true } });
  const server = await createE2eFunctionServer({
    loadModule: (path) => vite.ssrLoadModule(path),
    logger: console,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(5174, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  let closing;

  return {
    close() {
      if (closing === undefined) {
        closing = new Promise((resolve, reject) => {
          server.close((error) => {
            if (error === undefined) resolve();
            else reject(error);
          });
        }).finally(() => vite.close());
      }
      return closing;
    },
  };
}
