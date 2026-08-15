/**
 * 静的 root 封じ込めの単体・アプリ結合テスト。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import {
  resolveContainedPath,
  isPathInsideRoot,
  createSafeStaticMiddleware,
  createSpaFallbackMiddleware,
} from "./safe-static.js";

describe("resolveContainedPath", () => {
  const root = "/var/admin/dist/client";

  it("maps normal asset under root", () => {
    const resolved = resolveContainedPath(root, "/assets/index.js");
    expect(resolved).toBe(join(root, "assets/index.js"));
  });

  it("strips leading slashes so absolute segments cannot escape", () => {
    const resolved = resolveContainedPath(root, "/proc/self/environ");
    // root 配下の相対 path として解決される（絶対 discard ではない）
    expect(resolved).toBe(join(root, "proc/self/environ"));
    expect(resolved?.startsWith(root + "/")).toBe(true);
  });

  it("rejects .. traversal", () => {
    expect(resolveContainedPath(root, "/../etc/passwd")).toBeNull();
    expect(resolveContainedPath(root, "/assets/../../etc/passwd")).toBeNull();
    expect(resolveContainedPath(root, "/%2e%2e/etc/passwd")).toBeNull();
    expect(resolveContainedPath(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
  });

  it("rejects null bytes and bad encoding", () => {
    expect(resolveContainedPath(root, "/assets/\0secret")).toBeNull();
    // 不正 % は decode 失敗で null
    expect(resolveContainedPath(root, "/%E0%A4%A")).toBeNull();
  });

  it("isPathInsideRoot rejects sibling prefix confusion", () => {
    expect(isPathInsideRoot("/var/admin/dist/client-evil", root)).toBe(false);
    expect(isPathInsideRoot(root, root)).toBe(true);
    expect(isPathInsideRoot(join(root, "a"), root)).toBe(true);
  });
});

describe("createSafeStaticMiddleware integration", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "admin-static-"));
    mkdirSync(join(tmpRoot, "assets"));
    writeFileSync(join(tmpRoot, "assets", "app.js"), "console.log('ok');\n", "utf8");
    writeFileSync(join(tmpRoot, "index.html"), "<!doctype html><title>admin</title>\n", "utf8");
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function buildApp(): Hono {
    const app = new Hono();
    app.use("/*", createSafeStaticMiddleware(tmpRoot));
    app.get("*", createSpaFallbackMiddleware(tmpRoot));
    app.notFound((c) => c.text("Not Found", 404));
    return app;
  }

  it("serves a normal asset under root with 200", async () => {
    const app = buildApp();
    const res = await app.request("http://127.0.0.1:5193/assets/app.js");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("console.log");
  });

  it("does not return environ contents for GET /proc/self/environ", async () => {
    const app = buildApp();
    const res = await app.request("http://127.0.0.1:5193/proc/self/environ");
    // leading / は剥がされ root 配下相対になる。実体が無いので SPA or 404。
    // OS の /proc/self/environ 本文は絶対に返さない。
    const body = await res.text();
    expect(body).not.toMatch(/ADMIN_DATABASE_URL|PATH=|HOME=/);
    if (res.status === 200) {
      expect(body).toMatch(/doctype html/i);
    } else {
      expect([404, 403]).toContain(res.status);
    }
  });

  it("does not leak passwd via encoded .. or URL-normalized traversal", async () => {
    const app = buildApp();
    // URL コンストラクタは /%2e%2e/etc/passwd を /etc/passwd に正規化する。
    // いずれの path でも OS の /etc/passwd は root 外として読めないこと。
    for (const path of ["/%2e%2e/etc/passwd", "/../etc/passwd", "/etc/passwd"]) {
      const res = await app.request(`http://127.0.0.1:5193${path}`);
      const body = await res.text();
      expect(body).not.toMatch(/root:.*:0:0/);
      if (res.status === 200) {
        expect(body).toMatch(/doctype html/i);
      }
    }
  });

  it("refuses to resolve paths that would escape root even if outside file exists", () => {
    // root 直上にファイルを置いても .. 経由の解決は null（fail-closed）
    const outside = join(tmpRoot, "..", "leaked.txt");
    writeFileSync(outside, "SECRET_OUTSIDE_ROOT\n", "utf8");
    try {
      expect(resolveContainedPath(tmpRoot, "/../leaked.txt")).toBeNull();
      expect(resolveContainedPath(tmpRoot, "/%2e%2e/leaked.txt")).toBeNull();
      expect(resolveContainedPath(tmpRoot, "/assets/../../leaked.txt")).toBeNull();
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("does not follow a root-internal symlink that points outside (AO11)", async () => {
    const outside = join(tmpRoot, "..", "ao11-secret.txt");
    writeFileSync(outside, "AO11_SECRET_OUTSIDE\n", "utf8");
    const linkPath = join(tmpRoot, "assets", "leak.txt");
    symlinkSync(outside, linkPath);
    try {
      const app = buildApp();
      const res = await app.request("http://127.0.0.1:5193/assets/leak.txt");
      const body = await res.text();
      expect(body).not.toContain("AO11_SECRET_OUTSIDE");
      expect(res.status).toBe(404);
    } finally {
      rmSync(linkPath, { force: true });
      rmSync(outside, { force: true });
    }
  });

  it("still serves a symlink whose realpath stays inside root", async () => {
    const target = join(tmpRoot, "assets", "app.js");
    const linkPath = join(tmpRoot, "assets", "app-alias.js");
    symlinkSync(target, linkPath);
    try {
      const app = buildApp();
      const res = await app.request("http://127.0.0.1:5193/assets/app-alias.js");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("console.log");
    } finally {
      rmSync(linkPath, { force: true });
    }
  });
});
