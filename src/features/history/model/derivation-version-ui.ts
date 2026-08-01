/**
 * 案一覧 query から「複数案 / 単一案 / 未確定」を分ける。
 * data 未取得や error を「1案」とみなさない（採用ボタンの誤降格を防ぐ）。
 */
export type DerivationVersionUiState = {
  /** 2案以上と確定したとき true。スイッチャー表示・採用を主操作に。 */
  multiVersion: boolean;
  /**
   * 1案以下と確定したとき true。採用を副操作へ。
   * pending / error 中は false（unknown 扱い）。
   */
  confirmedSingle: boolean;
  versionsReady: boolean;
  versionsFailed: boolean;
};

export function derivationVersionUiState(input: {
  isSuccess: boolean;
  isError: boolean;
  data: readonly unknown[] | undefined;
}): DerivationVersionUiState {
  const versionsReady = input.isSuccess;
  const versionsFailed = input.isError;
  const count = input.data?.length ?? 0;
  return {
    multiVersion: versionsReady && count > 1,
    confirmedSingle: versionsReady && count <= 1,
    versionsReady,
    versionsFailed,
  };
}
