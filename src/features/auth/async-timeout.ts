/**
 * deposit 後の即 claim/exchange、および recovery poll 1 回分の上限。
 * settle しないと UI が awaiting に入れず TTL fail-closed も武装できないため、
 * ここで切って awaiting（recovery + page TTL）へフォールバックする。
 * auth-gateway / recovery の双方から参照するため timeout ユーティリティ側に置く（循環 import 回避）。
 */
export const IMMEDIATE_CLAIM_TIMEOUT_MS = 30_000;

/**
 * 認証まわりの network await が never-settle しても UI を永久に止めないための上限待ち。
 * timeout 後も元 Promise は放置（cancel 不能な SDK 呼び出し向け）。
 * onTimeout は reject より前に同期実行され、ゾンビ副作用の generation 無効化などに使う。
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          // ゾンビ continuation が同一 tick で進む前に無効化コールバックを走らせる
          onTimeout?.();
          reject(new Error("timeout"));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
