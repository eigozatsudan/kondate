import type { Session } from "@supabase/supabase-js";
import { createContext } from "react";

export type AuthContextValue = {
  status: "loading" | "authenticated" | "unauthenticated";
  session: Session | null;
  refreshSession(): Promise<void>;
  /**
   * C12: getSession 等の probe が timeout した一時 degraded。
   * session オブジェクトは残り得るが Function は fail-closed。
   * storage clear はしない（再ログイン誤誘導を避ける）。focus / refreshSession で再試行。
   */
  sessionProbeDegraded: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
