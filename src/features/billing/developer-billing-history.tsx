import { PORTAL_BUTTON_LABEL } from "./billing-ui-copy";

/** DB の契約反映が遅れていても、過去の契約を持つ開発者の管理導線を残す。 */
export function DeveloperBillingHistory({
  surfacesOpen,
  pending,
  onPortal,
}: {
  surfacesOpen: boolean;
  pending: boolean;
  onPortal: () => void;
}) {
  return (
    <details className="stack gap-2">
      <summary>以前に有料プランを契約した方</summary>
      <p>有料契約が残っている場合、開発者向けの無料利用では自動解約されません。</p>
      {surfacesOpen ? (
        <button
          type="button"
          className="secondary-button min-h-11"
          disabled={pending}
          onClick={onPortal}
        >
          {PORTAL_BUTTON_LABEL}
        </button>
      ) : (
        <p>お支払い管理は現在停止しています。開発者向けの Plus は引き続き利用できます。</p>
      )}
    </details>
  );
}
