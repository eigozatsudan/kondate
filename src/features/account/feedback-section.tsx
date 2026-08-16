import { useRef, useState, type SyntheticEvent } from "react";
import {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_RATE_WINDOW_HOURS,
  feedbackCategories,
  feedbackEnvelopeSchema,
  submitFeedbackRequestSchema,
  type FeedbackCategory,
} from "@shared/contracts/feedback";
import { withTimeout } from "@/features/auth/async-timeout";
import { requireAccessToken } from "@/features/auth/session";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const categoryLabels: Readonly<Record<FeedbackCategory, string>> = {
  feature_request: "機能の改善・要望",
  bug_report: "不具合の報告",
  other: "その他",
};

/**
 * AP6: POST /api/feedback のクライアント上限。
 * insert は通常短いが、never-settle で「送信しています」固着・閉じる不能を防ぐ。
 */
export const FEEDBACK_POST_CLIENT_TIMEOUT_MS = 30_000;

/**
 * AP5 / AP3: 曖昧失敗後の fingerprint を localStorage に残すキー接頭辞。
 * AP17: 実キーは userId を束縛（`…:ambiguous-fingerprint:<userId>`）。
 * logout/削除 cleanup は `kondate:feedback:` 接頭辞で両 storage を掃除済み。
 * レガシー（user 非束縛）キーは読まず掃除対象のみ。
 */
export const FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX =
  "kondate:feedback:ambiguous-fingerprint";

/**
 * @deprecated AP17: user 非束縛の旧キー。cleanup 互換とテスト移行用。新規 read/write 禁止。
 */
export const FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY =
  FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX;

/** AP17: user 束縛 sticky キー。userId 欠落時は null（sticky 無効・抑止しない）。 */
export function feedbackAmbiguousFingerprintStorageKey(
  userId: string | null | undefined,
): string | null {
  if (typeof userId !== "string" || userId.length === 0) return null;
  // UUID 形のみ受け、任意文字列のキー汚染を避ける
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(userId)) {
    return null;
  }
  return `${FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX}:${userId.toLowerCase()}`;
}

/** withTimeout の timeout と AbortSignal abort を締切扱いする */
function isFeedbackTimeoutOrAbort(error: unknown): boolean {
  if (error instanceof Error && error.message === "timeout") return true;
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return true;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true;
  }
  return false;
}

function mapError(code: string | undefined, fallback: string): string {
  if (code === "feedback_rate_limited") {
    return "送信回数の上限に達しました。時間をおいてもう一度お試しください";
  }
  if (code === "auth_required") return "ログインし直してからもう一度お試しください";
  if (code === "invalid_request") return "入力内容を確認してください";
  return fallback;
}

/**
 * AP10 + AP1: 同一 category+body の指紋。
 * 曖昧失敗後の再送で二重 insert を抑止する。
 * AP1: free-form 本文を localStorage に平文で残さない（SHA-256 hex のみ保管）。
 */
async function feedbackSubmitFingerprint(
  category: FeedbackCategory,
  body: string,
): Promise<string> {
  const raw = `${category}\n${body.trim()}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readAmbiguousFingerprint(userId: string | null | undefined): string | null {
  const storageKey = feedbackAmbiguousFingerprintStorageKey(userId);
  if (storageKey === null) return null;
  try {
    const value = localStorage.getItem(storageKey);
    // AP1: 64 hex（SHA-256）のみ受理。旧平文残留は読まず再送抑止をやり直す（PII を再露出させない）。
    if (value !== null && /^[0-9a-f]{64}$/u.test(value)) return value;
    if (value !== null) {
      localStorage.removeItem(storageKey);
    }
    // AP3: sessionStorage に残った sticky があれば読む。local へ寄せられなければ session に残す（AP13）
    try {
      const legacy = sessionStorage.getItem(storageKey);
      if (legacy !== null && /^[0-9a-f]{64}$/u.test(legacy)) {
        try {
          localStorage.setItem(storageKey, legacy);
          sessionStorage.removeItem(storageKey);
        } catch {
          // local へ寄せられないときは session を消さず、値は返す
        }
        return legacy;
      }
      if (legacy !== null) {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // sessionStorage 拒否は無視
    }
    // AP17: レガシー user 非束縛キーは他利用者の sticky になり得るため読まず除去のみ
    try {
      localStorage.removeItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX);
      sessionStorage.removeItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX);
    } catch {
      // ignore
    }
    return null;
  } catch {
    // AP13: localStorage 拒否時は同一タブ再読用に sessionStorage を読む
    try {
      const fallback = sessionStorage.getItem(storageKey);
      if (fallback !== null && /^[0-9a-f]{64}$/u.test(fallback)) return fallback;
    } catch {
      // sessionStorage も拒否なら in-memory のみ
    }
    return null;
  }
}

function writeAmbiguousFingerprint(
  userId: string | null | undefined,
  fingerprint: string | null,
): void {
  const storageKey = feedbackAmbiguousFingerprintStorageKey(userId);
  if (storageKey === null) return;
  try {
    if (fingerprint === null) {
      localStorage.removeItem(storageKey);
    } else {
      // AP1: hash のみ。呼び出し側が plaintext を渡さない契約。
      localStorage.setItem(storageKey, fingerprint);
    }
    // AP3: 旧 sessionStorage 残留を掃除し storage 権威を local に一本化
    try {
      sessionStorage.removeItem(storageKey);
      // AP17: レガシー非束縛キーも掃除
      localStorage.removeItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX);
      sessionStorage.removeItem(FEEDBACK_AMBIGUOUS_FINGERPRINT_STORAGE_KEY_PREFIX);
    } catch {
      // ignore
    }
  } catch {
    // AP13: localStorage 拒否時は sessionStorage へフォールバック（同一タブ再読で二重行を抑える）
    try {
      if (fingerprint === null) {
        sessionStorage.removeItem(storageKey);
      } else {
        sessionStorage.setItem(storageKey, fingerprint);
      }
    } catch {
      // 両方拒否時は ref 側だけが効く
    }
  }
}

/**
 * 設定ページのフィードバック。機能改善と不具合報告を受け付ける。
 * 既定は折りたたみ。本文はサーバへだけ送り、クライアントログには出さない。
 *
 * AP8: free-form 本文は ops 保管（約 30 日スイープ）。設定 UI に保管・閲覧を開示する。
 * PII 禁止スキーマは設けず、クライアントログにも出さない。保管モデル自体は変えない。
 */
export function FeedbackSection() {
  const auth = useAuth();
  // AP17: sticky は session user に束縛（shared origin の prior-user 抑止を閉じる）
  const stickyUserId = auth.session?.user.id ?? null;
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("feature_request");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // AP10: React 再描画前の二重 submit を同期ガード（pending state だけでは足りない）
  const submitInFlightRef = useRef(false);
  // AP10 + AP5 / AP3 / AP17: in-memory と user 束縛 localStorage
  const ambiguousSubmitFingerprintRef = useRef<string | null>(null);
  const stickyUserIdRef = useRef<string | null>(stickyUserId);
  if (stickyUserIdRef.current !== stickyUserId) {
    stickyUserIdRef.current = stickyUserId;
    ambiguousSubmitFingerprintRef.current = readAmbiguousFingerprint(stickyUserId);
  } else if (ambiguousSubmitFingerprintRef.current === null) {
    ambiguousSubmitFingerprintRef.current = readAmbiguousFingerprint(stickyUserId);
  }

  function rememberAmbiguousFingerprint(fingerprint: string): void {
    ambiguousSubmitFingerprintRef.current = fingerprint;
    writeAmbiguousFingerprint(stickyUserIdRef.current, fingerprint);
  }

  function clearAmbiguousFingerprint(): void {
    ambiguousSubmitFingerprintRef.current = null;
    writeAmbiguousFingerprint(stickyUserIdRef.current, null);
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitInFlightRef.current) return;

    // AP1: 比較・保管は hash のみ（本文は fingerprint 関数内で digest して捨てる）
    const fingerprint = await feedbackSubmitFingerprint(category, body);
    // localStorage 再読（別タブ / 直前 remount と同期）
    const stickyAmbiguous =
      ambiguousSubmitFingerprintRef.current ?? readAmbiguousFingerprint(stickyUserIdRef.current);
    if (stickyAmbiguous !== null) {
      ambiguousSubmitFingerprintRef.current = stickyAmbiguous;
    }
    // 直前の送信が成功か失敗か端末側で確定できないとき、同じ内容の再送は ops 二重保管になり得る
    if (stickyAmbiguous === fingerprint) {
      setStatusMessage(null);
      setErrorMessage(
        "直前の送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
      );
      return;
    }

    setPending(true);
    submitInFlightRef.current = true;
    setStatusMessage(null);
    setErrorMessage(null);

    const parsed = submitFeedbackRequestSchema.safeParse({
      category,
      body,
      clientPath: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0]?.message ?? "入力内容を確認してください";
      setErrorMessage(first);
      setPending(false);
      submitInFlightRef.current = false;
      return;
    }

    // AP8: token 取得前は sticky しない（未到達の再送を封じない）。
    // AP10 / AP-R2: fetch 開始後は timeout/abort/TypeError いずれも到達曖昧として sticky する。
    let requestStarted = false;
    let fetchInitiated = false;
    // AP9: 締切時に in-flight POST を abort し zombie 二重 insert 窓を縮める
    const abortController = new AbortController();
    const abortPost = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    };
    const postDeadlineMs = Date.now() + FEEDBACK_POST_CLIENT_TIMEOUT_MS;
    const remainingPostBudgetMs = (): number => Math.max(1, postDeadlineMs - Date.now());
    try {
      const accessToken = await requireAccessToken(getBrowserSupabaseClient());
      fetchInitiated = true;
      // AP6/AP9: settle + body を同一予算。withTimeout は UI 回復、onTimeout で AbortSignal
      const response = await withTimeout(
        fetch("/api/feedback", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(parsed.data),
          cache: "no-store",
          signal: abortController.signal,
        }),
        remainingPostBudgetMs(),
        abortPost,
      );
      // AP8: headers を得てからだけ到達。未到達失敗で同一本文を封じない
      requestStarted = true;
      let raw: unknown;
      try {
        // AP9: headers-only hang で pending / 閉じる不能にしない
        raw = await withTimeout(response.json(), remainingPostBudgetMs(), abortPost);
      } catch (error) {
        // 締切 / abort は外側 catch で ambiguous 扱い
        if (isFeedbackTimeoutOrAbort(error)) {
          throw error;
        }
        // 到達後の非 JSON: 二重 insert を避けるため同一本文の再送を抑止
        rememberAmbiguousFingerprint(fingerprint);
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
        return;
      }
      const envelope = feedbackEnvelopeSchema.safeParse(raw);
      if (!envelope.success) {
        rememberAmbiguousFingerprint(fingerprint);
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
        return;
      }
      if (!envelope.data.ok) {
        // サーバが明示拒否したので未 insert 確定。同一本文の再試行を許可
        clearAmbiguousFingerprint();
        setErrorMessage(
          mapError(envelope.data.error.code, envelope.data.error.message || "送信できませんでした"),
        );
        return;
      }
      clearAmbiguousFingerprint();
      setBody("");
      setCategory("feature_request");
      setStatusMessage("ありがとうございます。フィードバックを受け付けました");
    } catch {
      // AP10 / AP-R2: fetch 開始後は headers 前でも insert 済みになり得る。到達曖昧は再送抑止。
      if (requestStarted || fetchInitiated) {
        rememberAmbiguousFingerprint(fingerprint);
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
      } else {
        setErrorMessage("送信できませんでした。時間をおいてもう一度お試しください");
      }
    } finally {
      abortPost();
      setPending(false);
      submitInFlightRef.current = false;
    }
  }

  return (
    <section className="card stack" aria-labelledby="feedback-title">
      <h2 id="feedback-title" className="settings-section-title">
        フィードバック
      </h2>
      {!expanded ? (
        <button
          type="button"
          className="secondary-button min-h-11"
          aria-expanded="false"
          onClick={() => {
            setExpanded(true);
          }}
        >
          改善要望・不具合を送る
        </button>
      ) : (
        <>
          <p className="type-small">
            使っていて不便な点や、あると助かる機能があれば教えてください。不具合の報告もこちらから送れます。送信は
            {FEEDBACK_RATE_WINDOW_HOURS}時間あたり{FEEDBACK_DAILY_LIMIT}
            件までです。上限に達したら時間をおいてお試しください。送信時にいま開いている画面のパス（例:
            /settings）だけを参考情報として添えます。献立の番号は送りません。氏名や本文以外の個人情報は自動では送りません。本文は平文のまま約30日間保管され、運営が確認のために読むことがあります。氏名や連絡先など個人が分かることは書かないでください。この端末が一時保存を拒否していると、同じ内容を再送すると重複することがあります。
          </p>
          <form className="stack" onSubmit={(event) => void handleSubmit(event)}>
            <fieldset className="stack" disabled={pending}>
              <legend className="type-small">種類</legend>
              <div className="stack" role="radiogroup" aria-label="フィードバックの種類">
                {feedbackCategories.map((value) => (
                  <label key={value} className="control-label">
                    <input
                      type="radio"
                      name="feedback-category"
                      value={value}
                      checked={category === value}
                      onChange={() => {
                        setCategory(value);
                      }}
                    />
                    <span>{categoryLabels[value]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              内容（10〜2000文字）
              <textarea
                value={body}
                maxLength={2000}
                rows={5}
                disabled={pending}
                aria-required="true"
                placeholder="例: 買い物リストで売り場の順番を変えられると助かります"
                onChange={(event) => {
                  setBody(event.target.value);
                }}
              />
            </label>
            {errorMessage !== null && (
              <p className="error-message" role="alert">
                {errorMessage}
              </p>
            )}
            {statusMessage !== null && (
              <p className="status-message" role="status" aria-live="polite">
                {statusMessage}
              </p>
            )}
            <div className="wizard-actions">
              <button
                className="secondary-button min-h-11 wizard-action"
                type="button"
                disabled={pending}
                onClick={() => {
                  setExpanded(false);
                }}
              >
                閉じる
              </button>
              <button
                className="primary-button min-h-11 wizard-action"
                type="submit"
                disabled={pending}
              >
                {pending ? "送信しています…" : "送信する"}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
