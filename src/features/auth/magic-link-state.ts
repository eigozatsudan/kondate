export type MagicLinkState =
  | { status: "idle"; email: string }
  | { status: "sending"; email: string }
  | { status: "sent"; email: string; flowId: string; resendAvailableAt: string }
  | { status: "verifying" }
  | { status: "complete" }
  | { status: "expired"; email: string }
  | { status: "send_failed"; email: string; message: string };
