/**
 * 好みの学習セクションの文言。react-refresh/only-export-components を避けるため
 * コンポーネントファイルから分離する（share-consent の copy が privacy-copy.ts に
 * あるのと同じ理由）。
 */
export const tasteLearningCopy = {
  title: "好みの学習",
  toggleLabel: "好みの学習",
  body: "★を付けた献立、「この献立にする」で選んだ献立、再生成の理由、入力したメイン食材から傾向を読み取り、次の提案に反映します。",
  sending:
    "献立を作るときに、そこから読み取った料理名と食材名（最長90日・最大50献立）がAIへ送られます。",
  storage: "OFFにすると読み取りをやめます。設定と反映の記録は保存されます。",
  loading: "読み込み中です…",
  loadError: "設定を読み込めませんでした。時間をおいてもう一度お試しください",
  retry: "もう一度読み込む",
  failed: "設定を変更できませんでした。時間をおいてもう一度お試しください",
} as const;
