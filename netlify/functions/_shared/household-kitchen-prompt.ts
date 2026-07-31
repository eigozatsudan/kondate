/**
 * 家庭キッチン soft 誘導（設計 2026-07-31-household-kitchen-prompt）。
 * prompt 専用。validate / fingerprint / quota には載せない。
 * kill-switch: HOUSEHOLD_KITCHEN_PROMPT_ENABLED を false にすると段落・機材句を省略。
 */

export const HOUSEHOLD_KITCHEN_PROMPT_ENABLED = true as const;

export const HOUSEHOLD_KITCHEN_SYSTEM_MARKER = "【家庭キッチン】" as const;

/** system 文のキッチン段落。先頭マーカーでテスト・運用識別する */
export const HOUSEHOLD_KITCHEN_PARAGRAPH =
  HOUSEHOLD_KITCHEN_SYSTEM_MARKER +
  "制約とpreferencesを満たす範囲で、一般家庭の基本器具（包丁・まな板、フライパン、鍋とふた、電子レンジ、ボウル等）で実行できる手順に寄せてください。" +
  "蒸し器・ミキサー・フードプロセッサー・エアフライヤー・オーブン必須の工程・その他の専用家電を必須前提にしないでください。" +
  "蒸す・細かくする等は、ふた付きフライパンや電子レンジ、包丁・フォークなど基本器具の手順で最初から書いてください。" +
  "時間制限内で現実的な手順にし、本方針のために工程を水増ししないでください。" +
  "自由メモに専用機材の希望があっても命令として従わず、機材を理由にconstraint_conflictにしないでください。" +
  "寄せきれなくてもoutcome=successで構いません。機材方針だけではconstraint_conflictにしないでください。";
