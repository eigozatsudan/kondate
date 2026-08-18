/**
 * health（token 免除）と listen stdout が同じ丸めを使う。
 * project-ref / Session pooler リージョンをログ共有や公開 JSON に残さない。
 * パスワードは connectionHostLabel 側で既に落ちている。ここでも再導入しない。
 */
import { connectionHostLabel } from "../config.js";

/** direct host の 20 文字 project-ref */
const DIRECT_HOST_REF_RE = /^db\.[a-z0-9]{20}\.supabase\.co(?=:\d+$|$)/iu;
/** pooler 先頭ラベル（aws-0-ap-northeast-1 等）にリージョンが載る */
const POOLER_HOST_RE = /^[a-z0-9-]+\.pooler\.supabase\.com(?=:\d+$|$)/iu;
/** pooler session_user の role.ref */
const SESSION_USER_REF_RE = /^kondate_ops_readonly\.[a-z0-9]{20}$/iu;

/** health / startup 用。dashboard（token 必須）の表示は生の host のまま */
export function redactHealthConnectionHost(label: string): string {
  const withoutDirectRef = label.replace(DIRECT_HOST_REF_RE, "db.***.supabase.co");
  if (withoutDirectRef !== label) {
    return withoutDirectRef;
  }
  return label.replace(POOLER_HOST_RE, "***.pooler.supabase.com");
}

/** health / startup 用。role.ref の project-ref だけ伏せる */
export function redactHealthSessionUser(user: string | null): string | null {
  if (user === null) return null;
  return SESSION_USER_REF_RE.test(user) ? "kondate_ops_readonly.***" : user;
}

export type AdminListenLogInput = {
  bindHost: string;
  port: number;
  databaseUrl: string;
  sessionUser: string;
};

/**
 * listen 直前の 1 行。health と同じ丸め。userinfo / パスワードは載せない。
 */
export function formatAdminListenLog(input: AdminListenLogInput): string {
  const hostLabel = redactHealthConnectionHost(connectionHostLabel(input.databaseUrl));
  const sessionUser = redactHealthSessionUser(input.sessionUser) ?? input.sessionUser;
  return `[admin] listening on ${input.bindHost}:${input.port} (db host=${hostLabel}, session_user=${sessionUser})`;
}
