/**
 * Mailpit 本文から確認番号を抜く純関数。
 * 製品テンプレは URL を置かない。http/https が 1 つでもあれば
 * マジックリンク経路が残っているので throw する（fail-closed）。
 * 番号そのものは返すが、呼び出し側も console に出さない。
 */
export function parseMailpitOtpCode(body: string): string {
  // https は http の接頭辞だが、両方を明示して URL 残存を落とす
  if (body.includes("http") || body.includes("https")) {
    throw new Error("Mailpit body contained an http(s) fragment");
  }

  const matches = body.match(/(?<!\d)\d{6}(?!\d)/gu);
  const code = matches?.[0];
  if (matches === null || matches.length !== 1 || code === undefined) {
    throw new Error("Mailpit body did not contain exactly one 6-digit code");
  }
  return code;
}
