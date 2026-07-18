import type { Session } from "@supabase/supabase-js";
import { createContext } from "react";

export type AuthContextValue = {
  status: "loading" | "authenticated" | "unauthenticated";
  session: Session | null;
  refreshSession(): Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
