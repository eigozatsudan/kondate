/** Free 硬上限時の固定コピー（L10-1）。テスト exact 一致。 */
export const PLUS_HARD_LIMIT_COPY = "Plus なら 1 日最大 10 回まで作成できます" as const;
export const PLUS_HARD_LIMIT_BUTTON = "Plus を見る" as const;

/**
 * Free で成功残 0（または受付 0）のときの Plus 案内。
 * 着地は Plus LP（/plus）。Checkout は LP または設定。
 * react-router Link ではなく a を使い、Router 外 unit でも描画できるようにする。
 */
export function PlusHardLimitCta({ className }: { className?: string }) {
  return (
    <div className={className ?? "stack gap-2"} data-testid="plus-hard-limit-cta">
      <p>{PLUS_HARD_LIMIT_COPY}</p>
      <a
        href="/plus"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border-2 border-terracotta-700 px-4 font-semibold"
      >
        {PLUS_HARD_LIMIT_BUTTON}
      </a>
    </div>
  );
}
