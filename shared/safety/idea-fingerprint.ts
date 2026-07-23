import { createHash } from "node:crypto";

/**
 * アイデアモード専用の安全スナップショット。
 * 家族・アレルゲン・年齢ルールを一切含まず、mode 改変検知のためだけに使う。
 * 現行の家族 fingerprint 関数（非空メンバー前提）とは別物であり混用しない。
 */
export const ideaSafetySnapshot = {
  assurance: "none",
  members: [],
  mode: "idea",
} as const;

/**
 * idea 完了 RPC / TS 側で照合する固定 canonical JSON。
 * キー順・空白なしを固定し、DB の convert_to(..., 'UTF8') と同じバイト列になること。
 */
export const ideaSafetyCanonicalJson = '{"assurance":"none","members":[],"mode":"idea"}' as const;

/** 固定 idea snapshot の SHA-256 lowercase hex。家族表を読まない。 */
export function createIdeaSafetyFingerprint(): string {
  return createHash("sha256").update(ideaSafetyCanonicalJson, "utf8").digest("hex");
}
