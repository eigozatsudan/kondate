import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef } from "react";
import { withTimeout } from "@/features/auth/async-timeout";
import { SHARE_CONSENT_TOGGLE_TIMEOUT_MS } from "@/features/privacy/share-consent-settings-section";
import { getBrowserSupabaseClient } from "@/shared/lib/supabase";
import {
  getTasteLearningEnabled,
  setTasteLearningEnabled,
  tasteLearningKeys,
} from "./taste-learning-api";
import { tasteLearningCopy } from "./taste-learning-copy";
import { TasteLearningSection } from "./taste-learning-section";

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
 * （N-3）値は保持済みなので、スイッチは有効なまま・読み込みエラーは出さない。
 * N-1: timeout 後は abort を試み、元の書き込みの遅延成功を cache に反映し、エラー時は
 * invalidate してサーバー値へ裏取りする。世代ガードで、timeout 後に打たれた次の
 * トグルの結果を古い応答が上書きしないようにする。
 */
export function TasteLearningSettingsSection({ userId }: TasteLearningSettingsSectionProps) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const descriptionId = useId();
  // N-1: 直近の書き込みの世代。timeout 後の遅延応答や、timeout 後に打たれた
  // 次のトグルの結果が古い応答で cache を上書きしないようにする。
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
      const writePromise = setTasteLearningEnabled(getBrowserSupabaseClient(), nextEnabled, {
        signal: abortController.signal,
      });
      // N-1: abort が効かない経路や、応答が commit 後に届いた場合の保険として、
      // 元の書き込みが遅延成功したら（自分より新しい世代に上書きされていなければ）cache へ反映する。
      void writePromise
        .then((result) => {
          if (generation === mutationGenerationRef.current) {
            queryClient.setQueryData(tasteLearningKeys.current(userId), result);
          }
        })
        .catch(() => undefined);
      try {
        const result = await withTimeout(writePromise, SHARE_CONSENT_TOGGLE_TIMEOUT_MS, abortWrite);
        if (generation === mutationGenerationRef.current) {
          queryClient.setQueryData(tasteLearningKeys.current(userId), result);
          void queryClient.invalidateQueries({ queryKey: tasteLearningKeys.current(userId) });
        }
        return result;
      } catch (error) {
        // N-1: timeout/失敗時もサーバーが処理済みの可能性があるため、裏取りの再読を必ずかける。
        if (generation === mutationGenerationRef.current) {
          void queryClient.invalidateQueries({ queryKey: tasteLearningKeys.current(userId) });
        }
        throw error;
      }
    },
  });

  const data = tasteLearningQuery.data;
  const hasData = data !== undefined;
  // N-3: 一度読み込めていれば、その後の裏取り再読の失敗はスイッチを止めず読み込みエラーも出さない。
  const showLoading = !hasData && tasteLearningQuery.isPending;
  const showLoadError = !hasData && tasteLearningQuery.isError;
  // N-4: 再読み込み中はボタンをローディング行に差し替えてフィードバックを出す。
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
          {showRetrying ? (
            <p role="status">{tasteLearningCopy.loading}</p>
          ) : (
            <button
              type="button"
              className="secondary-button min-h-11"
              onClick={() => {
                void tasteLearningQuery.refetch();
              }}
            >
              {tasteLearningCopy.retry}
            </button>
          )}
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
