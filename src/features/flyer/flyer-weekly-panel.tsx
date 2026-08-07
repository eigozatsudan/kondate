import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import {
  FLYER_LOCKED_PREVIEW_COPY,
  weeklyFlyerMenuResultSchema,
  type WeeklyFlyerMenuResult,
} from "@shared/contracts/flyer-weekly";
import { z } from "zod";
import { useAuth } from "@/features/auth/use-auth";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

export type FlyerWeeklyPanelProps = {
  /**
   * Plus entitled かつ製品面が開いているとき true。
   * PE3: UI 分岐のみ。真の権益はサーバ loadEntitlement（403 flyer_requires_plus）。
   */
  plusEntitled: boolean;
  /**
   * 現行 privacy notice への同意済み。未同意時は AI 送信 UI を出さず /privacy へ誘導する（PRIV-1）。
   * 省略時は false（fail-closed）。prop 脱落時にアップロード UI を出さない（AP5）。
   * サーバ側でも consent_required で閉じる。
   */
  hasAcceptedPrivacy?: boolean;
  /**
   * AP5: privacy 読取失敗。true のとき未同意ゲートではなくエラー UI（再試行）。
   * アップロードは fail-closed のまま。
   */
  privacyConsentLoadFailed?: boolean;
  onRetryPrivacyConsent?: () => void;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const stamp = String(Date.now());
  const entropy = Math.random().toString(16).slice(2);
  return `${stamp}-${entropy}`;
}

/**
 * PE2: sticky Idempotency-Key を画像内容に束縛するための fingerprint。
 * 通信断後に別チラシを選んでも旧 key / 旧結果に束縛しない。
 * 先頭 8KiB + size/type で区別（4MiB 上限の全読は避けつつ同一再送は一致）。
 */
async function fingerprintFlyerImage(file: File): Promise<string> {
  // Blob.arrayBuffer が無い jsdom では size/type/name/lastModified にフォールバック
  const meta = `${String(file.size)}:${file.type}:${file.name}:${String(file.lastModified)}`;
  const slice = file.slice(0, 8192);
  if (typeof slice.arrayBuffer !== "function") {
    return meta;
  }
  try {
    const headBytes = new Uint8Array(await slice.arrayBuffer());
    let rolling = 2166136261;
    for (const byte of headBytes) {
      rolling ^= byte;
      rolling = Math.imul(rolling, 16777619);
    }
    return `${meta}:${(rolling >>> 0).toString(16)}`;
  } catch {
    return meta;
  }
}

type StickyFlyerAttempt = {
  key: string;
  fingerprint: string;
};

/**
 * チラシ→1 週間献立の入口。
 * Free: locked preview + Plus CTA。
 * Plus: 画像アップロード。
 */
export function FlyerWeeklyPanel({
  plusEntitled,
  // AP5: 既定 false。呼び出し側が同意状態を渡さない限りアップロード UI を出さない
  hasAcceptedPrivacy = false,
  privacyConsentLoadFailed = false,
  onRetryPrivacyConsent,
}: FlyerWeeklyPanelProps) {
  const inputId = useId();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<WeeklyFlyerMenuResult | null>(null);
  // 通信断・processing 中の再試行では同一キーを使い、try 二重消費を防ぐ。
  // PE2: fingerprint 不一致（別画像）では sticky を捨て新 key を採番する。
  // 成功・端末確定失敗後は破棄し、次の選択で新しいキーを採番する。
  // サーバはキー必須（欠落で random 採番しない）。常に sticky/新規を送る。
  const stickyAttemptRef = useRef<StickyFlyerAttempt | null>(null);

  if (!plusEntitled) {
    return (
      <section className="stack card" data-testid="flyer-weekly-locked" aria-labelledby={inputId}>
        <h2 id={inputId}>チラシから 1 週間の献立</h2>
        <div className="flyer-locked-preview" aria-hidden="true">
          <p className="muted">サンプル: 月〜日の主菜プレビュー（ロック）</p>
          <ul className="muted flyer-locked-sample">
            <li>月曜 …</li>
            <li>火曜 …</li>
            <li>水曜 …</li>
          </ul>
        </div>
        <p>{FLYER_LOCKED_PREVIEW_COPY}</p>
        {/* PE3: 表示は prop。作成可否はサーバが毎回プラン確認する */}
        <p className="muted" data-testid="flyer-weekly-plus-server-note">
          作成できるかは Plus 契約をサーバーで確認します。
        </p>
        {/* primary-button はアプリ共通の CTA クラス。.button.primary は未定義で素のリンクになっていた */}
        <Link className="primary-button" to="/plus">
          Plus を見る
        </Link>
      </section>
    );
  }

  // AP5: 読取障害を未同意ゲートに潰さない（アップロードは fail-closed）
  if (privacyConsentLoadFailed) {
    return (
      <section
        className="stack card"
        data-testid="flyer-weekly-privacy-load-error"
        aria-labelledby={inputId}
      >
        <h2 id={inputId}>チラシから 1 週間の献立</h2>
        <p role="alert">
          AI情報の確認状態を読み込めませんでした。通信を確認して再試行してください。
        </p>
        {onRetryPrivacyConsent !== undefined ? (
          <button
            type="button"
            className="secondary-button min-h-11"
            onClick={() => {
              onRetryPrivacyConsent();
            }}
          >
            再試行
          </button>
        ) : null}
      </section>
    );
  }

  if (!hasAcceptedPrivacy) {
    return (
      <section className="stack card" data-testid="flyer-weekly-privacy" aria-labelledby={inputId}>
        <h2 id={inputId}>チラシから 1 週間の献立</h2>
        <p>AI を使う前に、利用説明の確認が必要です。</p>
        <Link className="primary-button" to="/privacy?returnTo=%2Fplanner">
          AI情報の説明を見る
        </Link>
      </section>
    );
  }

  const onFile = async (file: File | null) => {
    if (!file || !session?.access_token) return;
    setBusy(true);
    setError(null);
    setMenu(null);
    // PE2: 同一画像の再送だけ sticky key を再利用。別 File は新 key。
    const fingerprint = await fingerprintFlyerImage(file);
    const sticky = stickyAttemptRef.current;
    const attemptKey =
      sticky !== null && sticky.fingerprint === fingerprint ? sticky.key : newIdempotencyKey();
    stickyAttemptRef.current = { key: attemptKey, fingerprint };
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("idempotencyKey", attemptKey);
      const response = await fetch("/api/flyer-weekly", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Idempotency-Key": attemptKey,
        },
        body: form,
      });
      // F-U11-1: 他 AI 面と同型で Zod 閉じた envelope のみ受理（未検証 cast 禁止）
      const raw: unknown = await response.json();
      const envelopeSchema = z.object({
        ok: z.literal(true),
        data: z.object({ menu: weeklyFlyerMenuResultSchema }),
      });
      const errorSchema = z.object({
        ok: z.literal(false).optional(),
        error: z
          .object({
            code: z.string().optional(),
            message: z.string().optional(),
          })
          .optional(),
      });
      const parsed = envelopeSchema.safeParse(raw);
      if (!response.ok || !parsed.success) {
        const err = errorSchema.safeParse(raw);
        const errorCode = err.success ? err.data.error?.code : undefined;
        // PE1: processing 中（generation_in_progress）は sticky を残し同一 key で再試行する。
        // 確定失敗（Zod 不正・その他 !ok）だけキーを捨て、失敗行への冪等 hit を避ける。
        if (errorCode !== "generation_in_progress") {
          stickyAttemptRef.current = null;
        }
        setError(
          err.success
            ? (err.data.error?.message ?? "チラシ献立を作成できませんでした。")
            : "チラシ献立を作成できませんでした。",
        );
        return;
      }
      stickyAttemptRef.current = null;
      setMenu(parsed.data.data.menu);
    } catch {
      // 通信断: sticky を残し、同じ画像・同じキーで再送できるようにする
      setError("チラシ献立を作成できませんでした。");
    } finally {
      setBusy(false);
      // access_token 以外を触らない。クライアントは破棄。
      void getBrowserSupabaseClient;
    }
  };

  return (
    <section className="stack card" data-testid="flyer-weekly-upload" aria-labelledby={inputId}>
      <h2 id={inputId}>チラシから 1 週間の献立</h2>
      <p className="muted">スーパーのチラシ写真を 1 枚選ぶと、1 週間分の献立案を作ります。</p>
      {/* U6-005: 生成・緊急献立と同型の非保証免責（加工品ラベル確認を含む） */}
      <p className="muted" data-testid="flyer-weekly-disclaimer">
        {MENU_LABEL_DISCLAIMER}
      </p>
      {/*
        PE11: 週次枠はログイン用メール由来の識別子で数える（生メールは保存しない）。
        メール変更で数え直しになり得ることを平易に開示。HMAC/identity_key は出さない。
      */}
      <p className="muted" data-testid="flyer-weekly-identity-note">
        ログインに使うメールアドレスを変更すると、週あたりの作成回数の数え方が変わる場合があります。
      </p>
      {/* secondary-button で 44px タッチターゲットと輪郭ボタン見た目を揃える */}
      <label className="secondary-button" style={{ display: "inline-flex", cursor: "pointer" }}>
        {busy ? "作成中…" : "チラシ写真を選ぶ"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            void onFile(file);
            event.target.value = "";
          }}
        />
      </label>
      {error !== null ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {menu !== null ? (
        <ol className="stack">
          {menu.days
            .slice()
            .sort((a, b) => a.dayIndex - b.dayIndex)
            .map((day) => (
              <li key={day.dayIndex}>
                <strong>
                  {day.label}: {day.mainName}
                </strong>
                {day.sideName ? <span className="muted"> / {day.sideName}</span> : null}
                <div className="muted">{day.ingredients.join("、")}</div>
              </li>
            ))}
        </ol>
      ) : null}
    </section>
  );
}
