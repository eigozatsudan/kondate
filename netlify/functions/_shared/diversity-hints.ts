/**
 * 新規生成向けソフト多様性ヒント（recentDishHints）。
 * fail-open・prompt 専用。fingerprint / quota / 検証には載せない。
 */

export const DIVERSITY_HINTS_ENABLED = true as const;
export const DIVERSITY_SYSTEM_MARKER = "【多様性ヒント】" as const;
export const RECENT_DISH_HINTS_TIMEOUT_MS = 200 as const;
export const RECENT_MENUS_LIMIT = 10 as const;
export const RECENT_DISH_HINTS_MAX = 24 as const;

export type RecentDishHint = {
  dishName: string;
  role?: string;
};

/** system 文の多様性段落。先頭マーカーでテスト・運用識別する */
export const DIVERSITY_PARAGRAPH =
  DIVERSITY_SYSTEM_MARKER +
  "優先順位は次のとおりです。" +
  "1)アレルギー・必須安全・must_use・品数・時間、" +
  "2)利用者のpreferences（メイン食材・避けたい等）、" +
  "3)最近の料理に近くないこと（ヒント）、" +
  "4)季節。" +
  "可能ならrecentDishHintsの料理名・役割が近い案は避けてください。" +
  "避けられない場合、履歴が空の場合、他の制約と両立できない場合は通常どおりoutcome=successで返してください。" +
  "多様性だけを理由にconstraint_conflictにしないでください。";

type DishEmbedRow = {
  id: string;
  name: string | null;
  role: string | null;
  position: number | null;
};

type MenuHintRow = {
  id: string;
  created_at: string;
  dishes: DishEmbedRow[] | null;
};

/** owner-scoped Supabase が menus 埋め込み select を返す最小面 */
type OwnerClientForHints = {
  from: (table: "menus") => {
    select: (columns: string) => {
      eq: (
        column: "user_id",
        value: string,
      ) => {
        order: (
          column: "created_at",
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => PromiseLike<{
            data: MenuHintRow[] | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
};

function isOwnerClientForHints(client: unknown): client is OwnerClientForHints {
  if (typeof client !== "object" || client === null || !("from" in client)) {
    return false;
  }
  return typeof client.from === "function";
}

/**
 * dishes を position 昇順・同値は id 昇順で並べ、空名を捨てて最大 24 件へ平坦化する。
 * menus は呼び出し側が created_at desc で並べた新しい順を前提とする。
 */
export function flattenRecentDishHints(menus: readonly MenuHintRow[]): readonly RecentDishHint[] {
  const hints: RecentDishHint[] = [];
  for (const menu of menus) {
    const dishes = [...(menu.dishes ?? [])].sort((left, right) => {
      const positionDelta = (left.position ?? 0) - (right.position ?? 0);
      if (positionDelta !== 0) return positionDelta;
      return left.id.localeCompare(right.id);
    });
    for (const dish of dishes) {
      const dishName = typeof dish.name === "string" ? dish.name.trim() : "";
      if (dishName === "") continue;
      const role = typeof dish.role === "string" ? dish.role.trim() : "";
      if (role !== "") {
        hints.push({ dishName, role });
      } else {
        hints.push({ dishName });
      }
      if (hints.length >= RECENT_DISH_HINTS_MAX) {
        return hints;
      }
    }
  }
  return hints;
}

async function queryRecentDishHints(
  ownerClient: OwnerClientForHints,
  userId: string,
): Promise<readonly RecentDishHint[]> {
  const { data, error } = await ownerClient
    .from("menus")
    .select("id, created_at, dishes(id, name, role, position)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_MENUS_LIMIT);

  if (error !== null) {
    return [];
  }
  if (!Array.isArray(data)) {
    return [];
  }
  return flattenRecentDishHints(data);
}

/**
 * 直近献立の料理名ヒントを owner 境界で読む。
 * 失敗・タイムアウト・0 件はすべて []。決して throw しない。
 */
export async function loadRecentDishHints(input: {
  ownerClient: unknown;
  userId: string;
  timeoutMs?: number;
}): Promise<readonly RecentDishHint[]> {
  try {
    if (!isOwnerClientForHints(input.ownerClient)) {
      return [];
    }
    if (typeof input.userId !== "string" || input.userId === "") {
      return [];
    }
    const timeoutMs = input.timeoutMs ?? RECENT_DISH_HINTS_TIMEOUT_MS;
    const ownerClient = input.ownerClient;
    const queryPromise = queryRecentDishHints(ownerClient, input.userId).catch(() => [] as const);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => {
        resolve("timeout");
      }, timeoutMs);
    });

    const raced = await Promise.race([
      queryPromise.then((hints) => ({ kind: "ok" as const, hints })),
      timeoutPromise.then(() => ({ kind: "timeout" as const })),
    ]);

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (raced.kind === "timeout") {
      // 遅延 resolve した query 結果は採用しない（race 勝者のみ）。未処理 reject を避ける
      void queryPromise.catch(() => {
        /* ignore late failure */
      });
      return [];
    }
    return raced.hints;
  } catch {
    return [];
  }
}
