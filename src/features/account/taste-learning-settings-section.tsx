import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
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
  mergeTasteLearningState,
  nextTasteLearningUnconfirmed,
  settleTasteLearningWrite,
  type TasteLearningSettleResult,
  type TasteLearningUnconfirmed,
} from "./taste-learning-settle";
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
 * そこで timeout・書き込み失敗時は settleTasteLearningWrite で確定させる。現在値を読み、
 * 連番が送った連番を超えていれば確定、超えていなければ現在値のまま連番だけを進める
 * 「柵」を書く。読み取りの失敗も柵の失敗も「まだ分からない」として間隔をおいて
 * 再試行し、それでも確かめられなければ未確定の記録を残して持続的な警告を出す。
 * 確定したら、その時点のサーバー値が要求値なら成功、違えば失敗表示にする。
 * 期限（時刻）で捨てる方式は端末の時計ずれで壊れるため採らない。
 *
 * cache への反映はすべて連番の順序ガード（mergeTasteLearningState）を通すので、
 * 遅れて届いた読み取り・柵の応答や、画面を開き直す前のインスタンスからの応答が
 * 新しい値を巻き戻すことはない。
 *
 * share-consent-settings-section.tsx は同じ問題を複数回の再読ポーリングで扱っている
 * （連番を持たないため）。片方の失敗時の扱いを直したら、もう片方も確認すること。
 */
export function TasteLearningSettingsSection({ userId }: TasteLearningSettingsSectionProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const descriptionId = useId();
  const queryKey = tasteLearningKeys.current(userId);
  const unconfirmedKey = tasteLearningKeys.unconfirmed(userId);
  const toggleWriteKey = tasteLearningKeys.toggleWrite(userId);
  const unconfirmedRetryKey = tasteLearningKeys.unconfirmedRetry(userId);

  /** 観測したサーバー値の連番で、もう適用されえない書き込みの未確定記録を消す。 */
  const clearSettledUnconfirmed = (state: TasteLearningState): void => {
    queryClient.setQueryData<TasteLearningUnconfirmed | null>(unconfirmedKey, (record) =>
      record != null && state.seq > record.expectedSeq ? null : record,
    );
  };

  const applyState = (state: TasteLearningState): void => {
    queryClient.setQueryData<TasteLearningState>(queryKey, (prev) =>
      mergeTasteLearningState(prev, state),
    );
    clearSettledUnconfirmed(state);
  };

  const settle = (
    client: BrowserSupabaseClient,
    expectedSeq: number,
    attempts: number,
  ): Promise<TasteLearningSettleResult> =>
    settleTasteLearningWrite(expectedSeq, attempts, {
      read: () =>
        withTimeout(getTasteLearningState(client, userId), TASTE_LEARNING_TOGGLE_TIMEOUT_MS),
      write: (enabled, seq) => writeTasteLearningOnce(client, enabled, seq),
      wait: () => waitMs(TASTE_LEARNING_FENCE_RETRY_DELAY_MS),
      observe: applyState,
    });

  const tasteLearningQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const fetched = await getTasteLearningState(getBrowserSupabaseClient(), userId);
      // TanStack Query は fetch が成功すると setQueryData を経由せず data をそのまま
      // 置き換えるため、applyState の連番ガードをすり抜けてしまう。バックグラウンド
      // refetch（focus 復帰など）の応答が、直近の書き込みの反映より後に届いた場合の
      // 巻き戻りを防ぐため、ここでも cache の連番と突き合わせてから返す。
      // 突き合わせてから TanStack Query が data を置き換えるまでの間に届いた applyState は
      // 上書きされうるが、幅はごく狭く、次の読み取りで正しい値へ戻る。
      clearSettledUnconfirmed(fetched);
      return mergeTasteLearningState(
        queryClient.getQueryData<TasteLearningState>(queryKey),
        fetched,
      );
    },
  });

  // サーバーへは問い合わせない画面側の状態。setQueryData でだけ書き換える。
  // queryFn は cache の値をそのまま返すので、万一 refetch されても記録は消えない。
  const unconfirmedQuery = useQuery({
    queryKey: unconfirmedKey,
    queryFn: () =>
      queryClient.getQueryData<TasteLearningUnconfirmed | null>(unconfirmedKey) ?? null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const unconfirmed = unconfirmedQuery.data;

  const tasteLearningMutation = useMutation({
    mutationKey: toggleWriteKey,
    mutationFn: async ({ nextEnabled, expectedSeq }: TasteLearningToggleRequest) => {
      const client = getBrowserSupabaseClient();

      let result: TasteLearningSetResult;
      try {
        result = await writeTasteLearningOnce(client, nextEnabled, expectedSeq);
      } catch (error) {
        const outcome = await settle(client, expectedSeq, TASTE_LEARNING_FENCE_ATTEMPTS);
        if (outcome.kind === "unconfirmed") {
          // サーバー側は本当に未確定。確定するまで消えない警告を出し、スイッチは
          // 直近に観測したサーバー値のまま・楽観値には戻さない。
          // 記録は query cache に利用者ごとに置くので、画面を離れて戻っても警告は消えない。
          // 並行する別の書き込みの、より新しい記録は上書きしない。
          const record: TasteLearningUnconfirmed = { requestedEnabled: nextEnabled, expectedSeq };
          queryClient.setQueryData<TasteLearningUnconfirmed | null>(unconfirmedKey, (prev) =>
            nextTasteLearningUnconfirmed(
              prev,
              queryClient.getQueryData<TasteLearningState>(queryKey),
              record,
            ),
          );
          return;
        }
        if (outcome.state.enabled === nextEnabled) {
          // 応答は失ったが commit していた、または別端末が同じ値へ変えていた
          return;
        }
        // 要求は通らないことが確定した（別端末が別の値へ変えていた場合を含む）
        throw error;
      }

      applyState(result);
      if (result.applied) {
        void queryClient.invalidateQueries({ queryKey });
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
   * 未確定警告の「もう一度読み込む」ボタン。記録した連番で確定を 1 回だけ試みる。
   * 確定すれば observe（applyState）が記録を消して警告が下がる。確かめられなければ
   * 警告は出したまま、もう一度押せる。
   */
  const unconfirmedRetryMutation = useMutation({
    mutationKey: unconfirmedRetryKey,
    mutationFn: async (record: TasteLearningUnconfirmed) => {
      await settle(getBrowserSupabaseClient(), record.expectedSeq, 1);
    },
  });

  // 走っている書き込み・再試行は、useMutation の isPending（インスタンスごと）ではなく
  // mutation cache から数える。画面を離れて戻る（再マウント）と isPending は false に戻るが、
  // 前のインスタンスが送った書き込みは走り続けているため、互いの disabled を失わないようにする。
  const isToggleWriting = useIsMutating({ mutationKey: toggleWriteKey }) > 0;
  const isUnconfirmedRetrying = useIsMutating({ mutationKey: unconfirmedRetryKey }) > 0;

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
          // 未確定の再試行（柵）の間はトグルを止める。同時に書くと柵が連番を奪い、
          // トグルが偽の失敗表示になる（逆方向は再試行ボタン側の disabled で止めている）
          disabled={isUnconfirmedRetrying}
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
            // トグルの書き込み中に柵を送ると、その書き込みの連番を奪って偽の失敗表示を出すので止める
            disabled={isUnconfirmedRetrying || isToggleWriting}
            onClick={() => {
              unconfirmedRetryMutation.mutate(unconfirmed);
            }}
          >
            {isUnconfirmedRetrying ? tasteLearningCopy.loading : tasteLearningCopy.unconfirmedRetry}
          </button>
        </div>
      ) : null}
    </section>
  );
}
