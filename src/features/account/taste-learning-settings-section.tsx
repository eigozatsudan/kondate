import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { withTimeout } from "@/features/auth/async-timeout";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  getTasteLearningState,
  setTasteLearningEnabled,
  tasteLearningKeys,
  type TasteLearningSetResult,
  type TasteLearningState,
} from "./taste-learning-api";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSection } from "./taste-learning-section";
import { TASTE_LEARNING_TOGGLE_TIMEOUT_MS } from "./taste-learning-timing";

export type TasteLearningSettingsSectionProps = {
  userId: string;
};

type TasteLearningToggleRequest = {
  nextEnabled: boolean;
  /** 画面が最後に読んだ連番。サーバーはこれと一致したときだけ書く。 */
  expectedSeq: number;
};

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
 * share-consent-settings-section.tsx は同じ問題を複数回の再読ポーリングで扱っている
 * （連番を持たないため）。片方の失敗時の扱いを直したら、もう片方も確認すること。
 * 世代ガードは、pending 中はスイッチが disabled のため実際には到達しない防御であり、
 * timeout 後に打たれた次のトグルの結果を古い応答が上書きしないための保険として置いている。
 */
export function TasteLearningSettingsSection({ userId }: TasteLearningSettingsSectionProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const descriptionId = useId();
  // 直近の書き込みの世代。timeout 後の遅延応答や、timeout 後に打たれた
  // 次のトグルの結果が古い応答で cache を上書きしないようにする（防御的なガードで、
  // 現状の UI では pending 中はスイッチが disabled のため実際にはこの経路を通らない）。
  const mutationGenerationRef = useRef(0);

  const tasteLearningQuery = useQuery({
    queryKey: tasteLearningKeys.current(userId),
    queryFn: () => getTasteLearningState(getBrowserSupabaseClient(), userId),
  });

  const tasteLearningMutation = useMutation({
    mutationFn: async ({ nextEnabled, expectedSeq }: TasteLearningToggleRequest) => {
      const generation = ++mutationGenerationRef.current;
      const isCurrentGeneration = (): boolean => generation === mutationGenerationRef.current;
      const queryKey = tasteLearningKeys.current(userId);
      const applyServerState = (state: TasteLearningState): void => {
        if (isCurrentGeneration()) {
          queryClient.setQueryData<TasteLearningState>(queryKey, {
            enabled: state.enabled,
            seq: state.seq,
          });
        }
      };
      const invalidateIfCurrent = (): void => {
        if (isCurrentGeneration()) {
          void queryClient.invalidateQueries({ queryKey });
        }
      };
      const client = getBrowserSupabaseClient();
      // 書き込みは abort を試みたうえで timeout で打ち切る（柵の書き込みも同じ扱い）
      const writeWithTimeout = (enabled: boolean, seq: number): Promise<TasteLearningSetResult> => {
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
      };

      let result: TasteLearningSetResult;
      try {
        result = await writeWithTimeout(nextEnabled, expectedSeq);
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
        applyServerState(current);
        if (current.enabled === nextEnabled) {
          // 応答は失ったが、サーバーは要求どおり commit していた
          return;
        }
        // 未 commit の書き込みがまだどこかに滞留しているかもしれない。現在値のまま
        // 連番だけを進め、それが後から届いても連番が合わず捨てられるようにする。
        let fence: TasteLearningSetResult;
        try {
          fence = await writeWithTimeout(current.enabled, current.seq);
        } catch {
          invalidateIfCurrent();
          throw error;
        }
        applyServerState(fence);
        if (!fence.applied && fence.enabled === nextEnabled) {
          // 柵より先に、滞留していた書き込み（または別端末の同じ変更）が通っていた
          return;
        }
        // 柵が通った（要求は通らないことが確定）か、別端末が別の値へ変えていた
        throw error;
      }

      applyServerState(result);
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
    </section>
  );
}
