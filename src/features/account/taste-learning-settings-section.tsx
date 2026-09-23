import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { waitMs, withTimeout } from "@/features/auth/async-timeout";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  getTasteLearningEnabled,
  setTasteLearningEnabled,
  tasteLearningKeys,
} from "./taste-learning-api";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSection } from "./taste-learning-section";
import {
  TASTE_LEARNING_RECONCILE_ATTEMPTS,
  TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS,
  TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
} from "./taste-learning-timing";

export type TasteLearningSettingsSectionProps = {
  userId: string;
};

/**
 * 好みの学習トグルの読み書きを設定ページへ配線する。
 * 読み取りは設定画面専用の getTasteLearningEnabled（household の select("*") とは
 * 別系統）、書き込みは set_taste_learning_enabled RPC のみ。
 * ShareConsentSettingsSection と同様、getBrowserSupabaseClient() を都度取得し、
 * RPC の戻り値をそのまま query cache へ書いてから invalidate して裏取りする。
 * 見出しと告知文は読み込み中・失敗時も常に表示する。値が未確認の間（初回読み込み中、
 * または一度も読み込めていない失敗時）はスイッチ自体を出さない — ON がデフォルトのため
 * `?? false` で偽の OFF を見せると誤操作を招く。一度読み込めた後の裏取り再読が失敗しても
 * 値は保持済みなので、スイッチは有効なまま・読み込みエラーは出さない。
 * timeout・書き込み失敗時は abort を試みたうえで、getTasteLearningEnabled を
 * 最大 TASTE_LEARNING_RECONCILE_ATTEMPTS 回、TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS 間隔で
 * 再読する（ShareConsentSettingsSection と同じ再読ポーリング。同形のロジックが
 * share-consent-settings-section.tsx の再読ループにもあるので、片方を直したら
 * もう片方も確認すること）。abort は fetch を打ち切る
 * だけでサーバー側の commit は止まらないため、直後の 1 回だけの再読では commit 前の値を
 * 正と誤認しうる。再読値が要求値と一致すれば成功扱いにして書き込み失敗を出さず、
 * 全て失敗すれば invalidate してサーバー値へ裏取りする。世代ガードは、pending 中は
 * スイッチが disabled のため実際には到達しない防御であり、timeout 後に打たれた次の
 * トグルの結果を古い応答が上書きしないための保険として置いている。
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
    queryFn: () => getTasteLearningEnabled(getBrowserSupabaseClient(), userId),
  });

  const tasteLearningMutation = useMutation({
    mutationFn: async (nextEnabled: boolean) => {
      const generation = ++mutationGenerationRef.current;
      const abortController = new AbortController();
      const abortWrite = (): void => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      };
      const client = getBrowserSupabaseClient();
      const writePromise = setTasteLearningEnabled(client, nextEnabled, {
        signal: abortController.signal,
      });
      try {
        const result = await withTimeout(
          writePromise,
          TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
          abortWrite,
        );
        if (generation === mutationGenerationRef.current) {
          queryClient.setQueryData(tasteLearningKeys.current(userId), result);
          void queryClient.invalidateQueries({ queryKey: tasteLearningKeys.current(userId) });
        }
        return result;
      } catch (error) {
        // abort は fetch を打ち切るだけでサーバーの commit は止まらないため、
        // 直後の 1 回だけの再読では commit 前の値を正と誤認しうる。世代ガード付きで
        // 複数回・間隔を空けて再読し、要求値と一致した時点で成功扱いにする。
        // 同形の再読ループが share-consent-settings-section.tsx の toggleMutation
        // catch にもある。片方を直したらもう片方も確認すること。
        if (generation !== mutationGenerationRef.current) {
          throw error;
        }
        let sawSuccessfulRead = false;
        for (let attempt = 0; attempt < TASTE_LEARNING_RECONCILE_ATTEMPTS; attempt += 1) {
          if (generation !== mutationGenerationRef.current) {
            throw error;
          }
          try {
            const fresh = await withTimeout(
              getTasteLearningEnabled(client, userId),
              TASTE_LEARNING_TOGGLE_TIMEOUT_MS,
            );
            sawSuccessfulRead = true;
            if (generation === mutationGenerationRef.current) {
              queryClient.setQueryData(tasteLearningKeys.current(userId), fresh);
            }
            if (fresh === nextEnabled) {
              // サーバーは実際には commit していた。再読で確定した値なので成功扱いにする。
              return fresh;
            }
          } catch {
            // この回の再読失敗。残回数でサーバーを再確認する。
          }
          if (attempt < TASTE_LEARNING_RECONCILE_ATTEMPTS - 1) {
            await waitMs(TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS);
          }
        }
        if (!sawSuccessfulRead && generation === mutationGenerationRef.current) {
          // 再読が全部失敗: 保持中のキャッシュ値をそのまま正とはせず、裏取りをやり直す。
          void queryClient.invalidateQueries({ queryKey: tasteLearningKeys.current(userId) });
        }
        throw error;
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
          enabled={data}
          describedById={descriptionId}
          onToggle={async (nextEnabled) => {
            await tasteLearningMutation.mutateAsync(nextEnabled);
          }}
        />
      ) : null}
    </section>
  );
}
