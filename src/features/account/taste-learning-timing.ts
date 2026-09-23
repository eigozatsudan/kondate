/**
 * 好みの学習トグルの timeout（書き込み・失敗後の再読・柵の書き込みのそれぞれに掛ける）。
 * 値は ShareConsentSettingsSection（share-consent-settings-section.tsx）の
 * SHARE_CONSENT_TOGGLE_TIMEOUT_MS とわざと同じ値にしている。
 * account 側は privacy のコンポーネントファイルへ依存しないよう、ここへ
 * 別名で定義する。
 */
export const TASTE_LEARNING_TOGGLE_TIMEOUT_MS = 10_000;
