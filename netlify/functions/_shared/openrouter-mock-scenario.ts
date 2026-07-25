import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ローカル mock シナリオをリクエスト単位で運ぶ。
 * process.env 差し替えは並行リクエストでレースするため使わない。
 */
const storage = new AsyncLocalStorage<string>();

export function runWithOpenRouterMockScenario<T>(
  scenario: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(scenario, fn);
}

export function readOpenRouterMockScenario(): string | undefined {
  return storage.getStore();
}
