import { Link } from "react-router";
import { Button } from "@/shared/ui/button";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import { memberSafetyText, type PlannerSafetyMember } from "./planner-safety-member";

/** 安全条件サマリー共通の免責（audience empty / selected / review で単一ソース）。 */
export const CURRENT_SAFETY_DISCLAIMER =
  "AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。";

/** 選択 0 件時の固定本文（設計 §6.2。共有コンポーネントの empty 分岐で使う）。 */
export const CURRENT_SAFETY_EMPTY_BODY = "家族を選ぶと、その人の条件がここに表示されます。";

/**
 * 現在の対象家族の安全条件サマリー。
 * onOpenSettings があるときは flush 済み navigate（route 所有）。無いときは Link 直遷移。
 * members が空のときは empty 固定文を出し、CTA/disclaimer の chrome は selected と同型（P9/P10）。
 */
export function CurrentSafetySummary({
  members,
  onOpenSettings,
  disabled = false,
}: {
  members: readonly PlannerSafetyMember[];
  /** P5: route が flush 後に /settings へ遷移する。未指定時は Link 直遷移。 */
  onOpenSettings?: () => void;
  /**
   * 家族設定 CTA の disabled。saving/submitting 中は openSettings が silent no-op になるため、
   * audience empty と同型で視覚的に無効化する（P9）。
   */
  disabled?: boolean;
}) {
  const isEmpty = members.length === 0;
  return (
    <Surface as="section" aria-labelledby="current-safety-title">
      <Inset pad={4}>
        <Stack gap={3}>
          <h2 id="current-safety-title">現在の家族・安全条件</h2>
          {isEmpty ? (
            <p>{CURRENT_SAFETY_EMPTY_BODY}</p>
          ) : (
            members.map((member) => (
              <div key={member.id}>
                <strong>{member.displayName}</strong>
                <p>{memberSafetyText(member)}</p>
                {member.blockedReason !== null && <p role="alert">{member.blockedReason}</p>}
              </div>
            ))
          )}
          {onOpenSettings !== undefined ? (
            <Button variant="secondary" disabled={disabled} onClick={onOpenSettings}>
              家族設定を変更
            </Button>
          ) : // 単体利用・テスト向けフォールバック。本番 route は onOpenSettings を渡す（P5）。
          // Link は保存中ガードを持たないため disabled 時は visually 抑止する。
          disabled ? (
            <Button variant="secondary" disabled>
              家族設定を変更
            </Button>
          ) : (
            <Link className="secondary-button min-h-11" to="/settings">
              家族設定を変更
            </Link>
          )}
          <p>{CURRENT_SAFETY_DISCLAIMER}</p>
        </Stack>
      </Inset>
    </Surface>
  );
}
