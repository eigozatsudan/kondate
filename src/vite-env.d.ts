/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_MAGIC_LINK_RESEND_SECONDS?: string;
  readonly VITE_AUTH_CONTINUATION_TTL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
