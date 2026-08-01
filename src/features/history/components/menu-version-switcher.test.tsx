import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { DerivationVersionSummary } from "../api/history-api";
import { MenuVersionSwitcher } from "./menu-version-switcher";

const A: DerivationVersionSummary = {
  id: "a1000000-0000-4000-8000-000000000001",
  version: 1,
  title: "鮭の塩焼き・味噌汁",
  isSelected: true,
  createdAt: "2026-07-11T09:00:00Z",
  parentMenuId: null,
};
const B: DerivationVersionSummary = {
  id: "a1000000-0000-4000-8000-000000000002",
  version: 2,
  title: "豚の生姜焼き・サラダ",
  isSelected: false,
  createdAt: "2026-07-11T10:00:00Z",
  parentMenuId: A.id,
};
const C: DerivationVersionSummary = {
  id: "a1000000-0000-4000-8000-000000000003",
  version: 3,
  title: "豚の塩こうじ焼き・スープ",
  isSelected: false,
  createdAt: "2026-07-11T11:00:00Z",
  parentMenuId: B.id,
};
const D: DerivationVersionSummary = {
  id: "a1000000-0000-4000-8000-000000000004",
  version: 4,
  title: "鮭のムニエル・スープ",
  isSelected: false,
  createdAt: "2026-07-11T12:00:00Z",
  parentMenuId: A.id,
};

function renderSwitcher(
  versions: readonly DerivationVersionSummary[],
  currentMenuId: string,
  pathForMenuId?: (id: string) => string,
) {
  return render(
    <MemoryRouter>
      {pathForMenuId !== undefined ? (
        <MenuVersionSwitcher
          versions={versions}
          currentMenuId={currentMenuId}
          pathForMenuId={pathForMenuId}
        />
      ) : (
        <MenuVersionSwitcher versions={versions} currentMenuId={currentMenuId} />
      )}
    </MemoryRouter>,
  );
}

describe("MenuVersionSwitcher", () => {
  it("hides when there is only one version", () => {
    const { container } = renderSwitcher([A], A.id);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists all versions and marks current and accepted", () => {
    renderSwitcher([A, B, C, D], C.id);
    expect(screen.getByText(/別案を見比べる（4案）/u)).toBeVisible();
    expect(screen.getByText(/案3 · 表示中/u)).toBeVisible();
    expect(screen.getByText("案1 · 採用")).toBeVisible();
    // C は B から
    expect(screen.getByText("案2から")).toBeVisible();
    // B と D はどちらも A から（2件）
    expect(screen.getAllByText("案1から")).toHaveLength(2);
    // 非表示中は Link
    const linkToA = screen.getByRole("link", { name: /案1/u });
    expect(linkToA).toHaveAttribute("href", `/menus/${A.id}`);
    const linkToD = screen.getByRole("link", { name: /案4/u });
    expect(linkToD).toHaveAttribute("href", `/menus/${D.id}`);
  });

  it("uses custom path builder for history detail", () => {
    renderSwitcher([A, B], B.id, (id) => `/history/${id}`);
    expect(screen.getByRole("link", { name: /案1/u })).toHaveAttribute("href", `/history/${A.id}`);
  });

  it("falls back when parent is missing from the list", () => {
    const orphan: DerivationVersionSummary = {
      ...B,
      parentMenuId: "dead0000-0000-4000-8000-000000000099",
    };
    renderSwitcher([A, orphan], orphan.id);
    expect(screen.getByText("別の案から")).toBeVisible();
  });
});
