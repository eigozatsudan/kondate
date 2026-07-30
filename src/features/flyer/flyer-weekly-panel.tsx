import { useId, useRef, useState } from "react";
import { Link } from "react-router";
import {
  FLYER_LOCKED_PREVIEW_COPY,
  type WeeklyFlyerMenuResult,
} from "@shared/contracts/flyer-weekly";
import { useAuth } from "@/features/auth/use-auth";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

export type FlyerWeeklyPanelProps = {
  /** Plus entitled かつ製品面が開いているとき true */
  plusEntitled: boolean;
  /**
   * 現行 privacy notice への同意済み。未同意時は AI 送信 UI を出さず /privacy へ誘導する（PRIV-1）。
   * サーバ側でも consent_required で閉じる。
   */
  hasAcceptedPrivacy?: boolean;
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
 * チラシ→1 週間献立の入口。
 * Free: locked preview + Plus CTA。
 * Plus: 画像アップロード。
 */
export function FlyerWeeklyPanel({
  plusEntitled,
  hasAcceptedPrivacy = true,
}: FlyerWeeklyPanelProps) {
  const inputId = useId();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<WeeklyFlyerMenuResult | null>(null);
  // 通信断など結果不明な再試行では同一キーを使い、try 二重消費を防ぐ。
  // 端末失敗・成功後は破棄し、次の選択で新しいキーを採番する。
  const stickyIdempotencyKeyRef = useRef<string | null>(null);

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
        {/* primary-button はアプリ共通の CTA クラス。.button.primary は未定義で素のリンクになっていた */}
        <Link className="primary-button" to="/settings">
          Plus を見る
        </Link>
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
    const attemptKey = stickyIdempotencyKeyRef.current ?? newIdempotencyKey();
    stickyIdempotencyKeyRef.current = attemptKey;
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
      const body = (await response.json()) as {
        ok?: boolean;
        data?: { menu: WeeklyFlyerMenuResult };
        error?: { message?: string };
      };
      if (!response.ok || body.ok !== true || !body.data?.menu) {
        // 端末失敗はキーを捨て、次の選択で新規予約する（失敗行への冪等 hit を避ける）
        stickyIdempotencyKeyRef.current = null;
        setError(body.error?.message ?? "チラシ献立を作成できませんでした。");
        return;
      }
      stickyIdempotencyKeyRef.current = null;
      setMenu(body.data.menu);
    } catch {
      // 通信断: sticky を残し、同じキーで再送できるようにする
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
