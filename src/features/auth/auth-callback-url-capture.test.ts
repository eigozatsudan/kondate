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

it("C7: is idempotent and ignores non-callback paths", () => {
  const replaced: string[] = [];
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/login", (url) => {
    replaced.push(url);
  });
  expect(replaced).toEqual([]);
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/auth/callback?flow=f&code=c", (url) => {
    replaced.push(url);
  });
  captureAndStripAuthCallbackUrl("http://127.0.0.1:5173/auth/callback?flow=f&code=other", (url) => {
    replaced.push(url);
  });
  expect(replaced).toEqual(["/auth/callback?flow=f"]);
  expect(takeCapturedAuthCallbackUrl().searchParams.get("code")).toBe("c");
});
