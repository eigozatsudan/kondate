/**
 * 好みの学習トグルの timeout・再読ポーリングの定数。
 * 値は ShareConsentSettingsSection（share-consent-settings-section.tsx）の
 * SHARE_CONSENT_TOGGLE_TIMEOUT_MS / SHARE_CONSENT_RECONCILE_ATTEMPTS /
 * SHARE_CONSENT_RECONCILE_RETRY_DELAY_MS とわざと同じ値にしている。
 * account 側は privacy のコンポーネントファイルへ依存しないよう、ここへ
 * 別名で定義する。
 */
export const TASTE_LEARNING_TOGGLE_TIMEOUT_MS = 10_000;

export const TASTE_LEARNING_RECONCILE_ATTEMPTS = 3;

export const TASTE_LEARNING_RECONCILE_RETRY_DELAY_MS = 1_000;
