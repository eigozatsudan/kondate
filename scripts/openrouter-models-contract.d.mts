/** 共有契約テーブルの型宣言（実装は openrouter-models-contract.mjs） */
export declare const modelListRules: string;

/** 後方互換の別名（free 必須ではない） */
export declare const freeModelListRules: string;

export declare const acceptedModelLists: readonly {
  readonly raw: string;
  readonly models: readonly string[];
  readonly baseUrl: string;
}[];

/** 後方互換の別名（free 必須ではない） */
export declare const acceptedFreeModelLists: typeof acceptedModelLists;

export declare const rejectedModelLists: readonly {
  readonly raw: string;
  readonly baseUrl: string;
}[];

/** 後方互換の別名（free 必須ではない） */
export declare const rejectedFreeModelLists: typeof rejectedModelLists;
