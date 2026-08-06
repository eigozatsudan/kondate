import { Link } from "react-router";
import { memberSafetyText, type PlannerSafetyMember } from "./planner-safety-member";

/**
 * 現在の対象家族の安全条件サマリー。
 * onOpenSettings があるときは flush 済み navigate（route 所有）。無いときは Link 直遷移。
 */
export function CurrentSafetySummary({
  members,
  onOpenSettings,
}: {
  members: readonly PlannerSafetyMember[];
  /** P5: route が flush 後に /settings へ遷移する。未指定時は Link 直遷移。 */
  onOpenSettings?: () => void;
}) {
  return (
    <section className="card stack" aria-labelledby="current-safety-title">
      <h2 id="current-safety-title">現在の家族・安全条件</h2>
      {members.map((member) => (
        <div key={member.id}>
          <strong>{member.displayName}</strong>
          <p>{memberSafetyText(member)}</p>
          {member.blockedReason !== null && <p role="alert">{member.blockedReason}</p>}
        </div>
      ))}
      {onOpenSettings !== undefined ? (
        <button className="secondary-button min-h-11" type="button" onClick={onOpenSettings}>
          家族設定を変更
        </button>
      ) : (
        // 単体利用・テスト向けフォールバック。本番 route は onOpenSettings を渡す（P5）。
        <Link className="secondary-button min-h-11" to="/settings">
          家族設定を変更
        </Link>
      )}
      <p>
        AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。
      </p>
    </section>
  );
}
