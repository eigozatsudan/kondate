/**
 * 生成成功後の共有化 job enqueue。
 * Pass pipeline / 外部 LLM クライアントは import しない（attempt 予約は RPC 内のみ）。
 * 失敗は握りつぶし — 生成成功 UX を壊さない。
 */

import type { ValidatedMenu } from "../../../shared/contracts/generation.js";
import { evaluateShareEligibility } from "../../../shared/emergency/share-eligibility.js";
import type { AdminSupabaseClient } from "./supabase-admin.js";

export type MaybeEnqueueShareJobInput = {
  menuId: string;
  menu: ValidatedMenu;
  /** service_role → public.try_enqueue_share_job のみ */
  admin: Pick<AdminSupabaseClient, "rpc">;
};

/**
 * 適格なら try_enqueue_share_job を 1 回呼ぶ。不適格・RPC 失敗とも throw しない。
 * eligibility false では RPC しない（attempt 不消費）。
 */
export async function maybeEnqueueShareJob(input: MaybeEnqueueShareJobInput): Promise<void> {
  try {
    // AI 前の決定論ゲート。false なら RPC せず attempt を焼かない。
    const eligibility = evaluateShareEligibility(input.menu);
    if (!eligibility.ok) {
      return;
    }

    // 結果の enqueued/reason は生成レスポンスに載せない。エラーも握りつぶす。
    const { error } = await input.admin.rpc("try_enqueue_share_job", {
      p_menu_id: input.menuId,
    });
    void error;
  } catch {
    // never throws — 生成成功経路を壊さない
  }
}
