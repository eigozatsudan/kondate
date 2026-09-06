import { useEffect, useRef, useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { PlannerDraft } from "@shared/contracts/planner";
import { MENU_LABEL_DISCLAIMER } from "@/features/generation/components/idea-menu-safety-notice";
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
  const [pendingConfirm, setPendingConfirm] = useState<{ dayIndex: number } | null>(null);
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
    options?: { skipConfirm?: boolean | undefined; attempt?: number },
  ): Promise<void> {
    const attempt = options?.attempt ?? 0;
    setHandoffError(null);
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
      setPendingConfirm({ dayIndex });
      return;
    }
    setPendingConfirm(null);
    try {
      await savePlannerDraft(client, userId, outcome.input, existing?.revision ?? 0);
      // レビュー指摘 I-1: 保存直後に下書きクエリを invalidate しないと、直近 staleTime 内に
      // /planner を開いていた場合、古い下書きで再水和され引き継ぎが黙って無効化される。
      await queryClient.invalidateQueries({ queryKey: plannerKeys.draft(userId) });
      await navigate("/planner");
    } catch (error) {
      if (error instanceof DraftRevisionConflictError && attempt < 1) {
        await handoffDay(dayIndex, { skipConfirm: options?.skipConfirm, attempt: attempt + 1 });
        return;
      }
      setHandoffError({ dayIndex, message: "献立条件を保存できませんでした。" });
    }
  }

  // レビュー指摘 M-6: 二重送信ガード本体。確認ダイアログ待ちの間は pending を解除し、
  // 「置き換える」「この日の献立を作る」いずれの入口も同じガードを通す。
  function runHandoff(dayIndex: number, options?: { skipConfirm?: boolean }): void {
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
                className="secondary-button min-h-11"
                aria-describedby={labelId}
                disabled={handoffPending}
                onClick={(event) => {
                  pendingConfirmTriggerRef.current = event.currentTarget;
                  runHandoff(day.dayIndex);
                }}
              >
                この日の献立を作る
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
                runHandoff(pendingConfirm.dayIndex, { skipConfirm: true });
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
