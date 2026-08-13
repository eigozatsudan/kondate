import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { shareConsentVersion } from "@shared/contracts/share-consent";
import { shareConsentRequiredPhrases, shareConsentSection } from "./privacy-copy";
import type { ShareConsentState } from "./share-consent-api";

type Consent = {
  user_id: string;
  notice_version: string;
  accepted_at: string;
  created_at: string;
};
const acceptConsent = vi.fn<(client: unknown, userId: string) => Promise<Consent>>();
const upsertShare = vi.fn<(client: unknown, accept: boolean) => Promise<unknown>>();
const getShare = vi.fn<(client: unknown) => Promise<ShareConsentState>>();

/** get_my_share_consent の未同意（行なし相当）。初回は共有チェック既定オン。 */
const unsignedShareState: ShareConsentState = {
  consent_version: null,
  accepted_at: null,
  revoked_at: null,
};

const currentShareState: ShareConsentState = {
  consent_version: shareConsentVersion,
  accepted_at: "2026-08-01T00:00:00.000Z",
  revoked_at: null,
};

const revokedShareState: ShareConsentState = {
  consent_version: shareConsentVersion,
  accepted_at: "2026-08-01T00:00:00.000Z",
  revoked_at: "2026-08-02T00:00:00.000Z",
};

vi.mock("@/features/auth/use-auth", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } } }),
}));

vi.mock("@/shared/lib/supabase", () => ({
  getBrowserSupabaseClient: () => ({}),
}));

vi.mock("./privacy-api", () => ({
  acceptCurrentPrivacyConsent: (client: unknown, userId: string) => acceptConsent(client, userId),
}));

vi.mock("./share-consent-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./share-consent-api")>();
  return {
    ...actual,
    upsertMyShareConsent: (client: unknown, accept: boolean) => upsertShare(client, accept),
    getMyShareConsent: (client: unknown) => getShare(client),
  };
});

import { MemoryRouter } from "react-router";
import type { ComponentProps } from "react";
import {
  PRIVACY_ACCEPT_TIMEOUT_MS,
  PrivacyNoticeContent,
  PrivacyNoticePage,
  privacyConsentCheckboxRequiredMessage,
} from "./privacy-notice-page";

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
  getShare.mockReset();
  // 未同意は初回推奨の既定オン。既存 page テストが実 API を叩かないよう必ず mock する。
  getShare.mockResolvedValue(unsignedShareState);
});

/** 共有同意の読取が終わるまで待つ（pending 中の default true で進まないようにする） */
async function waitForShareConsentReady() {
  await waitFor(() => {
    expect(screen.getByRole("checkbox", { name: shareConsentSection.checkboxLabel })).toBeEnabled();
  });
}

afterEach(() => {
  vi.useRealTimers();
});

it("explains sent, unsent, and stored data before accepting", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });
  expect(screen.getByRole("heading", { name: "AIへ送る情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "AIへ送らない情報" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "アプリに保存する情報" })).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "確認して進む" });
  // 未チェックでも押せる（押下で案内）。保存中だけ disabled。
  expect(accept).toBeEnabled();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
  // 共有は既定オンのまま進む
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: true });
});

it("shows an alert and focuses the checkbox when primary is pressed without consent check", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });

  const accept = screen.getByRole("button", { name: "確認して進む" });
  expect(accept).toBeEnabled();
  await user.click(accept);

  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent(privacyConsentCheckboxRequiredMessage);
  expect(onAccept).not.toHaveBeenCalled();

  const consentCheckbox = screen.getByRole("checkbox", { name: /説明を確認しました/ });
  expect(consentCheckbox).toHaveFocus();
  expect(consentCheckbox).toHaveAttribute("aria-invalid", "true");
  expect(consentCheckbox).toHaveAttribute("aria-describedby", "privacy-consent-checkbox-hint");
  expect(alert).toHaveAttribute("id", "privacy-consent-checkbox-hint");

  // チェックを入れると案内が消え、進められる
  await user.click(consentCheckbox);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(consentCheckbox).not.toHaveAttribute("aria-invalid");
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledOnce();
});

it("keeps share consent as a separate card, checked by default, without gating primary", async () => {
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
  expect(shareCard?.textContent ?? "").toContain(shareConsentSection.defaultCheckedHint);

  const shareCheckbox = screen.getByRole("checkbox", {
    name: shareConsentSection.checkboxLabel,
  });
  expect(shareCheckbox).toBeChecked();

  const accept = screen.getByRole("button", { name: "確認して進む" });
  // 共有を外しても primary は privacy のみ依存（共有は任意・既定オン）
  await user.click(shareCheckbox);
  expect(shareCheckbox).not.toBeChecked();
  // 未チェックでも primary は有効（押下で案内）。共有オフはゲートにしない。
  expect(accept).toBeEnabled();

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  expect(accept).toBeEnabled();
  await user.click(accept);
  expect(onAccept).toHaveBeenCalledWith({ shareConsentAccepted: false });
});

it("accepts share consent by default when user leaves the pre-checked box on", async () => {
  const user = userEvent.setup();
  const onAccept = vi.fn();
  renderPrivacyContent({ saving: false, onAccept, onSkip: vi.fn() });
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));
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

it("saves privacy consent with default-on share and navigates to the sanitized returnTo, without touching onboarding status", async () => {
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

  await waitForShareConsentReady();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  // 既定 share ON のまま進むと upsert する
  expect(upsertShare).toHaveBeenCalledWith({}, true);
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("does not upsert share consent when the optional share checkbox is unchecked", async () => {
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

  await waitForShareConsentReady();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  // 既定 ON を外してから accept → share upsert しない
  await user.click(screen.getByRole("checkbox", { name: shareConsentSection.checkboxLabel }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("AP1: revoked share row leaves the box unchecked and does not upsert true", async () => {
  const user = userEvent.setup();
  getShare.mockResolvedValue(revokedShareState);
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

  await waitForShareConsentReady();
  const shareCheckbox = screen.getByRole("checkbox", {
    name: shareConsentSection.checkboxLabel,
  });
  expect(shareCheckbox).not.toBeChecked();

  // 共有ボックスは触らず必須チェックだけ入れて進む → 再 accept しない
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).not.toHaveBeenCalledWith({}, true);
  expect(upsertShare).not.toHaveBeenCalled();
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("AP1: current share consent can be revoked by unchecking before accept", async () => {
  const user = userEvent.setup();
  getShare.mockResolvedValue(currentShareState);
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  upsertShare.mockResolvedValue({
    consent_version: shareConsentVersion,
    accepted_at: "2026-08-01T00:00:00.000Z",
    revoked_at: "2026-08-02T00:00:00.000Z",
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

  await waitForShareConsentReady();
  const shareCheckbox = screen.getByRole("checkbox", {
    name: shareConsentSection.checkboxLabel,
  });
  expect(shareCheckbox).toBeChecked();

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(shareCheckbox);
  expect(shareCheckbox).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).toHaveBeenCalledWith({}, false);
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("AP1: unsigned null fields keep default-on share and upsert true", async () => {
  const user = userEvent.setup();
  getShare.mockResolvedValue(unsignedShareState);
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  upsertShare.mockResolvedValue({
    consent_version: shareConsentVersion,
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

  await waitForShareConsentReady();
  expect(screen.getByRole("checkbox", { name: shareConsentSection.checkboxLabel })).toBeChecked();

  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).toHaveBeenCalledWith({}, true);
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
});

it("共有同意 RPC が失敗しても必須 privacy 同意後は returnTo へ進む", async () => {
  const user = userEvent.setup();
  acceptConsent.mockResolvedValue({
    user_id: "user-1",
    notice_version: "2026-07-29.v1",
    accepted_at: "2026-07-12T00:00:00.000Z",
    created_at: "2026-07-12T00:00:00.000Z",
  });
  upsertShare.mockRejectedValue(new Error("共有の同意を保存できませんでした"));
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

  await waitForShareConsentReady();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  // 既定 ON のまま（外さない）→ upsert が呼ばれ reject しても遷移継続
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  await waitFor(() => {
    expect(acceptConsent).toHaveBeenCalledWith({}, "user-1");
  });
  expect(upsertShare).toHaveBeenCalledWith({}, true);
  // 任意 share 失敗で必須 privacy を巻き戻さず遷移する
  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("review resume 付きの returnTo（review確定直前の遷移）を確認して同じ画面へ戻る", async () => {
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

  await waitForShareConsentReady();
  await user.click(screen.getByRole("checkbox", { name: /説明を確認しました/ }));
  await user.click(screen.getByRole("button", { name: "確認して進む" }));

  expect(await screen.findByRole("heading", { name: "献立" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/planner");
  expect(router.state.location.search).toBe("?resume=review");
  // 既定 share ON のまま resume へ戻る
  expect(upsertShare).toHaveBeenCalledWith({}, true);
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

it("AP8: accept hang times out so skip is re-enabled", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    acceptConsent.mockReturnValue(new Promise(() => undefined));
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
    expect(screen.getByRole("button", { name: "保存中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "今はAIを使わない" })).toBeDisabled();

    await vi.advanceTimersByTimeAsync(PRIVACY_ACCEPT_TIMEOUT_MS + 50);

    expect(await screen.findByRole("alert")).toHaveTextContent("確認状態を保存できませんでした");
    expect(screen.getByRole("button", { name: "今はAIを使わない" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "確認して進む" })).not.toBeDisabled();
  } finally {
    vi.useRealTimers();
  }
});
