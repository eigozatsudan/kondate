import type { TasteLearningSetResult, TasteLearningState } from "./taste-learning-api";

/**
 * 成否の分からない書き込み（expectedSeq で送ったもの）が、この先サーバーで適用されうるか。
 * サーバーの連番は書き込みのたびに 1 進むだけなので、観測した連番が expectedSeq を
 * 超えていれば、その書き込みは既に適用されたか、今後届いても連番が合わず捨てられる。
 * どちらにしても、観測した値がそのまま最終値になる。
 */
export function isTasteLearningWriteSettled(observed: TasteLearningState, expectedSeq: number) {
  return observed.seq > expectedSeq;
}

/**
 * cache へ書くときの順序ガード。連番が cache より古い応答は捨てる。
 * 遅れて届いた読み取りや、画面を開き直した後に古いインスタンスから届いた応答が、
 * 新しい書き込みの結果を巻き戻さないようにする。連番が同じなら新しい応答を採る。
 */
export function mergeTasteLearningState(
  prev: TasteLearningState | undefined,
  next: TasteLearningState,
): TasteLearningState {
  if (prev !== undefined && prev.seq > next.seq) {
    return prev;
  }
  return { enabled: next.enabled, seq: next.seq };
}

export type TasteLearningSettleDeps = {
  /** 現在値の読み取り（timeout 込み）。失敗は reject。 */
  read: () => Promise<TasteLearningState>;
  /** 比較更新の書き込み（timeout・abort 込み）。失敗は reject。 */
  write: (enabled: boolean, expectedSeq: number) => Promise<TasteLearningSetResult>;
  /** 試行の間の待機。 */
  wait: () => Promise<void>;
  /** 観測したサーバー値を cache へ反映する。 */
  observe: (state: TasteLearningState) => void;
};

export type TasteLearningSettleResult =
  { kind: "settled"; state: TasteLearningState } | { kind: "unconfirmed" };

/**
 * 成否の分からない書き込みを確定させる。
 *
 * abort は fetch を打ち切るだけでサーバーの commit は止めない。proxy に滞留した書き込みは
 * 画面が諦めた後に commit しうるので、「その書き込みがもう適用されえない」ことを
 * 確かめるまで終わらない。各試行では現在値を読み、連番が進んでいれば確定する。
 * 進んでいなければ、現在値のまま連番だけを進める柵を書く。柵の答えは applied の
 * true/false どちらでも連番が進んでいることを示すので、そこで確定する。
 *
 * 読み取りの失敗も柵の失敗も同じ扱いにする（どちらも「まだ分からない」）。
 * 元の書き込みを止めた詰まりは読み取りや柵も止めがちなので、間隔をおいて
 * attempts 回まで試み、それでも分からなければ unconfirmed を返す。
 */
export async function settleTasteLearningWrite(
  expectedSeq: number,
  attempts: number,
  deps: TasteLearningSettleDeps,
): Promise<TasteLearningSettleResult> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const current = await deps.read();
      deps.observe(current);
      if (isTasteLearningWriteSettled(current, expectedSeq)) {
        return { kind: "settled", state: current };
      }
      const fence = await deps.write(current.enabled, current.seq);
      deps.observe(fence);
      if (isTasteLearningWriteSettled(fence, expectedSeq)) {
        return { kind: "settled", state: { enabled: fence.enabled, seq: fence.seq } };
      }
    } catch {
      // この試行では分からなかった。残りの試行で確かめる
    }
    if (attempt < attempts) {
      await deps.wait();
    }
  }
  return { kind: "unconfirmed" };
}
