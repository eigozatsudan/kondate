import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";

/** validation トースト 1 件分の入力。durationMs 省略時は 6000ms。 */
export type ShowAppToastInput = {
  message: string;
  tone: "error" | "info";
  durationMs?: number;
};

type AppToastApi = {
  show: (input: ShowAppToastInput) => void;
  dismiss: () => void;
};

type ToastState = {
  message: string;
  tone: "error" | "info";
  durationMs: number;
  /** show ごとに増やし、同一 message の再表示でも DOM を差し替える */
  generation: number;
};

const DEFAULT_DURATION_MS = 6000;

const AppToastContext = createContext<AppToastApi | null>(null);

/**
 * アプリ共通の validation トースト。
 * 同時表示は最新 1 件（後勝ち）。error/info とも role=status + aria-live=polite
 * （永続の inline は role=alert 側に任せる）。
 * hover / focus-within 中はタイマーを止め、離れたら duration を振り直す（WCAG 2.2.1）。
 * 閉じるボタンへフォーカスしても pause。Escape で閉じ、キーボードだけでも 6s 制限を止められる。
 */
export function AppToastProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** hover / focus-within でタイマー停止中か */
  const pausedRef = useRef(false);
  const durationRef = useRef(DEFAULT_DURATION_MS);
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    pausedRef.current = false;
    setToast(null);
  }, [clearTimer]);

  const startTimer = useCallback(() => {
    clearTimer();
    // 停止中は開始しない。resume 側で振り直す。
    if (pausedRef.current) {
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setToast(null);
    }, durationRef.current);
  }, [clearTimer]);

  const show = useCallback(
    (input: ShowAppToastInput) => {
      clearTimer();
      pausedRef.current = false;
      const durationMs = input.durationMs ?? DEFAULT_DURATION_MS;
      durationRef.current = durationMs;
      generationRef.current += 1;
      setToast({
        message: input.message,
        tone: input.tone,
        durationMs,
        generation: generationRef.current,
      });
    },
    [clearTimer],
  );

  // toast が載ったあとでタイマー開始（state 反映後に一度だけ）
  useEffect(() => {
    if (toast === null) {
      clearTimer();
      return;
    }
    startTimer();
    return () => {
      clearTimer();
    };
  }, [toast, startTimer, clearTimer]);

  // L7: キーボードは hover できない。Escape で閉じ、6s 自動消去を止められるようにする。
  // モーダルが開いているときは dialog 側の Escape を奪わない。
  useEffect(() => {
    if (toast === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof Element &&
        active.closest('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toast, dismiss]);

  const api: AppToastApi = {
    show,
    dismiss,
  };

  const handlePause = useCallback(() => {
    if (toast === null) {
      return;
    }
    pausedRef.current = true;
    clearTimer();
  }, [toast, clearTimer]);

  const handleResume = useCallback(() => {
    if (toast === null) {
      return;
    }
    pausedRef.current = false;
    startTimer();
  }, [toast, startTimer]);

  let toastNode: ReactNode = null;
  if (toast !== null) {
    toastNode = (
      <div
        key={toast.generation}
        className={`app-toast app-toast--${toast.tone}`}
        role="status"
        aria-live="polite"
        onMouseEnter={handlePause}
        onMouseLeave={handleResume}
        onFocusCapture={handlePause}
        onBlurCapture={(event) => {
          // トースト内のフォーカス移動では resume しない
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) {
            return;
          }
          handleResume();
        }}
      >
        <span className="app-toast-label">{toast.message}</span>
        {/* L7: フォーカス可能。focus-within で pause。44px は触れるが pill を縦に増やしすぎない */}
        <button type="button" className="app-toast-dismiss" aria-label="閉じる" onClick={dismiss}>
          ×
        </button>
      </div>
    );
  }

  return (
    <AppToastContext.Provider value={api}>
      {children}
      {toastNode}
    </AppToastContext.Provider>
  );
}

/**
 * AppToastProvider 配下でのみ利用可。
 * validation 用途の show は planner 質問 step と household 追加・編集のみ。
 */
// Provider と hook を同一モジュールに置くのは Context の定型（locked interface）。
// eslint-disable-next-line react-refresh/only-export-components -- useAppToast は Provider 契約の一部
export function useAppToast(): AppToastApi {
  const ctx = useContext(AppToastContext);
  if (ctx === null) {
    throw new Error("useAppToast must be used within AppToastProvider");
  }
  return ctx;
}
