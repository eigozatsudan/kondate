import type { ReactElement } from "react";
import type { DataRouteObject } from "react-router";
import { describe, expect, it } from "vitest";
import { RequireSession } from "@/features/auth/protected-routes";
import { MenuResultPage } from "@/features/generation/pages/menu-result-page";
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
    expect(emergencyAncestors).not.toContain(undefined);
    router.dispose();
  });

  it("registers /menus/:menuId under RequireSession (not a completed-onboarding guard) with MenuResultPage", () => {
    const router = createAppRouter();
    const route = findRoute(router.routes, "/menus/:menuId");
    const ancestors = findAncestorElementTypes(router.routes, "/menus/:menuId");

    expect(route).toBeDefined();
    expect(ancestors).toContain(RequireSession);
    expect(route?.element).toBeDefined();
    expect((route?.element as ReactElement).type).toBe(MenuResultPage);
    router.dispose();
  });

  // Step 10: RequireCompletedOnboarding は撤去済みで、家族設定は任意になった。
  // 主要な家庭内 route は RequireSession だけを通り、AppShell 配下に直接配置される。
  it.each(["/planner", "/generation", "/pantry", "/history", "/shopping", "/settings"])(
    "%s は RequireSession 配下にあり、完了済みonboardingガード配下ではない",
    (path) => {
      const router = createAppRouter();
      const ancestors = findAncestorElementTypes(router.routes, path);
      expect(ancestors).toContain(RequireSession);
      router.dispose();
    },
  );

  it("/welcome と /onboarding は RequireSession 配下に置かれる", () => {
    const router = createAppRouter();
    for (const path of ["/welcome", "/onboarding"]) {
      const ancestors = findAncestorElementTypes(router.routes, path);
      expect(ancestors).toContain(RequireSession);
    }
    router.dispose();
  });

  it("/ は RootEntryPage を経由してprofile statusに応じて振り分ける（route自体はRequireSession配下）", () => {
    const router = createAppRouter();
    const ancestors = findAncestorElementTypes(router.routes, "/");
    expect(ancestors).toContain(RequireSession);
    router.dispose();
  });
});
