import type { PreferenceGapNote, ValidatedMenu } from "./generation.js";
import type { PantryItem } from "./pantry.js";
import type { PlannerSubmission, TargetMode } from "./planner.js";

/** 調理後の冷蔵庫操作対象。世代スナップショットではなく live row を保持する。 */
export type PantryPostCookTarget = {
  selectionId: string;
  pantryItemId: string | null;
  pantryItemName: string;
  plannedQuantity: number | null;
  unit: string | null;
  currentPantryRow: Pick<
    PantryItem,
    | "id"
    | "name"
    | "quantity"
    | "unit"
    | "expiresOn"
    | "expirationType"
    | "openedState"
    | "updatedAt"
  > | null;
  /**
   * live pantry SELECT が失敗したとき true。
   * currentPantryRow === null でも削除済みとみなさず、mutation は出さない（G26）。
   */
  liveUnavailable: boolean;
};

/**
 * idea/household の権威ある判定元。DBの menus.target_mode をそのまま持ち、
 * UI 側で家族安全表示を出すかどうかはこの値だけで決める（brief step 11）。
 */
export type MenuResultLabelConfirmation = {
  confirmationId: string;
  sourceType: ValidatedMenu["labelConfirmations"][number]["sourceType"];
  sourceId: string;
  sourcePath: string;
  sourceText: string;
  allergenName: string;
  memberLabel: string;
  dictionaryVersion: string;
  confirmationStatus: "pending" | "confirmed";
  requirementSafetyFingerprint: string;
  isCurrent: true;
  confirmedAt: string | null;
  confirmedBy: string | null;
};

export type MenuResultViewModel = {
  targetMode: TargetMode;
  /**
   * preference_snapshot.submission を plannerSubmissionSchema.safeParse した結果。
   * 成功時だけ値を持ち、解析できない・欠落している場合は null（家族条件の
   * 再現に失敗した場合でも安全側へ倒し、存在しない条件を捏造しない）。
   */
  sourceSubmission: PlannerSubmission | null;
  /**
   * menus.is_favorite の所有者向け投影。idea 結果/履歴のローカルお気に入り
   * トグル初期値と query 再取得後の同期元になる（false 既定で安全側）。
   */
  isFavorite: boolean;
  /**
   * 同一派生グループ内の案切替・採用判定に使う lineage 投影。
   * 兄弟案一覧 API のキーと、「この献立にする」の is_selected hydrate に使う。
   */
  derivationGroupId: string;
  /** グループ内の版番号（1 始まり）。案チップの「案N」表示に使う。 */
  version: number;
  /**
   * menus.is_selected。true のときグループ代表（採用版）。
   * 再生成で増えた案は false のまま（採用済みを維持する）。
   */
  isSelected: boolean;
  menu: ValidatedMenu;
  memberLabels: Readonly<Record<string, string>>;
  labelConfirmations: readonly MenuResultLabelConfirmation[];
  pantryPostCookTargets: readonly PantryPostCookTarget[];
  /**
   * A-I7: 苦手 soft gap。生成結果画面でのみ表示する（履歴詳細は空配列を渡す）。
   * DB 専用列には載せない。preference_snapshot から都度算出する。
   */
  preferenceGaps: readonly PreferenceGapNote[];
  /**
   * 生成に使われた最終 OpenRouter model ID。
   * private 台帳から所有者 RPC で投影する。台帳欠落・権限外・未記録は null。
   * UI は formatGenerationModelLabel で短い表示名へ落とす。
   */
  generationModelId: string | null;
};
