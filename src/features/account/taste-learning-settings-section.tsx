import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { waitMs, withTimeout } from "@/features/auth/async-timeout";
import { getBrowserSupabaseClient, type BrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  getTasteLearningState,
  setTasteLearningEnabled,
  tasteLearningKeys,
  type TasteLearningSetResult,
  type TasteLearningState,
} from "./taste-learning-api";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSection } from "./taste-learning-section";
import {
  TASTE_LEARNING_FENCE_ATTEMPTS,
  TASTE_LEARNING_FENCE_RETRY_DELAY_MS,
  TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
} from "./taste-learning-timing";

export type TasteLearningSettingsSectionProps = {
  userId: string;
};

type TasteLearningToggleRequest = {
  nextEnabled: boolean;
  /** 画面が最後に読んだ連番。サーバーはこれと一致したときだけ書く。 */
  expectedSeq: number;
};

/** 柵を打ち尽くしても答えが得られず、未確定のまま持続的な警告を出す対象になった要求。 */
type PendingUnconfirmed = {
  requestedEnabled: boolean;
};

/**
 * サーバーから受け取った状態を cache へ書く。ただし連番が cache より古ければ捨てる。
 * 遅れて届いた再読・柵の応答が、後から届いた新しい書き込みの結果を巻き戻さないための
 * 順序ガード（M-1）。世代ガード（mutationGenerationRef）はコンポーネントの
 * 1 インスタンス内でしか効かないため、remount をまたぐ巻き戻りはこちらで防ぐ。
 */
function mergeBySeq(
  prev: TasteLearningState | undefined,
  next: TasteLearningState,
): TasteLearningState {
  if (prev !== undefined && prev.seq > next.seq) {
    return prev;
  }
  return next;
}

/** 書き込み 1 回分。abort 付き timeout でラップする（柵の書き込みも同じ形）。 */
function writeTasteLearningOnce(
  client: BrowserSupabaseClient,
  enabled: boolean,
  seq: number,
): Promise<TasteLearningSetResult> {
  const abortController = new AbortController();
  return withTimeout(
    setTasteLearningEnabled(client, enabled, seq, { signal: abortController.signal }),
    TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
    () => {
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    },
  );
}

/**
 * 好みの学習トグルの読み書きを設定ページへ配線する。
 * 読み取りは設定画面専用の getTasteLearningState（household の select("*") とは
 * 別系統）、書き込みは set_taste_learning_enabled RPC のみ。
 * ShareConsentSettingsSection と同様、getBrowserSupabaseClient() を都度取得し、
 * RPC の戻り値をそのまま query cache へ書いてから invalidate して裏取りする。
 * 見出しと告知文は読み込み中・失敗時も常に表示する。値が未確認の間（初回読み込み中、
 * または一度も読み込めていない失敗時）はスイッチ自体を出さない — ON がデフォルトのため
 * `?? false` で偽の OFF を見せると誤操作を招く。一度読み込めた後の裏取り再読が失敗しても
 * 値は保持済みなので、スイッチは有効なまま・読み込みエラーは出さない。
 *
 * 書き込みは連番つきの比較更新（CAS）。abort は fetch を打ち切るだけでサーバー側の
 * commit は止まらず、proxy に滞留した書き込みが画面の再読より後に commit しうる
 * （OFF と表示したまま、サーバーは ON に戻って料理名が AI へ送られる）。
 * そこで timeout・書き込み失敗時は、現在値を 1 回読み、要求値と一致すれば成功扱い、
 * 一致しなければ現在値のまま連番だけを進める「柵」の書き込みを送る。柵が通れば、
 * 滞留中の古い書き込みは連番が合わずサーバーで捨てられる。期限（時刻）で捨てる方式は
 * 端末の時計ずれで壊れるため採らない。
 *
 * 柵自体も timeout・失敗しうる（元の書き込みを止めたのと同じ相関障害が柵も止めうる）。
 * 1 回で諦めると、柵より後に古い書き込みが commit する I-1 の抜け道が残るため、
 * 柵は間隔をおいて TASTE_LEARNING_FENCE_ATTEMPTS 回まで再試行する。再試行のたびに
 * 現在値を読み直し、その連番・値で次の柵を送る（読み直しにも失敗したら直前に分かって
 * いる値のまま次を試みる）。何度試みても答え（applied の true/false どちらか）が
 * 得られなければ、サーバー側の状態は本当に未確定のため、確定するまで消えない警告を
 * 別に出し、スイッチは直近に読んだサーバー値のまま・楽観値には戻さない。
 *
 * share-consent-settings-section.tsx は同じ問題を複数回の再読ポーリングで扱っている
 * （連番を持たないため）。片方の失敗時の扱いを直したら、もう片方も確認すること。
 * 世代ガードは、pending 中はスイッチが disabled のため実際には到達しない防御であり、
 * timeout 後に打たれた次のトグルの結果を古い応答が上書きしないための保険として置いている。
 */
export function TasteLearningSettingsSection({ userId }: TasteLearningSettingsSectionProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const descriptionId = useId();
  const queryKey = tasteLearningKeys.current(userId);
  // 直近の書き込みの世代。timeout 後の遅延応答や、timeout 後に打たれた
  // 次のトグルの結果が古い応答で cache を上書きしないようにする（防御的なガードで、
  // 現状の UI では pending 中はスイッチが disabled のため実際にはこの経路を通らない）。
  const mutationGenerationRef = useRef(0);
  // 柵を打ち尽くしても答えが得られなかった直近の要求。確定するまで消えない警告に使う。
  const [unconfirmed, setUnconfirmed] = useState<PendingUnconfirmed | null>(null);

  const applyState = (state: TasteLearningState): void => {
    // state は TasteLearningSetResult（applied 付き）で渡ってくることもあるが、
    // cache に持たせるのは enabled/seq のみ。余分なキーを持ち込まないよう正規化する。
    const normalized: TasteLearningState = { enabled: state.enabled, seq: state.seq };
    queryClient.setQueryData<TasteLearningState>(queryKey, (prev) => mergeBySeq(prev, normalized));
  };

  const tasteLearningQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const fetched = await getTasteLearningState(getBrowserSupabaseClient(), userId);
      // TanStack Query は fetch が成功すると setQueryData を経由せず data をそのまま
      // 置き換えるため、applyState の連番ガードをすり抜けてしまう。バックグラウンド
      // refetch（focus 復帰など）の応答が、直近の書き込みの反映より後に届いた場合の
      // 巻き戻りを防ぐため、ここでも cache の連番と突き合わせてから返す（M-1）。
      return mergeBySeq(queryClient.getQueryData<TasteLearningState>(queryKey), fetched);
    },
  });

  const tasteLearningMutation = useMutation({
    mutationFn: async ({ nextEnabled, expectedSeq }: TasteLearningToggleRequest) => {
      const generation = ++mutationGenerationRef.current;
      const isCurrentGeneration = (): boolean => generation === mutationGenerationRef.current;
      const applyIfCurrent = (state: TasteLearningState): void => {
        if (isCurrentGeneration()) {
          applyState(state);
        }
      };
      const invalidateIfCurrent = (): void => {
        if (isCurrentGeneration()) {
          void queryClient.invalidateQueries({ queryKey });
        }
      };
      // 新しい利用者操作が始まったので、前回の未確定警告は持ち越さない。
      setUnconfirmed(null);
      const client = getBrowserSupabaseClient();

      let result: TasteLearningSetResult;
      try {
        result = await writeTasteLearningOnce(client, nextEnabled, expectedSeq);
      } catch (error) {
        if (!isCurrentGeneration()) {
          throw error;
        }
        // 書き込みの成否が分からない。現在値を 1 回だけ読む。
        let current: TasteLearningState;
        try {
          current = await withTimeout(
            getTasteLearningState(client, userId),
            TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
          );
        } catch {
          invalidateIfCurrent();
          throw error;
        }
        if (!isCurrentGeneration()) {
          throw error;
        }
        applyIfCurrent(current);
        if (current.enabled === nextEnabled) {
          // 応答は失ったが、サーバーは要求どおり commit していた
          return;
        }

        // 未 commit の書き込みがまだどこかに滞留しているかもしれない。現在値のまま
        // 連番だけを進める柵を送り、それが後から届いても連番が合わず捨てられるように
        // する。柵自体も止まりうるので、間隔をおいて複数回試みる（I-1）。
        let fenceEnabled = current.enabled;
        let fenceSeq = current.seq;
        let fence: TasteLearningSetResult | undefined;
        for (let attempt = 1; attempt <= TASTE_LEARNING_FENCE_ATTEMPTS; attempt += 1) {
          try {
            fence = await writeTasteLearningOnce(client, fenceEnabled, fenceSeq);
            break;
          } catch {
            if (attempt === TASTE_LEARNING_FENCE_ATTEMPTS) {
              break;
            }
            await waitMs(TASTE_LEARNING_FENCE_RETRY_DELAY_MS);
            if (!isCurrentGeneration()) {
              throw error;
            }
            try {
              const latest = await withTimeout(
                getTasteLearningState(client, userId),
                TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
              );
              fenceEnabled = latest.enabled;
              fenceSeq = latest.seq;
            } catch {
              // 再読も失敗。直前に分かっている値のまま次の柵を試みる。
            }
          }
        }

        if (fence === undefined) {
          // 何度試みても柵の答え（true/false どちらの applied も）が得られない。
          // サーバー側は本当に未確定なので、確定するまで消えない警告を別に出す。
          // スイッチは直前に読んだサーバー値（current）のままにし、楽観値には戻さない。
          if (isCurrentGeneration()) {
            setUnconfirmed({ requestedEnabled: nextEnabled });
          }
          return;
        }

        applyIfCurrent(fence);
        if (fence.enabled === nextEnabled) {
          // 柵の答えの時点で、要求どおりの値になっていることが確定した
          // （柵より先に滞留していた書き込みが通っていた、または別端末が同じ値へ変えていた）
          return;
        }
        // 柵の答えで、要求は通らないことが確定した（別端末が別の値へ変えていた場合を含む）
        throw error;
      }

      applyIfCurrent(result);
      if (result.applied) {
        invalidateIfCurrent();
        return;
      }
      // 連番が合わず書かれなかった: 別端末などが先に変えている。サーバーが既に
      // 要求値なら結果として望みどおりなので成功扱い、違えば失敗表示を出す。
      if (result.enabled !== nextEnabled) {
        throw new Error("taste_learning_conflict");
      }
    },
  });

  /**
   * 未確定警告の「もう一度読み込む」ボタン。現在値を読み直し、要求値と一致すれば
   * それで確定として警告を下げる。一致しなければ柵を 1 回送り、その答え（true/false
   * どちらでも）が得られれば確定として警告を下げる。読みにも柵にも失敗した場合は
   * 警告を出したままにする（自動では消さない）。
   */
  const unconfirmedRetryMutation = useMutation({
    mutationFn: async () => {
      if (unconfirmed === null) {
        return;
      }
      const { requestedEnabled } = unconfirmed;
      const client = getBrowserSupabaseClient();

      const readResult = await tasteLearningQuery.refetch();
      if (readResult.isError || readResult.data === undefined) {
        return;
      }
      const latest = readResult.data;
      applyState(latest);
      if (latest.enabled === requestedEnabled) {
        setUnconfirmed(null);
        return;
      }

      try {
        const fence = await writeTasteLearningOnce(client, latest.enabled, latest.seq);
        applyState(fence);
        setUnconfirmed(null);
      } catch {
        // まだ確定しない。警告は出したままにする。
      }
    },
  });

  const data = tasteLearningQuery.data;
  const hasData = data !== undefined;
  // 値の無いクエリを再読み込みすると TanStack Query は status を pending・error を null へ
  // 戻すため、isError だけを見るとエラー表示とフォーカス中のボタンが丸ごと消える。
  // errorUpdateCount は再読み込みでは戻らないので、「一度でも失敗し、まだ値が無い」をここから導く。
  const hasLoadErrored = tasteLearningQuery.errorUpdateCount > 0;
  const showLoading = !hasData && !hasLoadErrored && tasteLearningQuery.isPending;
  // 一度読み込めていれば、その後の裏取り再読の失敗はスイッチを止めず読み込みエラーも出さない。
  const showLoadError = !hasData && hasLoadErrored;
  // 再読み込み中はボタンを消さずに disabled + ローディング文言へ差し替える
  // （フォーカス中のボタンを unmount するとフォーカスが body に落ちるため）。
  const showRetrying = showLoadError && tasteLearningQuery.isFetching;

  return (
    <section className="card stack settings-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="settings-section-title">
        {tasteLearningCopy.title}
      </h2>
      <p id={descriptionId} className="type-small text-ink/80">
        {tasteLearningCopy.body}
        {tasteLearningCopy.sending}
        {tasteLearningCopy.storage}
      </p>
      {showLoading ? <p role="status">{tasteLearningCopy.loading}</p> : null}
      {showLoadError ? (
        <div className="stack gap-2">
          <p role="alert">{tasteLearningCopy.loadError}</p>
          <button
            type="button"
            className="secondary-button min-h-11"
            disabled={showRetrying}
            onClick={() => {
              void tasteLearningQuery.refetch();
            }}
          >
            {showRetrying ? tasteLearningCopy.loading : tasteLearningCopy.retry}
          </button>
        </div>
      ) : null}
      {hasData ? (
        <TasteLearningSection
          enabled={data.enabled}
          describedById={descriptionId}
          onToggle={async (nextEnabled) => {
            await tasteLearningMutation.mutateAsync({ nextEnabled, expectedSeq: data.seq });
          }}
        />
      ) : null}
      {unconfirmed !== null ? (
        <div className="stack gap-2">
          <p role="alert">{tasteLearningCopy.unconfirmed}</p>
          <button
            type="button"
            className="secondary-button min-h-11"
            disabled={unconfirmedRetryMutation.isPending}
            onClick={() => {
              unconfirmedRetryMutation.mutate();
            }}
          >
            {tasteLearningCopy.unconfirmedRetry}
          </button>
        </div>
      ) : null}
    </section>
  );
}
