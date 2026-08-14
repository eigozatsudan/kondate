// 設計 §7: 有料を含み得るモデル提供者へプロンプトが渡り得ることを平易に伝える。内部 ID は出さない。
export const providerExplanation =
  "献立の作成には、OpenRouter（外部のAI仲介サービス）および設定されたAIモデルの提供者へ、入力内容が渡ることがあります。提供者には有料のサービスが含まれることがあります。混雑しているときは、同じ条件の別のモデルに切り替わることがあります。";

/**
 * アカウント削除後も匿名緊急候補本文が残り得る方針 B のユーザー向け一文。
 * 「アプリに保存する情報」本文とテストの単一ソース。
 */
export const accountDeletionAnonymousShareNote =
  "匿名一般化済みの緊急候補本文は、削除後も他ユーザー向けに残ることがあります。誰が作ったかの対応づけは残しません。";

/** AP3: Stripe Customer は税務・請求記録のため消さない。削除 UI で開示する。 */
export const accountDeletionStripeResidualNote =
  "お支払いの請求先（Stripe）に残った連絡先は、この削除では消えません。";

/** AP10: 他端末の下書き等は SPA から消せない。削除ダイアログで開示する。 */
export const accountDeletionOtherDeviceNote =
  "他の端末に残った下書きや一時データは、この操作では消えません。";

/** AP14: 既に外部へ送った一般化用テキストはアプリ削除では消えない。 */
export const accountDeletionProviderPromptNote =
  "すでに外部のAIへ送った一般化用の文章は、この削除では消えません。";

/** AP12: ステップアップは足さない。共有端末リスクだけ平易に注意する。 */
export const accountDeletionSharedDeviceNote =
  "この端末を他の人と共有している場合は、削除の前に必ずログアウトしてください。ログインしたままでは、他の人がこの操作を行えることがあります。";

/**
 * AP7: in-flight の OpenRouter 1 本は revoke / 削除後も止められない。
 * 撤回・削除コピーの単一ソース。
 */
export const shareInFlightSendNote =
  "協力を止めた直後やアカウントを消した直後でも、すでに送り始めた1回分は外部のAIへ届くことがあります。";

export const privacySections = [
  {
    title: "AIへ送る情報",
    body: "献立の希望や人数など、家族の有無に関わらず共通で送る内容に加え、家族設定を使う場合だけ年齢帯、食べる量、アレルギー、安全上の配慮、苦手な食材を、「家族1」のような仮の番号に置き換えて送ります。家族設定を使わないアイデア献立では、家族に関する情報は一切送りません。",
  },
  {
    title: "AIへ送らない情報",
    body: "家族の呼び名、メールアドレス、内部の会員番号は送りません。",
  },
  {
    title: "アプリに保存する情報",
    body: `家族設定、確認した説明の版、完成した献立と条件を保存します。AIが返したそのままの文章は保存しません。不正利用を防ぐため、アカウント削除後も、メールから作った復元できない識別子と日々の利用回数だけを残すことがあります。本文やアレルギーは残しません。${accountDeletionAnonymousShareNote}${accountDeletionStripeResidualNote}${accountDeletionProviderPromptNote}`,
  },
  {
    title: "有料プランとお支払い",
    body: "有料プラン（こんだて日和 Plus）をご利用の場合、お支払いの処理は Stripe（外部の決済サービス）が行います。カード番号などの支払い情報はアプリには保存しません。契約の有無や無料期間の利用履歴は、不正な繰り返し利用を防ぐため、メールから作った復元できない識別子と結びつけて残ることがあります。",
  },
] as const;

/**
 * 共有任意チェック周辺に必ず含めるフレーズ（設計 §7.1）。
 * UI 本文と RED テストの単一ソース。順序は説明の読み順。
 */
export const shareConsentRequiredPhrases = [
  "条件を満たした完成献立からランダムに選ばれ、どれが選ばれるかは選べません（上限あり）",
  "家族の呼び名・アレルギー設定そのものは共有しません",
  "手順などは一般化してから使います",
  "他の人の画面に誰が作ったかは出ません",
  "あとから設定で止められても、すでに提供済みの献立は他の方の緊急候補に残り続けます",
  "アレルギーの安全は保証しません",
] as const;

/** 初回 /privacy の共有任意カード用コピー。既定オン・推奨トーンなし。 */
export const shareConsentSection = {
  title: "匿名の緊急候補への協力（任意）",
  checkboxLabel: "匿名で緊急候補に役立ててよい",
  /** pre-checked であることの平易な説明（推奨トーンなし） */
  defaultCheckedHint: "最初からチェックが入っています。不要なら外してください。",
  // 必須フレーズを句点でつなぎ、平易な一文の流れにする（推奨トーンなし）
  body: [
    "完成した献立のうち、条件を満たしたものの一部を、匿名の緊急用レシピ候補として他の方にも役立てることがあります。",
    ...shareConsentRequiredPhrases.map((phrase) =>
      phrase.endsWith("。") ? phrase : `${phrase}。`,
    ),
    shareInFlightSendNote,
  ].join(""),
} as const;

/**
 * 設定ページの共有同意トグル・提供管理一覧用コピー。
 * オフ時は「既提供分は残る」を再表示する（設計 §7.2）。
 */
export const shareConsentSettingsCopy = {
  title: "匿名の緊急候補への協力",
  toggleLabel: "匿名で緊急候補に役立てる",
  help: "完成した献立のうち条件を満たしたものの一部を、匿名で他の方の緊急候補に使うことがあります。どれが選ばれるかは選べません。",
  /** トグル off 操作時・オフ状態で必ず見せる残存説明 */
  residualRetentionNotice: `協力を止めても、すでに提供済みの献立は他の方の緊急候補に残り続けます（既提供分は残ります）。${shareInFlightSendNote}`,
  /** AP5: /privacy で共有オフの保存に失敗したとき。成功扱いで進めない。 */
  revokeFailed: "共有の停止を保存できませんでした。時間をおいてもう一度お試しください。",
  sharedListTitle: "提供済みの緊急候補",
  sharedListEmpty: "まだ提供済みの緊急候補はありません。",
  sharedListLoading: "提供済みの一覧を読み込んでいます…",
  sharedListError: "提供済みの一覧を読み込めませんでした。時間をおいてもう一度お試しください。",
  consentLoading: "共有の設定を確認しています…",
  consentError: "共有の設定を読み込めませんでした。再読み込みしてください。",
  saveError: "共有の設定を保存できませんでした。時間をおいてもう一度お試しください。",
} as const;
