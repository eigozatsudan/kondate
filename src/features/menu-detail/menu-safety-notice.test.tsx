import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  EASE_SOFT_NOT_SWALLOW_DISCLAIMER,
  MENU_LABEL_DISCLAIMER,
} from "@/features/generation/components/idea-menu-safety-notice";
import { MenuSafetyNotice } from "./menu-safety-notice";

it("always shows locked safety disclaimers and never a safety guarantee", () => {
  render(<MenuSafetyNotice section="disclaimers" />);
  expect(screen.getByText(MENU_LABEL_DISCLAIMER)).toBeVisible();
  expect(screen.getByText(EASE_SOFT_NOT_SWALLOW_DISCLAIMER)).toBeVisible();
  expect(screen.getByText(/AIが作成した献立です/u)).toBeVisible();
  expect(screen.getByText(/調理前に確認してください/u)).toBeVisible();
  expect(screen.queryByText(/安全です/u)).not.toBeInTheDocument();
  expect(screen.queryByText(/対応済み/u)).not.toBeInTheDocument();
});

it("bundles the three disclaimers into a single Surface card (UX U1)", () => {
  render(<MenuSafetyNotice section="disclaimers" />);
  // レビュー M-5: Surface の個数だけでなく、3 文それぞれが「同じ」Surface の
  // 子孫であることを closest で確かめる（外に漏れていても Surface が 1 枚なら
  // green になってしまう抜け道を塞ぐ）。
  const label = screen.getByText(MENU_LABEL_DISCLAIMER);
  const ease = screen.getByText(EASE_SOFT_NOT_SWALLOW_DISCLAIMER);
  const aiCreated = screen.getByText(/AIが作成した献立です/u);
  const surface = label.closest(".ui-surface");
  expect(surface).not.toBeNull();
  expect(ease.closest(".ui-surface")).toBe(surface);
  expect(aiCreated.closest(".ui-surface")).toBe(surface);
});

it("exposes checking as role=status with busy", () => {
  render(
    <MenuSafetyNotice
      section="revalidation"
      phase="checking"
      isOfflineHold={false}
      statusCopy={null}
    />,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-busy", "true");
  expect(status).toHaveTextContent("この献立の対象家族の設定で確認しています");
});

it("exposes error copy as role=alert and a retry control", () => {
  const onRetry = vi.fn();
  render(
    <MenuSafetyNotice
      section="revalidation"
      phase="error"
      isOfflineHold={false}
      statusCopy="確認できませんでした"
      onRetry={onRetry}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("確認できませんでした");
  expect(screen.getByRole("button", { name: "もう一度確認" })).toBeVisible();
});

it("exposes invalid issues under role=alert", () => {
  render(
    <MenuSafetyNotice
      section="revalidation"
      phase="checked"
      isOfflineHold={false}
      statusCopy={null}
      invalidIssues={[
        { code: "allergen_present", path: "dishes.0", message: "アレルゲンが含まれます" },
      ]}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("この献立の対象家族の設定では利用できません");
  expect(alert).toHaveTextContent("アレルゲンが含まれます");
});

it("exposes gate status as role=status when open", () => {
  render(
    <MenuSafetyNotice
      section="gate"
      statusCopy="この献立の対象家族の設定で確認しました"
      showGateStatus
      changedDetailLines={["好みの設定が変わっています"]}
    />,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("この献立の対象家族の設定で確認しました");
  expect(status).toHaveTextContent("好みの設定が変わっています");
});
