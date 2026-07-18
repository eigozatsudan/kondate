import type { ReactElement } from "react";
import type { DataRouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { RequireCompletedOnboarding } from "@/features/auth/protected-routes";
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

function findAncestorElementTypes(
  routes: DataRouteObject[],
  path: string,
  ancestors: unknown[] = [],
): unknown[] | undefined {
  for (const route of routes) {
    const chain =
      route.element === undefined
        ? ancestors
        : [...ancestors, (route.element as ReactElement).type];
    if (route.path === path) {
      return chain;
    }
    if (route.children !== undefined) {
      const found = findAncestorElementTypes(route.children, path, chain);
      if (found !== undefined) {
        return found;
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

  it("keeps /emergency-menus reachable without completed onboarding, per design spec 632", () => {
    const router = createAppRouter();
    const emergencyAncestors = findAncestorElementTypes(router.routes, "/emergency-menus");
    const plannerAncestors = findAncestorElementTypes(router.routes, "/planner");
    expect(emergencyAncestors).not.toContain(RequireCompletedOnboarding);
    expect(plannerAncestors).toContain(RequireCompletedOnboarding);
    router.dispose();
  });
});
