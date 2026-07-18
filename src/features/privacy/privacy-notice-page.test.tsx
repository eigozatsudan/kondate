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
type Profile = { user_id: string; onboarding_status: string };
const completeOnboarding =
  vi.fn<(client: unknown, userId: string, status: "complete") => Promise<Profile>>();
const acceptConsent = vi.fn<(client: unknown, userId: string) => Promise<Consent>>();

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("@/features/household/household-api", () => ({
  setOnboardingStatus: (client: unknown, userId: string, status: "complete") =>
    completeOnboarding(client, userId, status),
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

it("completes onboarding only after privacy consent is accepted", async () => {
  const user = userEvent.setup();
  const order: string[] = [];
  acceptConsent.mockImplementation(() => {
    order.push("consent");
    return Promise.resolve({
      user_id: "user-1",
      notice_version: "2026-07-11.v1",
      accepted_at: "2026-07-12T00:00:00.000Z",
      created_at: "2026-07-12T00:00:00.000Z",
    });
  });
  completeOnboarding.mockImplementation(() => {
    order.push("complete");
    return Promise.resolve({ user_id: "user-1", onboarding_status: "complete" });
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
    expect(completeOnboarding).toHaveBeenCalledWith({}, "user-1", "complete");
  });
  expect(order).toEqual(["consent", "complete"]);
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});
