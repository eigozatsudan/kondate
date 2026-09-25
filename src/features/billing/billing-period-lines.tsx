import { TRIAL_CANCEL_SCHEDULED_COPY, TRIAL_END_WARNING } from "./billing-ui-copy";
import { formatUpcomingBillingDate, formatUpcomingBillingLastDay } from "./format-billing-date";

/**
 * Plus LP（/plus）と設定のプラン欄で共有する、期間の表示行。
 * 両画面で同じ判定・同じ文言にそろえるため、ここだけで組む（UX 残り R2 項目 4・5）。
 * 表示だけの部品で、課金の状態判定（entitled・status）は呼び出し側と API が持つ。
 */

/**
 * 利用中の更新日・終了日。日付がなければ何も出さない（推測しない）。
 * 期間末が現在時刻以前なら出さない（webhook の遅れで古い期間末が残っても過去日を断言しない）。
 */
export function EntitledPeriodLine({
  periodEndIso,
  autoRenews,
  now,
}: {
  periodEndIso: string | null;
  autoRenews: boolean;
  now: Date;
}) {
  if (autoRenews) {
    const periodEnd = formatUpcomingBillingDate(periodEndIso, now);
    return periodEnd === null ? null : <p>次回の更新日: {periodEnd}</p>;
  }
  // 最終レビュー B Minor 3: 終了は「使える最後の日まで」で言う（期間末の日は使えない）
  const lastDay = formatUpcomingBillingLastDay(periodEndIso, now);
  return lastDay === null ? null : <p>{lastDay}まで Plus を使えます（自動更新なし）</p>;
}

/**
 * お試し中の無料期間の終了。更新日と同じく、終了日が現在時刻以前なら日付は出さない。
 * - 自動で有料に切り替わる人: 注意（TRIAL_END_WARNING）は日付に依存しない一般的な文なので、
 *   日付が出ないときも残す（trialEnd が null のときの既存の表示と同じ形）。
 * - 解約を予約した人（autoRenews=false）: 料金はかからないので課金の注意は出さず、終了する旨を出す。
 *   日付が分かれば利用中の解約予約と同じ「{最後の日}まで Plus を使えます（自動更新なし）」、
 *   分からなければ日付なしの TRIAL_CANCEL_SCHEDULED_COPY。
 */
export function TrialEndLines({
  trialEndIso,
  autoRenews,
  now,
}: {
  trialEndIso: string | null;
  autoRenews: boolean;
  now: Date;
}) {
  if (!autoRenews) {
    const lastDay = formatUpcomingBillingLastDay(trialEndIso, now);
    return lastDay !== null ? (
      <p>{lastDay}まで Plus を使えます（自動更新なし）</p>
    ) : (
      <p>{TRIAL_CANCEL_SCHEDULED_COPY}</p>
    );
  }
  const trialEnd = formatUpcomingBillingDate(trialEndIso, now);
  return (
    <div className="stack gap-1">
      {trialEnd !== null ? <p>無料期間の終了: {trialEnd}</p> : null}
      <p>{TRIAL_END_WARNING}</p>
    </div>
  );
}
