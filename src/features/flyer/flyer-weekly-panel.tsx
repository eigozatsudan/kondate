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
  // PE4: サーバはキー必須（欠落で random 採番しない）。常に sticky/新規を送る。
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
      // F-U11-1: 他 AI 面と同型で Zod 閉じた envelope のみ受理（未検証 cast 禁止）
      const raw: unknown = await response.json();
      const envelopeSchema = z.object({
        ok: z.literal(true),
        data: z.object({ menu: weeklyFlyerMenuResultSchema }),
      });
      const errorSchema = z.object({
        ok: z.literal(false).optional(),
        error: z.object({ message: z.string().optional() }).optional(),
      });
      const parsed = envelopeSchema.safeParse(raw);
      if (!response.ok || !parsed.success) {
        // 端末失敗はキーを捨て、次の選択で新規予約する（失敗行への冪等 hit を避ける）
        stickyIdempotencyKeyRef.current = null;
        const err = errorSchema.safeParse(raw);
        setError(
          err.success
            ? (err.data.error?.message ?? "チラシ献立を作成できませんでした。")
            : "チラシ献立を作成できませんでした。",
        );
        return;
      }
      stickyIdempotencyKeyRef.current = null;
      setMenu(parsed.data.data.menu);
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
