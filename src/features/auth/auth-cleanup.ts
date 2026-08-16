import type { SupabaseClient } from "@supabase/supabase-js";
// Database の公開入口は generated 直 import ではなく re-export 側を使う（既存 client と同一）。
import type { Database } from "@/shared/types/database";
import { householdSafetyRevisionStorageKey } from "@/features/household/household-queries";
import { withTimeout } from "./async-timeout";
import {
  browserSupabaseSessionStorageKey,
  clearBrowserSupabaseSessionStorage,
  clearOwnedAuthStorage,
  ownedAuthStoragePrefixes,
} from "./auth-flow";
// C4/R3/R4: suppress 正本は leaf に置き auth-flow 循環を避ける。公開 API は本モジュールから re-export。
import {
  markSoftResidualRecoverySuppressed,
  SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY,
} from "./soft-residual-recovery-suppress";

/**
 * C4/R3/R4: soft residual suppress の公開入口（正本は soft-residual-recovery-suppress）。
 * clear 時は R4 re-arm イベントを発火し、AuthProvider residual を同一マウントで再開する。
 */
export {
  clearSoftResidualRecoverySuppressed,
  isSoftResidualRecoverySuppressed,
  markSoftResidualRecoverySuppressed,
  SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY,
} from "./soft-residual-recovery-suppress";

export type ClearLocalAuthOptions = {
  /**
   * 通常ログアウト・アカウント削除後は local（この端末のみ）。
   * 全端末の refresh を無効化したい経路だけ global を明示する。
   * global 失敗時は local にフォールバックする。
   */
  signOutScope?: "local" | "global";
};

/**
 * signOut の上限。gotrue は local でも logout API を await し、
 * hang すると storage 掃除と後続遷移が永久に止まる（A2）。
 */
export const SIGN_OUT_TIMEOUT_MS = 4_000;

/** マジックリンク宛先・送信 UI（sessionStorage）。owned prefix 外のため明示掃除。 */
const MAGIC_LINK_RESIDUAL_KEYS = [
  "kondate.auth.lastMagicEmail",
  "kondate.auth.magicSentUi",
  // C2/C13: 今開始した login flow（session + origin 共有 local）。logout / 401 後に次ユーザの residual target にしない
  "kondate.auth.active-login-flow",
  // leftover 成功印。logout 後に残すと次ユーザの leftover 例外になる
  "kondate.auth.emailOtpCompleted",
] as const;

/**
 * R3: soft residual で消してよい kondate.auth.* か。
 * 共有端末の prior-user residual complete（C4）を閉じつつ、sibling タブ in-flight の
 * flow secret / PKCE / callback-owner は焼かない。
 *
 * 消す:
 * - session 永続キー（exact）
 * - continuation-complete（resume short-circuit）
 * - magic-link UI
 * - soft residual suppress 以外の auth UI 残渣で flow 継続に不要なもの
 *
 * 残す（sibling mid-login / C4 suppress）:
 * - kondate.auth.flow.*
 * - callback-owner / flow-user-dismissed / clock-rebase
 * - PKCE verifier（storageKey 派生の -code-verifier）
 * - claim-poll lease 系（exchange / target-lease / last-at）。既起動 residual の
 *   5s 床と callback-owned lease を焼かない（C1: wipe 直後の orphan 再 claim 抑止）
 * - soft residual suppress 印自体（localStorage 共有; mark 後に再設定）
 * - callback-owner がある pending-deposit（C-R3: strip 後 re-deposit 正本）
 *
 * 消す（共有端末の prior-user code / token_hash 平文）:
 * - callback-owner の無い pending-deposit（C5）
 */
function shouldClearAuthKeyOnSoftResidual(key: string, storage: Storage): boolean {
  // C4 共有 suppress 印は soft 掃除ループで落とさない（直後 mark と二重化してよい）
  if (key === SOFT_RESIDUAL_RECOVERY_SUPPRESS_KEY) return false;
  if ((MAGIC_LINK_RESIDUAL_KEYS as readonly string[]).includes(key)) return true;
  if (key === browserSupabaseSessionStorageKey) return true;
  // completion 印（per-flow / legacy）: soft 後の resume short-circuit を閉じる（C4）
  if (
    key === `${ownedAuthStoragePrefixes[1]}.continuation-complete` ||
    key.startsWith(`${ownedAuthStoragePrefixes[1]}.continuation-complete.`)
  ) {
    return true;
  }
  // sibling in-flight に必要なキーは温存
  if (key.startsWith(ownedAuthStoragePrefixes[0])) return false; // flow.
  const pendingPrefix = `${ownedAuthStoragePrefixes[1]}.pending-deposit.`;
  if (key.startsWith(pendingPrefix)) {
    const flowId = key.slice(pendingPrefix.length);
    // C-R3: callback タブが owner を立てている mid-login pending は残す。
    // owner 無しは共有端末の prior-user 平文として消す（C5）。
    if (flowId !== "") {
      try {
        if (storage.getItem(`${ownedAuthStoragePrefixes[1]}.callback-owner.${flowId}`) !== null) {
          return false;
        }
      } catch {
        // owner が読めないときは C5 どおり消す
      }
    }
    return true;
  }
  if (key.startsWith(`${ownedAuthStoragePrefixes[1]}.callback-owner.`)) return false;
  if (key.startsWith(`${ownedAuthStoragePrefixes[1]}.flow-user-dismissed.`)) return false;
  if (key.startsWith(`${ownedAuthStoragePrefixes[1]}.clock-rebase.`)) return false;
  // C1: 既起動 residual / callback の claim-poll lease。未知残渣として消すと last-at 床が消え
  // lease 0 の callback-owned が orphan 再 claim → 単回 IdP code の dual exchange になる。
  const claimPollPrefix = `${ownedAuthStoragePrefixes[1]}.claim-poll`;
  if (key === `${claimPollPrefix}-last-at`) return false;
  if (key.startsWith(`${claimPollPrefix}-exchange.`)) return false;
  if (key.startsWith(`${claimPollPrefix}-target-lease.`)) return false;
  // PKCE verifier（createBrowserSupabaseClient の storageKey + "-code-verifier"）
  if (key === `${browserSupabaseSessionStorageKey}-code-verifier`) return false;
  if (key.startsWith(`${browserSupabaseSessionStorageKey}-code-verifier`)) return false;
  // その他 kondate.auth.*（未知の残渣）は共有端末 hygiene で消す
  if (key.startsWith("kondate.auth.")) return true;
  return false;
}

function isOwnedBrowserStorageKey(key: string): boolean {
  return (
    key.startsWith("kondate.auth.") ||
    key.startsWith("kondate:generation:") ||
    key.startsWith("kondate:shopping:") ||
    // PE1: チラシ sticky Idempotency-Key（local/session）
    key.startsWith("kondate:flyer:") ||
    // PE8: 期限切れ pantry の当日確認（緊急導線・直接 URL 共有）
    key.startsWith("kondate:expired-pantry-confirm:") ||
    // AP1: feedback 曖昧失敗 fingerprint（free-form 本文を含む）。ログアウト/削除後は sticky 不要
    key.startsWith("kondate:feedback:") ||
    key === householdSafetyRevisionStorageKey ||
    // U4-003: user-scoped revision キーも掃除
    key.startsWith(`${householdSafetyRevisionStorageKey}:`) ||
    (MAGIC_LINK_RESIDUAL_KEYS as readonly string[]).includes(key)
  );
}

function clearOwnedBrowserStorage(): void {
  for (const storage of [localStorage, sessionStorage]) {
    // clearOwnedAuthStorage は auth prefix をまとめて消す。失敗しても key 単位で続ける。
    try {
      clearOwnedAuthStorage(storage);
    } catch {
      // 下の key 単位パスへ
    }
    for (const key of MAGIC_LINK_RESIDUAL_KEYS) {
      try {
        storage.removeItem(key);
      } catch {
        // 個別キー失敗は共有端末残差として許容（Auth はサーバ側で消えている）
      }
    }
    let keys: string[] = [];
    try {
      keys = Object.keys(storage);
    } catch {
      continue;
    }
    for (const key of keys) {
      if (
        key.startsWith("kondate:generation:") ||
        key.startsWith("kondate:shopping:") ||
        key.startsWith("kondate:flyer:") ||
        key.startsWith("kondate:expired-pantry-confirm:") ||
        // AP1: ログアウト/削除成功時に free-form fingerprint 残差を消す
        key.startsWith("kondate:feedback:") ||
        key === householdSafetyRevisionStorageKey ||
        key.startsWith(`${householdSafetyRevisionStorageKey}:`)
      ) {
        try {
          storage.removeItem(key);
        } catch {
          // 個別キー失敗は共有端末残差として許容
        }
      }
    }
  }
}

/**
 * AP8: 削除成功後に当該端末へ owned key が残っているか。
 * 列挙できないときは残存の可能性を否定できないので true（fail-closed）。
 */
export function hasOwnedLocalDataResidual(): boolean {
  for (const storage of [localStorage, sessionStorage]) {
    let keys: string[] = [];
    try {
      keys = Object.keys(storage);
    } catch {
      return true;
    }
    for (const key of keys) {
      if (isOwnedBrowserStorageKey(key)) return true;
    }
  }
  return false;
}

/**
 * signOut なしで owned ローカルデータを消す（AP5 second pass）。
 * アカウント削除成功後に clearLocalAuthAndDrafts が throw したとき、
 * 共有端末に draft / pending が残らないよう key 単位 best-effort で再試行する。
 */
export function clearOwnedLocalDataBestEffort(): void {
  for (const storage of [localStorage, sessionStorage]) {
    let keys: string[] = [];
    try {
      keys = Object.keys(storage);
    } catch {
      continue;
    }
    for (const key of keys) {
      if (!isOwnedBrowserStorageKey(key)) continue;
      try {
        storage.removeItem(key);
      } catch {
        // 1 キー失敗で他キー掃除を止めない
      }
    }
  }
}

/**
 * soft 失効（authenticated → session null）専用の残渣掃除（C4 / C3 / C10 / R3）。
 *
 * free-form 草稿・feedback・session 永続・マジックリンク UI・completion 印を消す。
 *
 * C4: residual recovery が前ユーザとして silent complete しないこと。
 * 旧実装は `kondate.auth.*` 全消しで secret も焼いたが、sibling タブ in-flight login まで
 * 巻き添えにした（R3）。R3 以降は:
 * - flow secret / PKCE / callback-owner / claim-poll lease は温存（sibling mid-login）
 * - pending-deposit は callback-owner がある sibling mid-login だけ残し、
 *   prior-user 平文は消す（C5 / C-R3）
 * - completion と session キーは消す（resume short-circuit / persist token）
 * - residual recovery を origin 共有 localStorage suppress で抑止（C4: 新タブ含む）
 *
 * cold-start 未ログイン fail-closed（RR1）は session キーのみで、この関数を呼ばない。
 * 明示 logout / アカウント削除の second pass（clearOwnedLocalDataBestEffort）は
 * drafts 等も含むより広い掃除のまま（flow も消す）。
 */
export function clearSoftSessionResidualBestEffort(): void {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      clearBrowserSupabaseSessionStorage(storage);
    } catch {
      // best-effort
    }
    for (const key of MAGIC_LINK_RESIDUAL_KEYS) {
      try {
        storage.removeItem(key);
      } catch {
        // 個別キー失敗は許容
      }
    }
    let keys: string[] = [];
    try {
      keys = Object.keys(storage);
    } catch {
      continue;
    }
    for (const key of keys) {
      if (key.startsWith("kondate.auth.")) {
        // R3: sibling in-flight に必要なキーは残し、C4 対象（session/completion 等）だけ消す
        if (!shouldClearAuthKeyOnSoftResidual(key, storage)) continue;
        try {
          storage.removeItem(key);
        } catch {
          // 1 キー失敗で他キー掃除を止めない
        }
        continue;
      }
      if (!isOwnedBrowserStorageKey(key)) continue;
      try {
        storage.removeItem(key);
      } catch {
        // 1 キー失敗で他キー掃除を止めない
      }
    }
  }
  // C4: origin 共有 suppress（secret を焼かずに新タブ含む residual silent complete を閉じる）
  markSoftResidualRecoverySuppressed();
}

/**
 * C5: 401 / session 失効用。session + 草稿 + prior-user pending は消し、R3 keep
 * （flow / PKCE / callback-owner / sibling mid-login pending / C1 claim-poll lease）は残す。
 * 明示 logout / アカウント削除は clearLocalAuthAndDrafts（全所有キー）のまま。
 */
export async function clearExpiredSessionAuthAndDrafts(
  client: SupabaseClient<Database>,
): Promise<void> {
  try {
    await withTimeout(signOutBestEffort(client, "local"), SIGN_OUT_TIMEOUT_MS);
  } catch {
    // timeout / throw — storage は下で soft residual する
  }
  clearSoftSessionResidualBestEffort();
}

async function signOutBestEffort(
  client: SupabaseClient<Database>,
  scope: "local" | "global",
): Promise<void> {
  if (scope === "global") {
    await client.auth
      .signOut({ scope: "global" })
      .catch(() => client.auth.signOut({ scope: "local" }).catch(() => undefined));
    return;
  }
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
}

/**
 * ログアウト / アカウント削除成功後に端末側の認証・復帰データを消す。
 * Plan 1 の ownedAuthStoragePrefixes 経由の clearOwnedAuthStorage だけを使い、
 * 広義の sb- 規則や auth 接頭辞の二重定義はしない。
 * signOut が失敗・timeout しても storage 掃除は必ず完了させる。
 */
export async function clearLocalAuthAndDrafts(
  client: SupabaseClient<Database>,
  options: ClearLocalAuthOptions = {},
): Promise<void> {
  const scope = options.signOutScope ?? "local";
  // hang でも storage 掃除へ進む（reject だけ握る旧実装では never-settle を防げなかった）
  try {
    await withTimeout(signOutBestEffort(client, scope), SIGN_OUT_TIMEOUT_MS);
  } catch {
    // timeout / 予期しない throw — 端末 storage は下で必ず消す
  }
  clearOwnedBrowserStorage();
}
