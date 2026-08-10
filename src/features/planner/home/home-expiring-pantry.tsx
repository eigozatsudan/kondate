import type { JSX, MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Badge, type BadgeTone } from "@/shared/ui/feedback";
import { Inset, Stack } from "@/shared/ui/stack";
import { Surface } from "@/shared/ui/surface";
import {
  navigateAfterPlannerLeaveFlush,
  shouldInterceptPlannerLeaveClick,
} from "../planner-leave-flush";

/** ホームに載せる期限注意食材 1 件（route が notice まで解決して渡す）。 */
export type HomeExpiringPantryItem = {
  id: string;
  name: string;
  expiresOn: string;
  tone: BadgeTone;
  suffix: string;
};

export type HomeExpiringPantryProps = {
  items: readonly HomeExpiringPantryItem[];
};

/**
 * 期限が近い／切れた食材の気づき枠。表示専用。
 * 安全保証は出さず、冷蔵庫タブへの導線と Badge による注意だけを示す。
 * P1: 冷蔵庫 Link は leave-flush を await してから遷移（下ナビと同型。失敗は stay）。
 */
export function HomeExpiringPantry({ items }: HomeExpiringPantryProps): JSX.Element | null {
  const navigate = useNavigate();
  // 該当が無いときはセクションごと出さず、ホームを詰め込まない。
  if (items.length === 0) return null;

  const onPantryClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!shouldInterceptPlannerLeaveClick(event)) return;
    event.preventDefault();
    void navigateAfterPlannerLeaveFlush(navigate, "/pantry");
  };

  return (
    <Surface as="section" tone="notice" aria-labelledby="home-expiring-heading">
      <Inset pad={5}>
        <Stack gap={3}>
          <h2 id="home-expiring-heading" className="home-section-title">
            期限が近い食材
          </h2>
          <p className="type-small">
            期限日は並びと注意のための表示です。食べられるかの判断はアプリでは行いません。
          </p>
          <Stack as="ul" gap={2} aria-label="期限が近い食材一覧">
            {items.map((item) => (
              <li key={item.id} className="home-expiring-item">
                <Stack gap={1}>
                  <span className="home-expiring-name">{item.name}</span>
                  <Stack gap={1}>
                    <span className="type-small">
                      {item.expiresOn}
                      <Badge tone={item.tone}>{item.suffix}</Badge>
                    </span>
                  </Stack>
                </Stack>
              </li>
            ))}
          </Stack>
          <Link className="button-link min-h-11" to="/pantry" onClick={onPantryClick}>
            冷蔵庫を見る
          </Link>
        </Stack>
      </Inset>
    </Surface>
  );
}
