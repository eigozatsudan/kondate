import { expect, it } from "vitest";
import {
  accountDeletionAnonymousShareNote,
  privacySections,
  shareConsentRequiredPhrases,
  shareConsentSection,
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

it("keeps share consent optional and separate from AI privacy sections", () => {
  expect(shareConsentSection.title).toMatch(/任意|協力/);
  expect(shareConsentSection.checkboxLabel).toContain("匿名");
  // 必須の AI 説明セクションに共有同意を混ぜない
  for (const section of privacySections) {
    expect(section.title).not.toBe(shareConsentSection.title);
  }
});
