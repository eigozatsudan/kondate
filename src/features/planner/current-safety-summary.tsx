export type PlannerSafetyMember = {
  id: string;
  displayName: string;
  ageBandLabel: string;
  allergyLabel: string;
  safetyLabels: readonly string[];
  blockedReason: string | null;
};

function memberSafetyText(member: PlannerSafetyMember): string {
  const labels = [member.allergyLabel, member.ageBandLabel];
  if (member.safetyLabels.length > 0) labels.push(member.safetyLabels.join("・"));
  return labels.join("／");
}

export function CurrentSafetySummary({ members }: { members: readonly PlannerSafetyMember[] }) {
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
      <a href="/settings">家族設定を変更</a>
      <p>
        AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。
      </p>
    </section>
  );
}
