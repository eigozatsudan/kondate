import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { privacyNoticeVersion } from "@shared/contracts/domain";
import { generationCommandVersionV3 } from "@shared/contracts/generation";
import type { PlannerDraft } from "@shared/contracts/planner";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
import {
  claimPendingGeneration,
  clearPendingGeneration,
  createPendingGeneration,
  readPendingGeneration,
} from "@/features/generation/model/pending-generation";
import { savePendingGenerationMeta } from "@/features/generation/model/pending-generation-meta";
import { reconcileTerminalPendingGeneration } from "@/features/generation/model/reconcile-terminal-pending";
import { useWeeklyPlan } from "../hooks/use-weekly-plan";
import {
  buildPlannerDraftInputFromWeeklyPlanDay,
  draftNeedsOverwriteConfirmation,
} from "../weekly-plan-draft-handoff";
import {
  DraftRevisionConflictError,
  getPlannerDraft,
  plannerKeys,
  savePlannerDraft,
} from "../../planner/planner-api";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";

export type WeeklyPlanResultPageProps = {
  accessToken: string;
  weeklyPlanId: string;
  userId: string;
  /**
   * 現行 complete メンバー id 集合。呼び出し側（Task 14 のルート）が実際の家族一覧クエリから渡す。
   * WP-P-5: デフォルト値は持たない。`[]`をデフォルトにすると、呼び出し側が配線を忘れた場合に
   * `buildPlannerDraftInputFromWeeklyPlanDay` が常に対象0人と判定し、
   * 全ての日タップが無条件に no_eligible_members になってしまう（配線漏れが静かに握りつぶされる）。
   */
  currentCompleteMemberIds: readonly string[];
};

const OVERWRITE_CONFIRM_TITLE_ID = "weekly-plan-overwrite-confirm-title";

type HandoffError = { dayIndex: number; message: string };

/**
 * 「この日の献立を作る」= 確認画面を通さず生成を開始して作り方画面へ直行する既定経路。
 * "planner" = 条件を変えたい利用者向けに確認画面（/planner?resume=review）へ逃がす副経路。
 */
type DayHandoffTarget = "generate" | "planner";

/**
 * 引き継ぎ済み下書きから new_menu の sticky pending を mint して生成画面へ進める。
 * planner-route の startGeneration と同じ claim + meta 順序を踏むが、この画面には
 * attempt/期限切れ確認が無い（引き継ぎ下書きは pantrySelections 空固定）ため、
 * 失敗時は例外を投げず遷移先を返す:
 * - "/generation": 自タブが pending を mint できた
 * - "/generation?resumed=1": 既存 pending（自分の進行中 or 他タブ勝者）を再開。
 *   保存済み下書きは残るので、進行中の生成が終わってから /planner で作れる。
 *   planner-route は claim 敗北時に勝者の meta 完了を waitForWinnerPendingSticky で待つが、
 *   ここでは待たない — 勝者の pending が消えていた場合でも /generation が idle→/planner
 *   に戻すだけで、保存済み下書きから確認画面経由で作り直せるため。
 * - "/planner?resume=review": sticky を書けなかった。下書きは全項目保存済みなので
 *   確認画面へ深リンクして逃がす（?resume=review は下書き完備時のみ review に効く）
 */
async function startDayGeneration(userId: string, draft: PlannerDraft): Promise<string> {
  try {
    if (readPendingGeneration(userId, new Date()) !== null) {
      // 進行中 pending を上書きすると作成 ID が失われる（planner の C2 と同型）。
      // terminal は reconcile が掃除し、processing/失敗は既存の再開を優先する。
      const outcome = await reconcileTerminalPendingGeneration(userId);
      if (outcome === "kept") return "/generation?resumed=1";
    }
    const mode = draft.targetMode;
    if (mode !== "household" && mode !== "idea") {
      // planner P2 と同じく pending を書く前に mode を確定する。到達しない想定だが
      // 到来した場合は meta を書かず確認画面経路へ逃がす（下書き未完備なら
      // resume パラメータは planner 側で無視され firstIncomplete へ落ちる）。
      return "/planner?resume=review";
    }
    const candidate = createPendingGeneration(
      {
        commandVersion: generationCommandVersionV3,
        kind: "new_menu",
        // 「くわしく作る」品質トグルは確認画面の選択肢。即生成は既定（標準）で開始する。
        qualityMode: false,
        request: {
          idempotencyKey: crypto.randomUUID(),
          draftId: draft.id,
          draftRevision: draft.revision,
          privacyNoticeVersion,
          expiredPantryConfirmations: [],
        },
      },
      userId,
    );
    const claim = await claimPendingGeneration(candidate, userId, new Date());
    if (!claim.claimed) return "/generation?resumed=1";
    try {
      savePendingGenerationMeta({
        kind: "new_menu",
        targetMode: mode,
        idempotencyKey: claim.pending.request.idempotencyKey,
        ownerUserId: userId,
        createdAt: claim.pending.createdAt,
      });
    } catch {
      // body→meta 非アトミック: meta 失敗時は sticky ごと消して確認画面経路へ戻す
      clearPendingGeneration();
      return "/planner?resume=review";
    }
    return "/generation";
  } catch {
    return "/planner?resume=review";
  }
}

/** spec §4.3「結果画面」。 */
export function WeeklyPlanResultPage({
  accessToken,
  weeklyPlanId,
  userId,
  currentCompleteMemberIds,
}: WeeklyPlanResultPageProps): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useWeeklyPlan(accessToken, weeklyPlanId);
  // レビュー指摘 F-6: 7枚のカードの後ろにまとめて出すと320pxで後半の日が
  // 画面外に流れるため、エラーは対象日のカードだけに紐づける。
  const [handoffError, setHandoffError] = useState<HandoffError | null>(null);
  // レビュー指摘 M-6: 二重送信ガード。保存・遷移の完了まで CTA を無効化する。
  const [handoffPending, setHandoffPending] = useState(false);
  // WP-P-5: 上書き確認は dayIndex だけを保持する（build 済みの outcome を保持すると
  // 「置き換える」クリック時に再ビルドせず古い outcome を使ってしまい、確認後の再送信が
  // 常に元の dayIndex=0 相当に固定される不具合を招く）。
  // pendingConfirm は遷移先（即生成/確認画面）も保持する。「置き換える」確定時に
  // どちらの CTA から来たかを復元するため dayIndex だけでは不足する。
  const [pendingConfirm, setPendingConfirm] = useState<{
    dayIndex: number;
    target: DayHandoffTarget;
  } | null>(null);
  const overwriteContinueRef = useRef<HTMLButtonElement>(null);
  const overwriteCancelRef = useRef<HTMLButtonElement>(null);
  // レビュー指摘 F-2: ダイアログを開いた元の CTA を覚えておき、閉じたときに戻す。
  const pendingConfirmTriggerRef = useRef<HTMLButtonElement | null>(null);

  // レビュー指摘 I-3(b)/F-2: household-settings-page.tsx の確認ダイアログ前例
  // （追加前確認: 主ボタンへ focus / 閉じたあと trigger へ戻す）と同じ挙動にする。
  // Escape とフォーカストラップは dialog 本体の onKeyDown で処理する（下記 JSX）。
  useEffect(() => {
    if (pendingConfirm === null) return;
    const trigger = pendingConfirmTriggerRef.current;
    overwriteContinueRef.current?.focus();
    return () => {
      trigger?.focus();
    };
  }, [pendingConfirm]);

  if (query.isPending) {
    // レビュー指摘 F-5: 読み込み中も他の分岐と同じ page-frame に揃える。
    return (
      <main className="page-frame guided-planner-theme">
        <p>読み込み中…</p>
      </main>
    );
  }
  if (query.isError) {
    // レビュー指摘 M-8: エラー表示に再読み込み手段を足す。
    return (
      <main className="page-frame guided-planner-theme">
        <p role="alert">読み込めませんでした</p>
        <button
          type="button"
          className="secondary-button min-h-11"
          onClick={() => {
            void query.refetch();
          }}
        >
          もう一度読み込む
        </button>
      </main>
    );
  }
  const plan = query.data;
  // レビュー指摘 M-4: 契約もサーバも days の配列順を保証しないため、描画側で dayIndex 昇順に揃える。
  const sortedDays = [...plan.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const pendingConfirmDay =
    pendingConfirm === null
      ? null
      : (sortedDays.find((day) => day.dayIndex === pendingConfirm.dayIndex) ?? null);

  async function handoffDay(
    dayIndex: number,
    options?: {
      skipConfirm?: boolean | undefined;
      attempt?: number;
      target?: DayHandoffTarget;
    },
  ): Promise<void> {
    const attempt = options?.attempt ?? 0;
    const target = options?.target ?? "generate";
    setHandoffError(null);
    // 確認ダイアログ表示中の再実行（「置き換える」）で早期 return に入っても
    // ダイアログが開きっぱなしにならないよう、評価し直す前に必ず閉じる。
    // 確認が必要な場合は後段の setPendingConfirm で再度開く。
    setPendingConfirm(null);
    const day = plan.days.find((candidate) => candidate.dayIndex === dayIndex);
    if (day === undefined) return;
    const outcome = buildPlannerDraftInputFromWeeklyPlanDay(day, plan, currentCompleteMemberIds);
    if ("error" in outcome) {
      setHandoffError({ dayIndex, message: "引き継ぎできる家族がいません。作り直してください。" });
      return;
    }
    const client = getBrowserSupabaseClient();
    // レビュー指摘 I-2: getPlannerDraft の失敗を専用の try/catch で受け止め、
    // unhandled rejection のまま UI が無反応になることを防ぐ。
    let existing: PlannerDraft | null;
    try {
      existing = await getPlannerDraft(client, userId);
    } catch {
      setHandoffError({
        dayIndex,
        message: "献立条件を引き継げませんでした。もう一度お試しください",
      });
      return;
    }
    if (
      options?.skipConfirm !== true &&
      // WP-P-7: getPlannerDraft は PlannerDraft（フラットな形。input プロパティは存在しない）
      // を返す。draftNeedsOverwriteConfirmation の第一引数はそのまま existing を渡す。
      draftNeedsOverwriteConfirmation(existing, outcome.input)
    ) {
      setPendingConfirm({ dayIndex, target });
      return;
    }
    let saved: PlannerDraft;
    try {
      saved = await savePlannerDraft(client, userId, outcome.input, existing?.revision ?? 0);
      // レビュー指摘 I-1: 保存直後に下書きクエリを invalidate しないと、直近 staleTime 内に
      // /planner を開いていた場合、古い下書きで再水和され引き継ぎが黙って無効化される。
      await queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
    } catch (error) {
      if (error instanceof DraftRevisionConflictError && attempt < 1) {
        await handoffDay(dayIndex, {
          skipConfirm: options?.skipConfirm,
          attempt: attempt + 1,
          target,
        });
        return;
      }
      setHandoffError({ dayIndex, message: "献立条件を保存できませんでした。" });
      return;
    }
    // navigate の reject（遷移失敗）も握りつぶさずエラー表示する。
    // void handoffDay(...).finally(...) 経由の unhandled rejection を防ぐ。
    try {
      if (target === "planner") {
        // 条件を変えたい利用者向け: 下書きは保存済みなので確認画面へ深リンクする。
        await navigate("/planner?resume=review");
        return;
      }
      // 既定経路: 確認画面を通さず生成を開始し、作り方つき献立画面へ直行する。
      await navigate(await startDayGeneration(userId, saved));
    } catch {
      setHandoffError({
        dayIndex,
        message: "画面を移動できませんでした。もう一度お試しください。",
      });
    }
  }

  // レビュー指摘 M-6: 二重送信ガード本体。確認ダイアログ待ちの間は pending を解除し、
  // 「置き換える」「この日の献立を作る」いずれの入口も同じガードを通す。
  function runHandoff(
    dayIndex: number,
    options?: { skipConfirm?: boolean; target?: DayHandoffTarget },
  ): void {
    if (handoffPending) return;
    setHandoffPending(true);
    void handoffDay(dayIndex, options).finally(() => {
      setHandoffPending(false);
    });
  }

  return (
    <main className="page-frame guided-planner-theme">
      <h1>
        {plan.partialHousehold
          ? `${String(plan.targetMemberIds.length)} 人分の今週の献立`
          : "今週の献立"}
      </h1>
      {plan.partialHousehold ? (
        <p role="note">外した家族の条件は見ていません。全員分を作るには作り直してください</p>
      ) : null}
      {plan.staleSafety ? <p role="note">家族の設定が変わっています。作り直してください</p> : null}
      {/* レビュー指摘 F-1: spec §4.3「日次と同じ安全性注記」。日次/履歴/チラシ週献立と
          同じ共有定数を表示する（flyer-weekly-panel.tsx と同型）。 */}
      <p className="muted">{MENU_LABEL_DISCLAIMER}</p>
      {plan.priorityIngredients.length > 0 ? (
        <p className="muted">優先的に使う食材: {plan.priorityIngredients.join("・")}</p>
      ) : null}
      {/* 作り方への最短動線を明示する。即生成は sticky pending 経由で /generation →
          /menus/:id（材料・作り方つき）へ直行する。 */}
      <p className="muted">
        「この日の献立を作る」を押すと、その日の材料と作り方つきの献立をすぐ作成できます。
        調理時間や食材を変えたいときは「条件を変えて作る」を押してください。
      </p>
      {/* handoff 中は全 CTA を disabled にするだけでなく status を出す。
          既存 pending の reconcile が状態確認 GET を伴い、端末・回線によって
          数十秒待ち得るため、無応答に見えないようにする。 */}
      {handoffPending ? <p role="status">献立の作成準備をしています…</p> : null}
      <ul className="stack">
        {sortedDays.map((day) => {
          const labelId = `weekly-plan-day-${String(day.dayIndex)}-label`;
          return (
            <li key={day.dayIndex} className="card stack">
              <h2 id={labelId}>{day.label}</h2>
              <p>{day.mainName}</p>
              {day.sideName !== null && day.sideName !== undefined ? <p>{day.sideName}</p> : null}
              {/* レビュー指摘 M-7: spec §4.3 の「食材チップ」表示。契約は食材の一意性を
                  課さないため key は index を含めて衝突を避ける。 */}
              <div className="wizard-chip-row">
                {day.ingredients.map((ingredient, index) => (
                  <span key={`${ingredient}-${String(index)}`} className="wizard-chip">
                    {ingredient}
                  </span>
                ))}
              </div>
              {day.notes !== null && day.notes !== undefined ? <p>{day.notes}</p> : null}
              <button
                type="button"
                className="primary-button min-h-11"
                aria-describedby={labelId}
                disabled={handoffPending}
                onClick={(event) => {
                  pendingConfirmTriggerRef.current = event.currentTarget;
                  runHandoff(day.dayIndex, { target: "generate" });
                }}
              >
                この日の献立を作る
              </button>
              <button
                type="button"
                className="secondary-button min-h-11"
                aria-describedby={labelId}
                disabled={handoffPending}
                onClick={(event) => {
                  pendingConfirmTriggerRef.current = event.currentTarget;
                  runHandoff(day.dayIndex, { target: "planner" });
                }}
              >
                条件を変えて作る
              </button>
              {handoffError !== null && handoffError.dayIndex === day.dayIndex ? (
                <p role="alert" className="error">
                  {handoffError.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {pendingConfirm !== null && pendingConfirmDay !== null ? (
        <div className="pantry-expired-dialog-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={OVERWRITE_CONFIRM_TITLE_ID}
            className="card stack pantry-expired-dialog-panel"
            onKeyDown={(event) => {
              // レビュー指摘 F-2: emergency-menu-page.tsx の alertdialog 前例と同型の
              // Escape ハンドラ・Tab フォーカストラップ。
              if (event.key === "Escape") {
                event.preventDefault();
                setPendingConfirm(null);
                return;
              }
              if (event.key !== "Tab") return;
              event.preventDefault();
              if (event.shiftKey) {
                if (document.activeElement === overwriteContinueRef.current) {
                  overwriteCancelRef.current?.focus();
                } else {
                  overwriteContinueRef.current?.focus();
                }
              } else if (document.activeElement === overwriteContinueRef.current) {
                overwriteCancelRef.current?.focus();
              } else {
                overwriteContinueRef.current?.focus();
              }
            }}
          >
            <h2 id={OVERWRITE_CONFIRM_TITLE_ID}>いまの献立条件を置き換えますか</h2>
            {/* レビュー指摘 N-1: 対象曜日を別行で明示する（本文は一字も変えない） */}
            <p>{pendingConfirmDay.label}の献立です</p>
            <button
              ref={overwriteContinueRef}
              type="button"
              className="primary-button min-h-11"
              disabled={handoffPending}
              onClick={() => {
                runHandoff(pendingConfirm.dayIndex, {
                  skipConfirm: true,
                  target: pendingConfirm.target,
                });
              }}
            >
              置き換える
            </button>
            <button
              ref={overwriteCancelRef}
              type="button"
              className="secondary-button min-h-11"
              onClick={() => {
                setPendingConfirm(null);
              }}
            >
              やめる
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
