export const privacySections = [
  {
    title: "AIへ送る情報",
    body: "年齢帯、食べる量、アレルギー、安全上の配慮、苦手な食材、献立の希望を、member_1のような呼び方に置き換えて送ります。",
  },
  {
    title: "AIへ送らない情報",
    body: "家族の呼び名、メールアドレス、家族メンバーのデータベースIDは送りません。",
  },
  {
    title: "アプリに保存する情報",
    body: "家族設定、確認した説明の版、完成した献立と条件を保存します。未検証のAI生回答は保存しません。",
  },
] as const;

export const providerExplanation =
  "OpenRouterを通じて無料モデルへ送信します。混雑時のフォールバックで、実際の無料モデル提供者が変わることがあります。";
