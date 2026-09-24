/**
 * role="switch" の横に出す「オン／オフ」の文字。
 * スイッチのつまみの位置と色だけに頼らず、状態を文字でも見せるための見た目の補助。
 * 読み上げは switch 自身の checked 状態に任せるので aria-hidden にする
 * （二重に読み上げない。label 内に置いてもアクセシブルネームに混ざらない）。
 */
export function SwitchStateText({ checked }: { checked: boolean }) {
  return (
    <span className="switch-state-text" aria-hidden="true">
      {checked ? "オン" : "オフ"}
    </span>
  );
}
