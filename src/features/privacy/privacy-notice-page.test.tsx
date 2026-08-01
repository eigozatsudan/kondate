import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { shareConsentRequiredPhrases, shareConsentSection } from "./privacy-copy";

type Consent = {
  user_id: string;
  notice_version: string;
  accepted_at: string;
  created_at: string;
};
const acceptConsent = vi.fn<(client: unknown, userId: string) => Promise<Consent>>();
const upsertShare = vi.fn<(client: unknown, accept: boolean) => Promise<unknown>>();

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./privacy-api", () => ({
  acceptCurrentPrivacyConsent: (client: unknown, userId: string) => acceptConsent(client, userId),
}));

vi.mock("./share-consent-api", () => ({
  upsertMyShareConsent: (client: unknown, accept: boolean) => upsertShare(client, accept),
}));

import { MemoryRouter } from "react-router";
import type { ComponentProps } from "react";
import { PrivacyNoticeContent, PrivacyNoticePage } from "./privacy-notice-page";

function renderPrivacyContent(props: ComponentProps<typeof PrivacyNoticeContent>) {
  return render(
    <MemoryRouter>
      <PrivacyNoticeContent {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  acceptConsent.mockReset();
  upsertShare.mockReset();
});

it("explains sent, unsent, and stored data before accepting", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });
  expect(screen.getByRole("heading", { name: "AIへ送る情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AIへ送らない情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "アプリに保存する情報" })).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "確認して進む" });
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: false });
});

it("keeps share consent as a separate card, unchecked by default, without gating primary", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });

  const shareHeading = screen.getByRole("heading", { name: shareConsentSection.title });
  const shareCard = shareHeading.closest("section");
  expect(shareCard).not.toBeNull();
  // privacy チェックと別カードであること
  expect(
    within(shareCard as HTMLElement).queryByRole("checkbox", { name: /説明を確認しました/ }),
  ).toBeNull();

  const shareCheckbox = screen.getByRole("checkbox", {
    name: shareConsentSection.checkboxLabel,
  });
  expect(shareCheckbox).not.toBeChecked();

  const accept = screen.getByRole("button", { name: "確認して進む" });
  // 共有チェックだけでは primary は有効にならない
  await user.click(shareCheckbox);
  expect(shareCheckbox).toBeChecked();
  expect(accept).toBeDisabled();

  // privacy のみで primary が有効（共有は任意のまま）
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  expect(accept).toBeEnabled();
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: true });
});

it("renders all required share-consent phrases for toContain locks", () => {
  renderPrivacyContent({ saving: false, onAccept: vi.fn(), onSkip: vi.fn() });
  const shareHeading = screen.getByRole("heading", { name: shareConsentSection.title });
  const shareCard = shareHeading.closest("section");
  expect(shareCard).not.toBeNull();
  const text = shareCard?.textContent ?? "";
  for (const phrase of shareConsentRequiredPhrases) {
    expect(text).toContain(phrase);
  }
});

it("saves only the privacy consent and navigates to the sanitized returnTo, without touching onboarding status", async () => {
  const user = userEvent.setup();
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  const router = createMemoryRouter(
    [
      { path: "/privacy", element: <PrivacyNoticePage /> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: ["/privacy?returnTo=/planner"] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  // 共有未チェック時は share upsert を呼ばない
  expect(upsertShare).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("upserts share consent only when the optional share checkbox is checked", async () => {
  const user = userEvent.setup();
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  upsertShare.mockResolvedValue({
    consent_version: "2026-08-01.v1",
    accepted_at: "2026-08-01T00:00:00.000Z",
    revoked_at: null,
  });
  const router = createMemoryRouter(
    [
      { path: "/privacy", element: <PrivacyNoticePage /> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: ["/privacy?returnTo=/planner"] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("checkbox", { name: shareConsentSection.checkboxLabel }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).toHaveBeenCalledWith({}, true);
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("review resume 付きの returnTo（review確定直前の遷移）を確認して同じ画面へ戻る", async () => {
  const user = userEvent.setup();
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  // review stepのprivacy未確認導線が組み立てる正確なreturnTo文字列
  // （"/planner?resume=review"）をそのまま使い、往復先が変わらないことを固定する。
  const router = createMemoryRouter(
    [
      { path: "/privacy", element: <PrivacyNoticePage /> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: ["/privacy?returnTo=%2Fplanner%3Fresume%3Dreview"] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/planner");
  expect(router.state.location.search).toBe("?resume=review");
  expect(upsertShare).not.toHaveBeenCalled();
});

it("今はAIを使わない を選んだ場合も同じ returnTo へ戻るが同意を保存しない", async () => {
  const user = userEvent.setup();
  const router = createMemoryRouter(
    [
      { path: "/privacy", element: <PrivacyNoticePage /> },
      { path: "/planner", element: <h1>献立</h1> },
    ],
    { initialEntries: ["/privacy?returnTo=%2Fplanner%3Fresume%3Dreview"] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "今はAIを使わない" }));

  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
  expect(router.state.location.search).toBe("?resume=review");
  expect(acceptConsent).not.toHaveBeenCalled();
  expect(upsertShare).not.toHaveBeenCalled();
});

it("explains sent content across both target modes and no family data for idea mode", () => {
  renderPrivacyContent({ saving: false, onAccept: vi.fn(), onSkip: vi.fn() });
  const sentSection = screen.getByRole("heading", { name: "AIへ送る情報" }).nextElementSibling;
  expect(sentSection?.textContent).toContain("家族の有無に関わらず共通で送る内容");
  expect(sentSection?.textContent).toContain("家族設定を使う場合だけ");
  expect(sentSection?.textContent).toContain(
    "家族設定を使わないアイデア献立では、家族に関する情報は一切送りません",
  );
  // B-I7: 内部 ref / DB 用語を出さない
  expect(sentSection?.textContent).not.toContain("member_1");
  expect(document.body.textContent).not.toContain("データベースID");
  expect(document.body.textContent).not.toContain("未検証のAI生回答");
});

it("offers emergency menus when skipping AI consent (B-I10)", () => {
  renderPrivacyContent({ saving: false, onAccept: vi.fn(), onSkip: vi.fn() });
  const link = screen.getByRole("link", { name: "AIなしの緊急献立を見る" });
  expect(link).toHaveAttribute("href", "/emergency-menus");
});

// F4: 有料を含み得る OpenRouter / 設定モデル提供者への送信を表示し、旧 free-only 文言を出さない
it("explains OpenRouter, configured model providers, and possible paid services without free-only copy", () => {
  renderPrivacyContent({ saving: false, onAccept: vi.fn(), onSkip: vi.fn() });
  const providerSection = screen.getByRole("heading", {
    name: "送信先について",
  }).nextElementSibling;
  expect(providerSection?.textContent).toContain("OpenRouter");
  expect(providerSection?.textContent).toContain("設定されたAIモデルの提供者");
  expect(providerSection?.textContent).toContain("有料");
  // 旧 free-only 方針の文言を残さない
  expect(document.body.textContent).not.toContain("無料モデルのみ");
  expect(document.body.textContent).not.toContain("無料のAIだけ");
  expect(document.body.textContent).not.toContain(":free");
  expect(document.body.textContent).not.toContain("openrouter/auto");
});

it("documents anonymized emergency body retention after account deletion", () => {
  renderPrivacyContent({ saving: false, onAccept: vi.fn(), onSkip: vi.fn() });
  const stored = screen.getByRole("heading", { name: "アプリに保存する情報" }).nextElementSibling;
  expect(stored?.textContent).toContain("匿名一般化済みの緊急候補本文");
  expect(stored?.textContent).toContain("削除後も他ユーザー向けに残ることがあります");
});
