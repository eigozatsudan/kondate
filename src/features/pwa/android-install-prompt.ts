// Chromium の beforeinstallprompt はモジュール初期化で取る。
// フック mount を待つと Android 主経路が死ぬ。surface では listen を遅らせない。
// peek は現在値の一回読み。描画後 BIP は購読（useSyncExternalStore）でカード/設定へ届ける。

import { useRef, useState, useSyncExternalStore } from "react";

export type AndroidInstallPrompt = {
  prompt: () => Promise<void>;
};

let held: AndroidInstallPrompt | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function notifyAndroidInstallPromptSubscribers(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function subscribeAndroidInstallPrompt(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function isAndroidInstallPrompt(value: Event): value is Event & AndroidInstallPrompt {
  return typeof (value as Event & { prompt?: unknown }).prompt === "function";
}

function onBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  if (isAndroidInstallPrompt(event)) {
    held = event;
    notifyAndroidInstallPromptSubscribers();
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
  return useSyncExternalStore(
    subscribeAndroidInstallPrompt,
    peekAndroidInstallPrompt,
    peekAndroidInstallPrompt,
  );
}

// prompt() は同一 BIP で 1 回だけ。二度押しの reject を握り、prompt 中は disabled にする。
export function useAndroidInstallAction(androidPrompt: AndroidInstallPrompt | null): {
  installInFlight: boolean;
  requestInstall: () => void;
} {
  const startedRef = useRef(false);
  const [installInFlight, setInstallInFlight] = useState(false);

  function requestInstall(): void {
    if (androidPrompt === null || startedRef.current) return;
    startedRef.current = true;
    setInstallInFlight(true);
    void androidPrompt.prompt().catch(() => {
      // Chromium は再 prompt を reject する。unhandledrejection にせず UI は残す。
    });
  }

  return { installInFlight, requestInstall };
}

export function resetAndroidInstallPromptForTests(): void {
  held = null;
  notifyAndroidInstallPromptSubscribers();
}

export function injectAndroidInstallPromptForTests(event: AndroidInstallPrompt): void {
  held = event;
  notifyAndroidInstallPromptSubscribers();
}
