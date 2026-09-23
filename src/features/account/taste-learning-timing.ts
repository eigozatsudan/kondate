/**
 * 好みの学習トグルの timeout（書き込み・失敗後の再読・柵の書き込みのそれぞれに掛ける）。
 * 値は ShareConsentSettingsSection（share-consent-settings-section.tsx）の
 * SHARE_CONSENT_TOGGLE_TIMEOUT_MS とわざと同じ値にしている。
 * account 側は privacy のコンポーネントファイルへ依存しないよう、ここへ
 * 別名で定義する。
 */
export const TASTE_LEARNING_TOGGLE_TIMEOUT_MS = 10_000;

/**
 * 書き込みの成否が分からないとき、確定（読み取り、必要なら柵）を試みる最大回数。
 * 1 回失敗しただけで諦めると、UI は OFF のまま滞留していた古い書き込みが
 * 後から commit しうる。相関した失敗（同じ proxy/pool の詰まり）は
 * 短い間隔を置くと解消することが多いため、間隔をおいて数回だけ再試行する。
 * それでも確かめられなければ「未確定」として持続的な警告を出す。
 * 警告の「もう一度読み込む」は利用者が押すたびに 1 回だけ試みる。
 */
export const TASTE_LEARNING_FENCE_ATTEMPTS = 3;

/** 確定の再試行の間隔。端末の時計に依存しない単純な待機。 */
export const TASTE_LEARNING_FENCE_RETRY_DELAY_MS = 1_000;
