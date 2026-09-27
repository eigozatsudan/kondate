import { AsyncLocalStorage } from "node:async_hooks";

/**
 * リクエスト単位の hard deadline（単調時計の絶対値 ms）を運ぶ。
 * Supabase クライアントは process 寿命でキャッシュされるため、締切は fetch 呼び出し時に
 * ALS から読む。スコープ外（締切を張らない Function・単体テスト）は素通し。
 */
const storage = new AsyncLocalStorage<number>();

export function runWithRequestDeadline<T>(
  deadlineAtMonotonicMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(deadlineAtMonotonicMs, fn);
}

/**
 * 締切を超えた HTTP を abort する fetch。
 * 2026-09-27 本番: 送信後の DB RPC が返らず、関数が終端ログも台帳書き込みもないまま
 * Netlify Free の実効 30s で切られ、processing 行が stale 掃除（180s）まで残った。
 */
export function createDeadlineBoundedFetch(
  baseFetch: typeof fetch = fetch,
  monotonicNow: () => number = () => performance.now(),
): typeof fetch {
  return (input, init) => {
    const deadlineAtMonotonicMs = storage.getStore();
    if (deadlineAtMonotonicMs === undefined) return baseFetch(input, init);
    // AbortSignal.timeout は整数 ms のみ受け付ける（performance.now は小数）
    const remainingMs = Math.floor(deadlineAtMonotonicMs - monotonicNow());
    if (remainingMs <= 0) {
      return Promise.reject(new DOMException("request deadline exceeded", "TimeoutError"));
    }
    const deadlineSignal = AbortSignal.timeout(remainingMs);
    const callerSignal = init?.signal ?? undefined;
    const signal =
      callerSignal === undefined ? deadlineSignal : AbortSignal.any([callerSignal, deadlineSignal]);
    return baseFetch(input, { ...init, signal });
  };
}
