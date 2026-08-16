/**
 * esbuild define で埋め込む定数。app tsconfig が src/ を見るためここに置く。
 * WebWorker lib は足さないので、SW が使う self 型だけを狭く宣言する。
 */
declare const __KONDATE_SW_CACHE_NAME__: string;
declare const __KONDATE_SW_PRECACHE__: string;
declare const __KONDATE_SW_SHELL__: string;

interface ServiceWorkerGlobalScope {
  readonly location: { readonly origin: string };
  addEventListener(
    type: "install" | "activate" | "fetch",
    listener: (event: {
      readonly request: Request;
      waitUntil(promise: Promise<unknown>): void;
      respondWith(response: Response | Promise<Response>): void;
    }) => void,
  ): void;
}
