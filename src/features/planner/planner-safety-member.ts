export type PlannerSafetyMember = {
  id: string;
  displayName: string;
  ageBandLabel: string;
  allergyLabel: string;
  safetyLabels: readonly string[];
  /** 生の required_safety_constraints（safetyLabels は翻訳済み表示ラベルで別物）。 */
  requiredSafetyConstraints: readonly string[];
  blockedReason: string | null;
};

export function memberSafetyText(member: PlannerSafetyMember): string {
  const labels = [member.allergyLabel, member.ageBandLabel];
  if (member.safetyLabels.length > 0) labels.push(member.safetyLabels.join("・"));
  return labels.join("／");
}
