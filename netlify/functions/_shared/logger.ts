export type SafeGenerationLogEvent = {
  requestId: string;
  errorCode: string;
  durationMs: number;
  modelId: string | null;
};

type SafeSink = Record<"info" | "warn" | "error", (line: string) => void>;

export function logGenerationEvent(
  level: "info" | "warn" | "error",
  event: SafeGenerationLogEvent,
  sink: SafeSink = console,
): void {
  const safe = {
    requestId: event.requestId,
    errorCode: event.errorCode,
    durationMs: Math.max(0, Math.trunc(event.durationMs)),
    modelId: event.modelId,
  };
  sink[level](JSON.stringify(safe));
}
