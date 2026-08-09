import { Link } from "react-router";
import { Stack } from "@/shared/ui/stack";
import type { DerivationVersionSummary } from "../api/history-api";

export type MenuVersionSwitcherProps = {
  /** version 昇順の案一覧。1件以下なら何も描画しない。 */
  versions: readonly DerivationVersionSummary[];
  /** いま表示中の menu id。 */
  currentMenuId: string;
  /**
   * 遷移先パス。結果画面は /menus/:id、履歴詳細は /history/:id。
   * 既定は /menus/:id（生成直後の結果導線）。
   */
  pathForMenuId?: (menuId: string) => string;
};

function parentLabel(
  version: DerivationVersionSummary,
  byId: ReadonlyMap<string, DerivationVersionSummary>,
): string | null {
  if (version.parentMenuId === null) return "最初の案";
  const parent = byId.get(version.parentMenuId);
  // 親が削除・未取得でも「枝分かれ」があることは伝える（C8）
  if (parent === undefined) return "別の案から";
  return `案${String(parent.version)}から`;
}

/**
 * 同一派生グループの案を横スクロールのチップで切り替える。
 * タップは Link で別メニューへ（採用・再生成の元はその案）。
 * 案が1件だけのときは吟味 UI を出さない（ノイズ回避）。
 * 横スクロールと chip 見た目は .history-version-* 意味クラスへ退避。
 */
export function MenuVersionSwitcher({
  versions,
  currentMenuId,
  pathForMenuId = (id) => `/menus/${id}`,
}: MenuVersionSwitcherProps) {
  if (versions.length < 2) return null;

  const byId = new Map(versions.map((v) => [v.id, v]));

  return (
    <section className="history-version-switcher" aria-label="この献立の別案">
      <Stack gap={2}>
        <p className="history-version-switcher-title">
          別案を見比べる（{String(versions.length)}案）
        </p>
        <p className="type-small">
          見たい案を選ぶと内容が切り替わります。再生成は表示中の案が元になります。
        </p>
        <ul className="history-version-switcher-list">
          {versions.map((version) => {
            const isCurrent = version.id === currentMenuId;
            const parent = parentLabel(version, byId);
            const labelParts = [
              `案${String(version.version)}`,
              version.title,
              version.isSelected ? "採用中" : null,
              isCurrent ? "表示中" : null,
            ].filter((part): part is string => part !== null);
            return (
              <li key={version.id} className="history-version-switcher-item">
                {isCurrent ? (
                  // キーボード到達可能な現在案（div だと SR/Tab が兄弟 Link と非対称 — C9）
                  <span
                    className="history-version-chip history-version-chip--current min-h-11"
                    aria-current="page"
                    tabIndex={0}
                    role="link"
                    aria-disabled="true"
                    aria-label={labelParts.join("、")}
                  >
                    <span className="history-version-chip-label">
                      案{String(version.version)}
                      {version.isSelected ? " · 採用" : ""}
                      {" · 表示中"}
                    </span>
                    <span className="history-version-chip-title">{version.title}</span>
                    {parent !== null ? (
                      <span className="history-version-chip-parent type-small">{parent}</span>
                    ) : null}
                  </span>
                ) : (
                  <Link
                    to={pathForMenuId(version.id)}
                    className="history-version-chip min-h-11"
                    aria-label={labelParts.join("、")}
                  >
                    <span className="history-version-chip-label">
                      案{String(version.version)}
                      {version.isSelected ? " · 採用" : ""}
                    </span>
                    <span className="history-version-chip-title">{version.title}</span>
                    {parent !== null ? (
                      <span className="history-version-chip-parent type-small">{parent}</span>
                    ) : null}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Stack>
    </section>
  );
}
