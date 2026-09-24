import { expect, it } from "vitest";
import {
  accountDeletionAnonymousShareNote,
  accountDeletionOtherDeviceNote,
  accountDeletionProviderPromptNote,
  accountDeletionSharedDeviceNote,
  accountDeletionStripeResidualNote,
  accountDeletionThisDeviceResidualNote,
  privacySections,
  shareConsentRequiredPhrases,
  shareConsentSection,
  shareConsentSettingsCopy,
  shareInFlightSendNote,
  splitConsentSentences,
} from "./privacy-copy";

it("locks the six required share-consent phrases for UI copy", () => {
  // 設計 §7.1: 共有チェック文言に必ず含める 6 点を定数配列で固定する
  expect(shareConsentRequiredPhrases).toHaveLength(6);
  for (const phrase of shareConsentRequiredPhrases) {
    expect(shareConsentSection.body).toContain(phrase);
  }
});

it("requires each mandated share-consent concept in the phrase list", () => {
  const joined = shareConsentRequiredPhrases.join("\n");
  expect(joined).toContain("ランダム");
  expect(joined).toContain("選べ");
  expect(joined).toContain("家族の呼び名");
  expect(joined).toContain("アレルギー設定そのものは共有");
  expect(joined).toContain("一般化してから");
  expect(joined).toContain("誰が作ったか");
  expect(joined).toMatch(/残/);
  expect(joined).toContain("安全は保証");
});

it("documents that anonymized emergency body may remain after account deletion", () => {
  const stored = privacySections.find((section) => section.title === "アプリに保存する情報");
  expect(stored).toBeDefined();
  expect(stored?.body).toContain(accountDeletionAnonymousShareNote);
  expect(accountDeletionAnonymousShareNote).toContain("匿名");
  expect(accountDeletionAnonymousShareNote).toContain("残る");
  expect(accountDeletionAnonymousShareNote).toContain("誰が作ったか");
});

it("discloses Stripe residual, provider prompt residual, and in-flight share send", () => {
  const stored = privacySections.find((section) => section.title === "アプリに保存する情報");
  expect(stored?.body).toContain(accountDeletionStripeResidualNote);
  expect(stored?.body).toContain(accountDeletionProviderPromptNote);
  expect(accountDeletionStripeResidualNote).toContain("Stripe");
  expect(accountDeletionProviderPromptNote).toContain("消えません");
  expect(shareConsentSection.body).toContain(shareInFlightSendNote);
  expect(shareConsentSettingsCopy.residualRetentionNotice).toContain(shareInFlightSendNote);
  expect(shareConsentSettingsCopy.revokeFailed).toContain("共有の停止");
  expect(accountDeletionOtherDeviceNote).toContain("他の端末");
  expect(accountDeletionSharedDeviceNote).toContain("共有");
});

it("AP8: this-device residual note is locked for the success banner", () => {
  expect(accountDeletionThisDeviceResidualNote).toContain("この端末");
  expect(accountDeletionThisDeviceResidualNote).toContain("残っている");
});

it("keeps share consent optional and separate from AI privacy sections", () => {
  expect(shareConsentSection.title).toMatch(/任意|協力/);
  expect(shareConsentSection.checkboxLabel).toContain("匿名");
  // 必須の AI 説明セクションに共有同意を混ぜない
  for (const section of privacySections) {
    expect(section.title).not.toBe(shareConsentSection.title);
  }
});

it("documents pre-checked share consent without recommendation tone", () => {
  expect(shareConsentSection.defaultCheckedHint).toContain("最初からチェックが入っています");
  expect(shareConsentSection.defaultCheckedHint).toContain("不要なら外してください");
  expect(shareConsentSection.defaultCheckedHint).not.toMatch(/ぜひ|おすすめ|推奨/u);
});

it("AP-R1: unconfirmed reconcile copy refuses to claim off", () => {
  expect(shareConsentSettingsCopy.reconcileUnconfirmed).toContain("確認できませんでした");
  expect(shareConsentSettingsCopy.reconcileUnconfirmed).toContain("分からない");
  expect(shareConsentSettingsCopy.reconcileRetry).toContain("再読み込み");
});

it("locks residual retention copy for settings toggle off", () => {
  // 設計 §7.2: オフ操作時にも「既提供分は残る」を再表示
  expect(shareConsentSettingsCopy.residualRetentionNotice).toContain("既提供分は残");
  expect(shareConsentSettingsCopy.residualRetentionNotice).toContain("残り");
  expect(shareConsentSettingsCopy.toggleLabel).toContain("匿名");
  expect(shareConsentSettingsCopy.sharedListTitle).toMatch(/提供/);
});

it("AP6: settings accept disclosure includes every required share-consent phrase", () => {
  for (const phrase of shareConsentRequiredPhrases) {
    expect(shareConsentSettingsCopy.acceptDisclosure).toContain(phrase);
  }
});

it("discloses that liked dish and ingredient names are sent for up to 90 days", () => {
  const section = privacySections.find((entry) => entry.title === "AIへ送る情報");
  expect(section).toBeDefined();
  expect(section?.body).toMatch(/料理名と食材名/u);
  // overusedIngredients は ★ の付いていない献立も母集団に含むため、
  // 「お気に入り由来」だけの記述では実際に送る範囲より狭い
  expect(section?.body).toMatch(/繰り返し指定したメイン食材名/u);
  expect(section?.body).toMatch(/90日/u);
  expect(section?.body).toMatch(/50献立/u);
  expect(section?.body).toMatch(/好みの学習は設定でいつでも止められます/u);
});

it("discloses that dish names of recent menus are sent to avoid repeats", () => {
  const section = privacySections.find((entry) => entry.title === "AIへ送る情報");
  expect(section).toBeDefined();
  // diversity-hints の RECENT_MENUS_LIMIT（10）と同じ上限を告知する
  expect(section?.body).toMatch(/直近の献立（最大10献立）の料理名/u);
});

it("U6: splits settings consent copy into bullet sentences without dropping a character", () => {
  // 同意の説明は分割して箇条書きにするだけ。連結すると元の文と完全に一致しなければならない
  for (const text of [
    shareConsentSettingsCopy.help,
    shareConsentSettingsCopy.acceptDisclosure,
    shareConsentSettingsCopy.residualRetentionNotice,
  ]) {
    const sentences = splitConsentSentences(text);
    expect(sentences.length).toBeGreaterThan(1);
    expect(sentences.join("")).toBe(text);
  }
  expect(splitConsentSentences(shareConsentSettingsCopy.acceptDisclosure)).toEqual(
    shareConsentRequiredPhrases.map((phrase) => (phrase.endsWith("。") ? phrase : `${phrase}。`)),
  );
});
