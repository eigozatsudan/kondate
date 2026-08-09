import type { JSX } from "react";

export type PageHeaderProps = {
  title: string;
  /** 見出し直下の導入文。 */
  lead?: string;
  /** 補足・注意書き。--muted で小さく出す。 */
  note?: string;
  /** aria-labelledby の参照先にする場合の見出し id。 */
  id?: string;
};

export function PageHeader({ title, lead, note, id }: PageHeaderProps): JSX.Element {
  return (
    <header className="ui-page-header">
      <h1 className="ui-page-header__title" {...(id !== undefined ? { id } : {})}>
        {title}
      </h1>
      {lead !== undefined && <p className="ui-page-header__lead">{lead}</p>}
      {note !== undefined && <p className="ui-page-header__note">{note}</p>}
    </header>
  );
}
