// Chromium の beforeinstallprompt はモジュール初期化で取る。
// フック mount を待つと Android 主経路が死ぬ。surface では listen を遅らせない。

export type AndroidInstallPrompt = {
  prompt: () => Promise<void>;
};

let held: AndroidInstallPrompt | null = null;
let listening = false;

function isAndroidInstallPrompt(value: Event): value is Event & AndroidInstallPrompt {
  return typeof (value as Event & { prompt?: unknown }).prompt === "function";
}

function onBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  if (isAndroidInstallPrompt(event)) {
    held = event;
  }
}

export function listenForAndroidInstallPrompt(): void {
  if (typeof window === "undefined") return;
  if (listening) return;
  listening = true;
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
}

export function peekAndroidInstallPrompt(): AndroidInstallPrompt | null {
  return held;
}

export function useAndroidInstallPrompt(): AndroidInstallPrompt | null {
  return peekAndroidInstallPrompt();
}

export function resetAndroidInstallPromptForTests(): void {
  held = null;
}

export function injectAndroidInstallPromptForTests(event: AndroidInstallPrompt): void {
  held = event;
}
