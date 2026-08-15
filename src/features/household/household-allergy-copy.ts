/**
 * アレルギー residual / 未確認警告の共有文言（settings・onboarding）。
 * 「安全です」保証は出さない。生成側は residual を評価し続ける。
 */

/** なし／未確認へ戻したあとも member_allergies が残る場合（H1/H2） */
export const RESIDUAL_ALLERGY_WARNING =
  "以前登録したアレルギーが残っています。献立生成の安全判定では引き続き使われます。不要なら下の一覧から削除できます。";

/**
 * H1: アレルギー一覧 error 時は length で residual を断定できない。
 * 未確認のまま「なし」保存しても DB 針が残る可能性があることを fail-closed で示す。
 */
export const RESIDUAL_ALLERGY_UNVERIFIED_WARNING =
  "アレルギー一覧を確認できないため、以前の登録が残っている可能性があります。献立生成の安全判定では登録済みのアレルギーが使われることがあります。通信を確認して再読み込みしてください。";

/**
 * H8: アレルギー編集面の保証否定。onboarding / planner と同文。
 * 「安全です」は出さない。
 */
export const ALLERGY_SAFETY_NOT_GUARANTEED =
  "AI生成だけでアレルギーの安全は保証できません。加工品の表示と家庭内の混入を確認してください。";
