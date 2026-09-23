import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
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
 * 見出しと告知文は読み込み中・失敗時も常に表示し、値が未確認のスイッチだけを
 * 無効化する（初期値 true を偽装表示して誤操作を招かないため）。
 */
export function TasteLearningSettingsSection({ userId }: TasteLearningSettingsSectionProps) {
  const queryClient = useQueryClient();
  const descriptionId = useId();
  const tasteLearningQuery = useQuery({
    queryKey: tasteLearningKeys.current(userId),
    queryFn: () => getTasteLearningEnabled(getBrowserSupabaseClient(), userId),
  });
  const tasteLearningMutation = useMutation({
    mutationFn: (nextEnabled: boolean) =>
      withTimeout(
        setTasteLearningEnabled(getBrowserSupabaseClient(), nextEnabled),
        SHARE_CONSENT_TOGGLE_TIMEOUT_MS,
      ),
    onSuccess: (result) => {
      // RPC の戻り値をそのまま cache へ反映してから裏取りの invalidate をかける
      queryClient.setQueryData(tasteLearningKeys.current(userId), result);
      void queryClient.invalidateQueries({ queryKey: tasteLearningKeys.current(userId) });
    },
  });

  const isLoading = tasteLearningQuery.isPending;
  const isError = tasteLearningQuery.isError;

  return (
    <section className="card stack settings-section" aria-labelledby="taste-learning-title">
      <h2 id="taste-learning-title" className="settings-section-title">
        {tasteLearningCopy.title}
      </h2>
      <p id={descriptionId} className="type-small text-ink/80">
        {tasteLearningCopy.body}
        {tasteLearningCopy.sending}
        {tasteLearningCopy.storage}
      </p>
      {isLoading ? <p role="status">{tasteLearningCopy.loading}</p> : null}
      {isError ? (
        <div className="stack gap-2">
          <p role="alert">{tasteLearningCopy.loadError}</p>
          <button
            type="button"
            className="secondary-button min-h-11"
            onClick={() => {
              void tasteLearningQuery.refetch();
            }}
          >
            {tasteLearningCopy.retry}
          </button>
        </div>
      ) : null}
      <TasteLearningSection
        enabled={tasteLearningQuery.data ?? false}
        disabled={isLoading || isError}
        describedById={descriptionId}
        onToggle={async (nextEnabled) => {
          await tasteLearningMutation.mutateAsync(nextEnabled);
        }}
      />
    </section>
  );
}
