/**
 * 苦手食材の登録名。addMemberDislike が insert 前に行う NFKC と trim と同じにする。
 * 保存する文字列には toLowerCase を掛けない。比較だけ dislikeIdentity を使う。
 * JavaScript の toLowerCase と PostgreSQL の lower() は U+0130 などでずれ得る。
 * household-api は変えず、ずれた追加は保存処理の失敗後の読み直しで吸収する。
 */
export function normalizeDislikeName(raw: string): string {
  return raw.normalize("NFKC").trim();
}

/** 登録の同一性。かな折りたたみはしない（ピーマンとぴーまんは別）。 */
export function dislikeIdentity(raw: string): string {
  return normalizeDislikeName(raw).toLowerCase();
}

export type DislikeNameLength = "empty" | "too_long" | "ok";

/** 文字数は addMemberDislike と同じく、正規化後の JavaScript の string.length。 */
export function dislikeNameLength(raw: string): DislikeNameLength {
  const length = normalizeDislikeName(raw).length;
  if (length < 1) return "empty";
  if (length > 80) return "too_long";
  return "ok";
}
