import type { JSX } from "react";
import { INSTALL_TIP_ANDROID_STEPS, INSTALL_TIP_IOS_STEPS } from "./install-tip-copy";
import {
  AndroidAddHomeIcon,
  AndroidMenuIcon,
  IosAddHomeIcon,
  IosConfirmBarIcon,
  IosShareIcon,
} from "./install-step-icons";

const IOS_ICONS = [IosShareIcon, IosAddHomeIcon, IosConfirmBarIcon] as const;
const ANDROID_ICONS = [AndroidMenuIcon, AndroidAddHomeIcon] as const;

export function HomeScreenInstallSteps(props: {
  kind: "ios" | "android" | "none";
}): JSX.Element | null {
  if (props.kind === "none") return null;
  const steps = props.kind === "ios" ? INSTALL_TIP_IOS_STEPS : INSTALL_TIP_ANDROID_STEPS;
  const icons = props.kind === "ios" ? IOS_ICONS : ANDROID_ICONS;
  return (
    <ol
      role="list"
      className="m-0 flex list-none min-w-0 flex-col gap-2 p-0 [overflow-wrap:anywhere]"
    >
      {steps.map((label, index) => {
        const Icon = icons[index];
        if (Icon === undefined) return null;
        // listitem は name-from-content されないため、手順文言を aria-label で明示する
        return (
          <li key={label} className="flex min-w-0 items-start gap-2" aria-label={label}>
            <span aria-hidden="true">{String(index + 1)}</span>
            <Icon />
            <span className="min-w-0">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
