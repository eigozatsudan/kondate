import { z } from "zod";

import type { PendingGeneration } from "./pending-generation";

/**
 * 作り直し（regenerate_*）を始めた画面。失敗して「条件を直してやり直す」で戻るときの行き先に使う。
 * - "menus": 生成直後の結果画面（/menus/:id）。記録が無いときもこれ（UX 残り R2 項目 2 より前の挙動）。
 * - "history": 履歴詳細（/history/:id）。下タブの現在地を「履歴」のまま保つ。
 */
export type GenerationReturnSurface = "menus" | "history";

/**
 * pending 本体（kondate:generation:v3）とは別のキーに置く。
 * 本体の schema は `.strict()` なので、フィールドを足すと、デプロイ直後に古い画面を開いたままの
 * 別タブが新しい pending を「壊れている」と判断して消してしまう。別キーなら古い画面は無視するだけで済む。
 * 値は idempotencyKey と画面の種類だけ（献立の中身や個人情報は載せない）。
 */
export const pendingGenerationReturnSurfaceKey = "kondate:generation:v3:return-surface" as const;

// 記録するのは既定と違う "history" のときだけ。任意の文字列やパスは受け付けない。
const returnSurfaceRecordSchema = z
  .object({
    idempotencyKey: z.uuid(),
    surface: z.literal("history"),
  })
  .strict();

type ReturnSurfaceReadStorage = Pick<Storage, "getItem">;
type ReturnSurfaceWriteStorage = Pick<Storage, "setItem" | "removeItem">;
type ReturnSurfaceRemoveStorage = Pick<Storage, "removeItem">;

/**
 * 作り直しの pending を保存した直後に呼ぶ。"menus" のときは前回の記録を消す
 * （idempotencyKey で照合するので残っても誤用はしないが、残骸を減らす）。
 * 保存に失敗しても作り直し自体は止めない（戻り先が /menus になるだけ）。
 */
export function savePendingGenerationReturnSurface(
  idempotencyKey: string,
  surface: GenerationReturnSurface,
  storage: ReturnSurfaceWriteStorage = localStorage,
): void {
  try {
    if (surface === "history") {
      storage.setItem(
        pendingGenerationReturnSurfaceKey,
        JSON.stringify(returnSurfaceRecordSchema.parse({ idempotencyKey, surface })),
      );
    } else {
      storage.removeItem(pendingGenerationReturnSurfaceKey);
    }
  } catch {
    // Quota / private mode / 不正な key。既定の戻り先に落ちるだけなので吸収する
  }
}

/**
 * pending と同じ作り直しの記録があれば "history"、それ以外は "menus"。
 * new_menu・pending 無し・記録無し・別の作り直しの記録・壊れた値は、すべて既定の "menus"。
 */
export function readPendingGenerationReturnSurface(
  pending: PendingGeneration | null,
  storage: ReturnSurfaceReadStorage = localStorage,
): GenerationReturnSurface {
  if (pending === null) return "menus";
  if (pending.kind !== "regenerate_menu" && pending.kind !== "regenerate_dish") return "menus";
  let raw: string | null;
  try {
    raw = storage.getItem(pendingGenerationReturnSurfaceKey);
  } catch {
    return "menus";
  }
  if (raw === null) return "menus";
  try {
    const parsed = returnSurfaceRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return "menus";
    return parsed.data.idempotencyKey === pending.request.idempotencyKey ? "history" : "menus";
  } catch {
    return "menus";
  }
}

/** pending を消すときに一緒に消す（寿命を pending にそろえる） */
export function clearPendingGenerationReturnSurface(
  storage: ReturnSurfaceRemoveStorage = localStorage,
): void {
  try {
    storage.removeItem(pendingGenerationReturnSurfaceKey);
  } catch {
    // UI 継続のため削除失敗を吸収する
  }
}
