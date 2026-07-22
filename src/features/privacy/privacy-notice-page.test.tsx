import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

type Consent = {
  user_id: string;
  notice_version: string;
  accepted_at: string;
  created_at: string;
};
const acceptConsent = vi.fn<(client: unknown, userId: string) => Promise<Consent>>();

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./privacy-api", () => ({
  acceptCurrentPrivacyConsent: (client: unknown, userId: string) => acceptConsent(client, userId),
}));

import { PrivacyNoticeContent, PrivacyNoticePage } from "./privacy-notice-page";

it("explains sent, unsent, and stored data before accepting", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  render(<PrivacyNoticeContent saving={false} onAccept={onAccept} onSkip={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "AIへ送る情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AIへ送らない情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "アプリに保存する情報" })).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "確認して進む" });
  expect(accept).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
});

it("saves only the privacy consent and navigates to the sanitized returnTo, without touching onboarding status", async () => {
  const user = userEvent.setup();
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-11.v1",
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
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("explains sent content across both target modes and no family data for idea mode", () => {
  render(<PrivacyNoticeContent saving={false} onAccept={vi.fn()} onSkip={vi.fn()} />);
  const sentSection = screen.getByRole("heading", { name: "AIへ送る情報" }).nextElementSibling;
  expect(sentSection?.textContent).toContain("家族の有無に関わらず共通で送る内容");
  expect(sentSection?.textContent).toContain("家族設定を使う場合だけ");
  expect(sentSection?.textContent).toContain(
    "家族設定を使わないアイデア献立では、家族に関する情報は一切送りません",
  );
});
