import { afterEach, expect, it } from "vitest";
import {
  captureAndStripAuthCallbackUrl,
  resetAuthCallbackUrlCaptureForTests,
  takeCapturedAuthCallbackUrl,
} from "./auth-callback-url-capture";

afterEach(() => {
  resetAuthCallbackUrlCaptureForTests();
});

it("C7: captures code then strips non-flow params from the visible URL", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback?flow=flow-1&state=s1&code=c1#access_token=x",
    (url) => {
      replaced.push(url);
    },
  );
  expect(replaced).toEqual(["/auth/callback?flow=flow-1"]);
  expect(takeCapturedAuthCallbackUrl().href).toBe(
    "http://127.0.0.1:5173/auth/callback?flow=flow-1&state=s1&code=c1#access_token=x",
  );
});

it("C7: is idempotent for the same entry and ignores non-callback paths", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/login", (url) => {
    replaced.push(url);
  });
  expect(replaced).toEqual([]);
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/auth/callback?flow=f&code=c", (url) => {
    replaced.push(url);
  });
  // 同一 entry の二重呼び出し（StrictMode）は sticky 維持
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/auth/callback?flow=f&code=c", (url) => {
    replaced.push(url);
  });
  // strip 後 URL（secrets 無し）も sticky を壊さない
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/auth/callback?flow=f", (url) => {
    replaced.push(url);
  });
  expect(replaced).toEqual(["/auth/callback?flow=f"]);
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("c");
});

it("C7: SPA leave+reenter recaptures a new callback URL", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback?flow=f1&code=first",
    (url) => {
      replaced.push(url);
    },
  );
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("first");
  // callback 外へ出ると sticky 解除
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/login", (url) => {
    replaced.push(url);
  });
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback?flow=f2&code=second",
    (url) => {
      replaced.push(url);
    },
  );
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("second");
  expect(replaced).toEqual(["/auth/callback?flow=f1", "/auth/callback?flow=f2"]);
});

it("C10: strips callback secrets when pathname has a trailing slash", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback/?flow=flow-1&state=s1&code=c1",
    (url) => {
      replaced.push(url);
    },
  );
  expect(replaced).toEqual(["/auth/callback/?flow=flow-1"]);
  expect(takeCapturedAuthCallbackUrl().pathname).toBe("/auth/callback/");
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("c1");
});

it("C10: does not treat /auth/callback/extra as a callback strip target", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback/extra?flow=f&code=c",
    (url) => {
      replaced.push(url);
    },
  );
  expect(replaced).toEqual([]);
  expect(takeCapturedAuthCallbackUrl("http://127.0.0.1/login").href).toBe("http://127.0.0.1/login");
});

it("C-R5: soft-nav same-path with a new code recaptures without leave", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback?flow=f1&code=first",
    (url) => {
      replaced.push(url);
    },
  );
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("first");
  // leave 無しで別 code が来たら recapture（SPA soft-nav 連続再入場）
  captureAndStripAuthCallbackUrl(
    "http://127.0.0.1:5173/auth/callback?flow=f2&code=second",
    (url) => {
      replaced.push(url);
    },
  );
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("second");
  expect(takeCapturedAuthCallbackUrl().searchParams.get("flow")).toBe("f2");
  expect(replaced).toEqual(["/auth/callback?flow=f1", "/auth/callback?flow=f2"]);
});
