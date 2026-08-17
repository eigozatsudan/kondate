import type { JSX } from "react";

const svgClass = "h-6 w-6 shrink-0";

export function IosShareIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-share"
      fill="none"
      stroke="currentColor"
    >
      <path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
    </svg>
  );
}

export function IosAddHomeIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-add-home"
      fill="none"
      stroke="currentColor"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IosConfirmBarIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="ios-confirm-bar"
      fill="currentColor"
    >
      <rect x="4" y="10" width="16" height="4" rx="2" />
    </svg>
  );
}

export function AndroidMenuIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="android-menu"
      fill="currentColor"
    >
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </svg>
  );
}

export function AndroidAddHomeIcon(): JSX.Element {
  return (
    <svg
      className={svgClass}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-icon="android-add-home"
      fill="none"
      stroke="currentColor"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}
