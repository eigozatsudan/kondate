import type { DataRouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { createAppRouter } from "./router";

function findRoute(routes: DataRouteObject[], path: string): DataRouteObject | undefined {
  for (const route of routes) {
    if (route.path === path) {
      return route;
    }

    if (route.children !== undefined) {
      const child = findRoute(route.children, path);
      if (child !== undefined) {
        return child;
      }
    }
  }

  return undefined;
}

describe("app router", () => {
  it.each(["/login", "/auth/callback", "/onboarding", "/privacy", "/settings"])(
    "%s の画面コードをルート解決時まで読み込まない",
    (path) => {
      const router = createAppRouter();
      const route = findRoute(router.routes, path);

      expect(route?.lazy).toEqual(expect.any(Function));
      expect(route?.element).toBeUndefined();
      router.dispose();
    },
  );
});
