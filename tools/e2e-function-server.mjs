import { createServer } from "node:http";
import { once } from "node:events";
import { createServer as createViteServer } from "vite";

const functionModulePaths = [
  "/netlify/functions/auth-continuation-create.ts",
  "/netlify/functions/auth-continuation-deposit.ts",
  "/netlify/functions/auth-continuation-claim.ts",
  "/netlify/functions/emergency-menus.ts",
  "/netlify/functions/generate-menu.ts",
  "/netlify/functions/generation-status.ts",
];
const requestArrivalPath = "/api/__kondate_e2e__/request-arrivals/";
const requestArrivalTtlMs = 30_000;
const requestArrivalLimit = 256;
const requestArrivalTokenPattern = /^[A-Za-z0-9_-]{1,128}$/u;

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

function isRequestArrivalToken(value) {
  return typeof value === "string" && requestArrivalTokenPattern.test(value);
}

function pruneRequestArrivals(requestArrivals, now) {
  for (const [token, expiresAt] of requestArrivals) {
    if (expiresAt > now) continue;
    requestArrivals.delete(token);
  }
}

function recordRequestArrival(requestArrivals, token, now) {
  pruneRequestArrivals(requestArrivals, now);
  requestArrivals.delete(token);
  while (requestArrivals.size >= requestArrivalLimit) {
    const oldestToken = requestArrivals.keys().next().value;
    if (oldestToken === undefined) break;
    requestArrivals.delete(oldestToken);
  }
  requestArrivals.set(token, now + requestArrivalTtlMs);
}

function consumeRequestArrival(requestArrivals, token, now) {
  pruneRequestArrivals(requestArrivals, now);
  return requestArrivals.delete(token);
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
  // 到達tokenはE2Eの同期にだけ使う短命な状態である。期限と上限を設け、
  // 並列testがtokenを使い捨ててもserver processへ蓄積し続けないようにする。
  const requestArrivals = new Map();

  return createServer(async (nodeRequest, nodeResponse) => {
    const url = new URL(
      nodeRequest.url ?? "/",
      `http://${nodeRequest.headers.host ?? "127.0.0.1"}`,
    );
    if (nodeRequest.method === "GET" && url.pathname.startsWith(requestArrivalPath)) {
      let token;
      try {
        token = decodeURIComponent(url.pathname.slice(requestArrivalPath.length));
      } catch {
        nodeResponse.statusCode = 400;
        nodeResponse.end();
        return;
      }
      if (!isRequestArrivalToken(token)) {
        nodeResponse.statusCode = 400;
        nodeResponse.end();
        return;
      }
      nodeResponse.statusCode = consumeRequestArrival(requestArrivals, token, Date.now())
        ? 204
        : 404;
      nodeResponse.end();
      return;
    }

    const route = routes.find(
      ({ method, matcher }) => method === nodeRequest.method && matcher.test(url.pathname),
    );
    if (route === undefined) {
      nodeResponse.statusCode = 404;
      nodeResponse.end();
      return;
    }

    const arrivalToken = nodeRequest.headers["x-kondate-e2e-arrival-token"];
    if (arrivalToken !== undefined) {
      if (!isRequestArrivalToken(arrivalToken)) {
        nodeResponse.statusCode = 400;
        nodeResponse.end();
        return;
      }
      // handler呼出し前に記録し、長時間処理中でもtab-close testが到達を観測できるようにする。
      recordRequestArrival(requestArrivals, arrivalToken, Date.now());
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
