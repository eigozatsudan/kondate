import type { ValidatedMenu } from "./generation.js";

export type MenuResultViewModel = {
  menu: ValidatedMenu;
  memberLabels: Readonly<Record<string, string>>;
  labelConfirmations: readonly {
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
  }[];
};
