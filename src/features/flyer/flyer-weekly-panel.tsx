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
  /**
   * P2: planner 埋め込み時は review の privacy 導線と同型に flush + resume=review を route が所有する。
   * 渡されたときは素の Link ではなく button で委譲（dirty 下書きの silent unmount を避ける）。
   * 未指定時は resume=review 付き Link にフォールバック（flush は呼び出し側責務）。
   */
  onOpenPrivacyNotice?: () => void;
};

/** PE1: remount / 他タブでも同一画像の Idempotency-Key を再利用するための TTL（24h）。 */
export const flyerStickyTtlMs = 24 * 60 * 60 * 1_000;

/** PE1: user 単位の sticky 正本キー（fingerprint→key を envelope に載せる）。 */
export function flyerStickyStorageKey(userId: string): string {
  return `kondate:flyer:sticky:v1:${userId}`;
}

const stickyEnvelopeSchema = z
  .object({
    createdAtMs: z.number().int().nonnegative(),
    fingerprint: z.string().min(1),
    key: z.string().min(1),
  })
  .strict();

type StickyFlyerAttempt = {
  key: string;
  fingerprint: string;
};

function writeStorageBestEffort(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* Quota / private mode — 他方の Storage に委ねる */
  }
}

function removeStorageBestEffort(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* 掃除失敗は auth-cleanup が後で拾う */
  }
}

function readStickyFromStorage(storage: Storage, storageKey: string): StickyFlyerAttempt | null {
  let saved: string | null;
  try {
    saved = storage.getItem(storageKey);
  } catch {
    return null;
  }
  if (saved === null) return null;
  try {
    const parsed = stickyEnvelopeSchema.safeParse(JSON.parse(saved));
    if (parsed.success) {
      const age = Date.now() - parsed.data.createdAtMs;
      if (age >= 0 && age <= flyerStickyTtlMs) {
        return { key: parsed.data.key, fingerprint: parsed.data.fingerprint };
      }
    }
  } catch {
    /* 下で捨てる */
  }
  removeStorageBestEffort(storage, storageKey);
  return null;
}

/**
 * PE1: local を跨タブ正本、session を同一タブ mirror とする（SHOP4 同型）。
 * 期限切れ・壊れた envelope は両 Storage から捨てる。
 */
export function readFlyerStickyAttempt(userId: string): StickyFlyerAttempt | null {
  const storageKey = flyerStickyStorageKey(userId);
  const fromLocal = readStickyFromStorage(localStorage, storageKey);
  if (fromLocal !== null) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw !== null) writeStorageBestEffort(sessionStorage, storageKey, raw);
    } catch {
      /* mirror optional */
    }
    return fromLocal;
  }
  const fromSession = readStickyFromStorage(sessionStorage, storageKey);
  if (fromSession !== null) {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw !== null) writeStorageBestEffort(localStorage, storageKey, raw);
    } catch {
      /* promote optional */
    }
    return fromSession;
  }
  return null;
}

export function writeFlyerStickyAttempt(userId: string, sticky: StickyFlyerAttempt): void {
  const storageKey = flyerStickyStorageKey(userId);
  const payload = JSON.stringify({
    createdAtMs: Date.now(),
    fingerprint: sticky.fingerprint,
    key: sticky.key,
  });
  writeStorageBestEffort(localStorage, storageKey, payload);
  writeStorageBestEffort(sessionStorage, storageKey, payload);
}

export function clearFlyerStickyAttempt(userId: string): void {
  const storageKey = flyerStickyStorageKey(userId);
  removeStorageBestEffort(localStorage, storageKey);
  removeStorageBestEffort(sessionStorage, storageKey);
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const stamp = String(Date.now());
  const entropy = Math.random().toString(16).slice(2);
  return `${stamp}-${entropy}`;
}

/**
 * 画像バイト列を内容束縛用に読む。
 * jsdom では File.arrayBuffer が欠落・未実装のことがあり、Blob.prototype / FileReader へフォールバックする。
 * いずれでも読めないときだけ null（PE2: size:type だけでは束縛しない）。
 */
export async function readFlyerImageBytes(file: File): Promise<Uint8Array | null> {
  // 1) 現代ブラウザ / Node File: 自身の arrayBuffer
  if (typeof file.arrayBuffer === "function") {
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      // 次の経路へ（一部 jsdom は method があるが throw する）
    }
  }

  // 2) Blob 原型（File が Blob を継承するが own arrayBuffer が壊れている場合）
  if (
    typeof Blob !== "undefined" &&
    typeof Blob.prototype.arrayBuffer === "function" &&
    file instanceof Blob
  ) {
    try {
      return new Uint8Array(await Blob.prototype.arrayBuffer.call(file));
    } catch {
      // FileReader へ
    }
  }

  // 3) FileReader（jsdom で new File([...]) の内容を読める定番経路）
  if (typeof FileReader !== "undefined" && file instanceof Blob) {
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            resolve(reader.result);
            return;
          }
          reject(new Error("FileReader result is not ArrayBuffer"));
        };
        reader.onerror = () => {
          reject(reader.error ?? new Error("FileReader failed"));
        };
        reader.readAsArrayBuffer(file);
      });
      return new Uint8Array(buffer);
    } catch {
      // stream へ
    }
  }

  // 4) ReadableStream（対応環境のみ）
  if (typeof file.stream === "function") {
    try {
      const reader = file.stream().getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // done=false のとき value は必ず chunk（DOM lib の判別共用体）
        chunks.push(value);
        total += value.byteLength;
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * sticky Idempotency-Key を画像内容に束縛するための fingerprint。
 * PE1: name/lastModified は OS/ブラウザ再選択で変わり得るため使わない。
 * size:type + 全文 FNV-1a（上限 4MiB。アップロード前に既に File があるので全読でよい）。
 * 先頭 8KiB だけだと後半差分の別画像を同一 key に束縛し得る residual を閉じる。
 *
 * PE2: 内容バイトが一切読めないときだけ null。size:type だけの弱 fingerprint は返さない。
 * meta-only で sticky を束縛すると同 size/MIME の別画像が誤再利用される。
 * 呼び出し側は null を「読込失敗」として中止する。
 */
export async function fingerprintFlyerImage(file: File): Promise<string | null> {
  // name/lastModified は再選択で変わるため fingerprint に載せない（PE1）
  const meta = `${String(file.size)}:${file.type}`;
  const bytes = await readFlyerImageBytes(file);
  if (bytes === null) {
    // 内容を束縛できない: sticky を meta-only で発行しない（PE2）
    return null;
  }
  let rolling = 2166136261;
  for (const byte of bytes) {
    rolling ^= byte;
    rolling = Math.imul(rolling, 16777619);
  }
  return `${meta}:${(rolling >>> 0).toString(16)}`;
}

/**
 * 再試行で同一 key を保つか。
 * PE1: ledger が terminal failed の code（timeout / model_unavailable）は clear。
 * 同一 key は failed 再生のみで新 processing を reserve できないため、新 key で再試行する。
 * PE3: processing / 曖昧 5xx は keep — finalize 成功後の応答欠落で新 key にすると
 * 週次 try を二重消費し得る。通信断（catch）も呼び出し側で keep。
 * PE13: 壊れた succeeded はサーバが 4xx internal_error を返す → ここは keep しない。
 */
function shouldKeepFlyerSticky(errorCode: string | undefined, status: number): boolean {
  // PE1: terminal failed の明示 code は 503 でも sticky を捨てる（再 reserve 可能にする）
  if (errorCode === "generation_timeout" || errorCode === "model_unavailable") {
    return false;
  }
  // 5xx（structured internal_error 含む）は transport / 途中障害として keep
  if (status >= 500) return true;
  return errorCode === "generation_in_progress";
}

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
  onOpenPrivacyNotice,
}: FlyerWeeklyPanelProps) {
  const inputId = useId();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<WeeklyFlyerMenuResult | null>(null);
  // 通信断・processing 中の再試行では同一キーを使い、try 二重消費を防ぐ。
  // PE1: ref に加え local/sessionStorage へ永続化し remount / 他タブでも再利用する。
  // PE2: fingerprint 不一致（別画像）では sticky を捨て新 key を採番する。
  // 成功・端末確定失敗後は破棄し、次の選択で新しいキーを採番する。
  // サーバはキー必須（欠落で random 採番しない）。常に sticky/新規を送る。
  const stickyAttemptRef = useRef<StickyFlyerAttempt | null>(null);
  // PE4: React の busy 反映前に onChange が二重発火すると onFile が並列起動し、
  // sticky 未書き込みのまま二重 mint / 二重 POST し得る。pantry PE14 と同型の
  // sync single-flight。跨タブ dual-mint（PE1）や multi-fingerprint map（PE2）は対象外。
  const uploadInFlightRef = useRef(false);

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
        {/* P2: planner は onOpenPrivacyNotice（flush + resume=review）。未配線時は resume 付き Link。 */}
        {onOpenPrivacyNotice !== undefined ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              onOpenPrivacyNotice();
            }}
          >
            AI情報の説明を見る
          </button>
        ) : (
          <Link className="primary-button" to="/privacy?returnTo=%2Fplanner%3Fresume%3Dreview">
            AI情報の説明を見る
          </Link>
        )}
      </section>
    );
  }

  const persistSticky = (sticky: StickyFlyerAttempt | null): void => {
    stickyAttemptRef.current = sticky;
    if (userId === undefined) return;
    if (sticky === null) {
      clearFlyerStickyAttempt(userId);
      return;
    }
    writeFlyerStickyAttempt(userId, sticky);
  };

  const resolveStickyForFingerprint = (fingerprint: string): string => {
    // 同一マウントの ref を優先。無ければ Storage（remount / 他タブ）。
    let sticky = stickyAttemptRef.current;
    if ((sticky === null || sticky.fingerprint !== fingerprint) && userId !== undefined) {
      const stored = readFlyerStickyAttempt(userId);
      if (stored !== null && stored.fingerprint === fingerprint) {
        sticky = stored;
        stickyAttemptRef.current = stored;
      }
    }
    if (sticky !== null && sticky.fingerprint === fingerprint) {
      return sticky.key;
    }
    return newIdempotencyKey();
  };

  const onFile = async (file: File | null) => {
    if (!file || !session?.access_token) return;
    // PE4: busy の re-render より先に同期ガード。既に飛行中なら第2選択を無視（queue しない）。
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setBusy(true);
    setError(null);
    setMenu(null);
    try {
      // PE2: 同一画像の再送だけ sticky key を再利用。内容を束縛できない読取失敗は中止。
      const fingerprint = await fingerprintFlyerImage(file);
      if (fingerprint === null) {
        setError("画像を読み込めませんでした。");
        return;
      }
      const attemptKey = resolveStickyForFingerprint(fingerprint);
      persistSticky({ key: attemptKey, fingerprint });
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
        // PE1: terminal failed（generation_timeout 等）は sticky clear → 新 key で再 reserve。
        // PE3: processing / 5xx(internal_error) は sticky 維持。finalize 成功後の応答欠落で
        // 新 key にすると週次 try を二重消費する。4xx の確定失敗も破棄。
        // PE4 (ambiguous body): HTTP 200 だが body が Zod で閉じられないときは成功/transport 曖昧。
        // catch（通信断）と同様に sticky を残し、同一画像の再送で二重 try を防ぐ。
        const ambiguousOkBody = response.ok && !parsed.success;
        if (!ambiguousOkBody && !shouldKeepFlyerSticky(errorCode, response.status)) {
          persistSticky(null);
        }
        setError(
          err.success
            ? (err.data.error?.message ?? "チラシ献立を作成できませんでした。")
            : "チラシ献立を作成できませんでした。",
        );
        return;
      }
      persistSticky(null);
      setMenu(parsed.data.data.menu);
    } catch {
      // 通信断: sticky を残し、同じ画像・同じキーで再送できるようにする
      setError("チラシ献立を作成できませんでした。");
    } finally {
      // PE4: fingerprint null 早期 return もここに合流して in-flight / busy を必ず解除
      uploadInFlightRef.current = false;
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
