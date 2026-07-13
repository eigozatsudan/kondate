import { createServer } from "node:http";
import { once } from "node:events";
import { createServer as createViteServer } from "vite";

const functionModulePaths = [
  "/netlify/functions/auth-continuation-create.ts",
  "/netlify/functions/auth-continuation-deposit.ts",
  "/netlify/functions/auth-continuation-claim.ts",
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createMatcher(path) {
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment === ":continuationId") return "(?<continuationId>[^/]+)";
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
      ({ method, matcher }) => method === nodeRequest.method && matcher.test(url.pathname),
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
      await writeResponse(await route.handler(request, { params }), nodeResponse);
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

export async function startE2eFunctionServer() {
  const vite = await createViteServer({ server: { middlewareMode: true } });
  const server = await createE2eFunctionServer({
    loadModule: (path) => vite.ssrLoadModule(path),
    logger: console,
  });
  server.listen(5174, "127.0.0.1");
  return server;
}
