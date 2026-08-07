import { useRef, useState, type SyntheticEvent } from "react";
import {
  feedbackCategories,
  feedbackEnvelopeSchema,
  submitFeedbackRequestSchema,
  type FeedbackCategory,
} from "@shared/contracts/feedback";
import { requireAccessToken } from "@/features/auth/session";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

const categoryLabels: Readonly<Record<FeedbackCategory, string>> = {
  feature_request: "機能の改善・要望",
  bug_report: "不具合の報告",
  other: "その他",
};

function mapError(code: string | undefined, fallback: string): string {
  if (code === "feedback_rate_limited") {
    return "送信回数の上限に達しました。時間をおいてもう一度お試しください";
  }
  if (code === "auth_required") return "ログインし直してからもう一度お試しください";
  if (code === "invalid_request") return "入力内容を確認してください";
  return fallback;
}

/** AP10: 同一 category+body の指紋。曖昧失敗後の再送で二重 insert を抑止する。 */
function feedbackSubmitFingerprint(category: FeedbackCategory, body: string): string {
  return `${category}\n${body.trim()}`;
}

/**
 * 設定ページのフィードバック。機能改善と不具合報告を受け付ける。
 * 既定は折りたたみ。本文はサーバへだけ送り、クライアントログには出さない。
 *
 * AP7 residual-intentional: free-form 本文は ops 保管（約 30 日スイープ）。
 * PII 禁止スキーマは設けず、クライアントログにも出さない。利用者向けの保管期間・PII 注意
 * は製品開示の別途拡張余地（本修正では保管モデル自体は変えない）。
 */
export function FeedbackSection() {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("feature_request");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // AP10: React 再描画前の二重 submit を同期ガード（pending state だけでは足りない）
  const submitInFlightRef = useRef(false);
  // AP10: 応答欠落など「サーバ到達済みかも」の曖昧失敗後、同一本文の再送を抑止
  const ambiguousSubmitFingerprintRef = useRef<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || submitInFlightRef.current) return;

    const fingerprint = feedbackSubmitFingerprint(category, body);
    // 直前の送信が成功か失敗か端末側で確定できないとき、同じ内容の再送は ops 二重保管になり得る
    if (ambiguousSubmitFingerprintRef.current === fingerprint) {
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

    // fetch 到達後の欠落だけを ambiguous 扱いする（token 取得前失敗は未到達）
    let requestStarted = false;
    try {
      const accessToken = await requireAccessToken(getBrowserSupabaseClient());
      requestStarted = true;
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
      });
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        // 到達後の非 JSON: 二重 insert を避けるため同一本文の再送を抑止
        ambiguousSubmitFingerprintRef.current = fingerprint;
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
        return;
      }
      const envelope = feedbackEnvelopeSchema.safeParse(raw);
      if (!envelope.success) {
        ambiguousSubmitFingerprintRef.current = fingerprint;
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
        return;
      }
      if (!envelope.data.ok) {
        // サーバが明示拒否したので未 insert 確定。同一本文の再試行を許可
        ambiguousSubmitFingerprintRef.current = null;
        setErrorMessage(
          mapError(envelope.data.error.code, envelope.data.error.message || "送信できませんでした"),
        );
        return;
      }
      ambiguousSubmitFingerprintRef.current = null;
      setBody("");
      setCategory("feature_request");
      setStatusMessage("ありがとうございます。フィードバックを受け付けました");
    } catch {
      if (requestStarted) {
        ambiguousSubmitFingerprintRef.current = fingerprint;
        setErrorMessage(
          "送信結果を確認できませんでした。同じ内容を再送すると重複する可能性があります。内容を少し変えるか、時間をおいてからお試しください",
        );
      } else {
        setErrorMessage("送信できませんでした。時間をおいてもう一度お試しください");
      }
    } finally {
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
            使っていて不便な点や、あると助かる機能があれば教えてください。不具合の報告もこちらから送れます。
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
