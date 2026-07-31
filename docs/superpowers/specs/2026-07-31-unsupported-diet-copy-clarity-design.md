# 対象外食事（unsupported diet）表示文言の明確化

**日付**: 2026-07-31  
**ステータス**: 承認待ち（ブレインストーミング合意済み）  
**種別**: 表示文言のみ（スキーマ・生成拒否ロジックは不変）

## 1. 背景と問題

家族メンバーの追加・編集で「食べない食事はありますか」を「該当あり」にすると、次の3項目が出る。

- 離乳食
- 飲み込み・むせの不安
- 医師等から指示された治療食

利用者から見て意味が取りにくい。

| 表示 | 誤解されやすい点 |
|---|---|
| 離乳食 | 「食べない食事」の選択肢に見える。実際は「離乳食が必要な段階」 |
| 飲み込み・むせの不安 | 何を選ぶ項目か曖昧。実際は「飲み込み・むせに不安がある」事情 |
| 医師等から指示された治療食 | 指示内容を書く場所がない。実際は詳細入力の対象ではなく、このアプリでは作れないことの申告 |

### 原因

設計上の概念は **「このアプリが通常献立として対応できない食事の事情」**（`unsupported_diet_*`）である。

- 設計書 `2026-07-11-kondate-mvp-design.md` §6: 対象外確認状態・対象外種別。該当ありのメンバーは通常生成の対象にしない
- UI refresh（`2026-07-21-ui-refresh-design.md`）で親質問を「対象外の食事の確認」→「食べない食事はありますか」へ平易化した結果、親質問と選択肢の意味軸がずれた

治療食の指示内容を保存・生成に使う機能は **意図的に存在しない**（MVP スコープ外: 離乳食・嚥下調整・治療食は生成しない）。

## 2. 目標

1. 親質問・選択肢・説明文が同じ意味軸（「このアプリで作れない事情」）で揃う
2. 3選択肢が「食べない料理」ではなく「事情・必要」として読める
3. 治療食について「指示を書く欄がない」理由が画面上で分かる
4. データ構造・生成拒否・検出ロジックは変えない

## 3. 非目標

- `unsupported_diet_status` / `unsupported_diet_kinds` の enum・DB・RLS 変更
- 治療食・離乳食・嚥下向けの献立生成や、指示内容の自由記述フィールド追加
- `medical-scope` 検出語・`unsupported_diet` 生成エラーコードのキー変更
- 「苦手食材」など別機能の文言変更
- planner / 生成結果の拒否コピー（`離乳食、飲み込み・嚥下、治療食の依頼には対応できません` 等）の全面改訂  
  - 本変更は **家族設定・オンボーディング入力面** に限定する  
  - 生成面の拒否文言は意味が通るため据え置き（必要なら別チケット）

## 4. 確定文言（Approach A）

| 箇所 | 現行 | 変更後 |
|---|---|---|
| 親質問（label / aria-label） | 食べない食事はありますか | このアプリで作れない食事の事情はありますか |
| 親の選択肢 | 該当なし / 該当あり / 未確認 | **据え置き** |
| fieldset 見出し（legend） | 該当する項目 / 食べない食事 | 該当する事情 |
| `weaning_food` | 離乳食 | 離乳食が必要 |
| `swallowing_concern` | 飲み込み・むせの不安 | 飲み込み・むせに不安がある |
| `therapeutic_diet` | 医師等から指示された治療食 | 医師等から治療食の指示がある |
| present 時の説明文 | 通常の献立では対応できません。対象メンバーから外すか、専門職の指示に従ってください。（onboarding のみ） | 選んだ場合、通常の献立では対応できません。対象メンバーから外すか、専門職の指示に従ってください。治療食の指示内容はここでは入力できません（このアプリでは作れないためです）。 |
| 未確認時メッセージ | 食べない食事を確認するまで、このメンバーは献立生成に使えません。 | 食事の事情を確認するまで、このメンバーは献立生成に使えません。 |
| バリデーション（status 未選択） | 食べない食事があるか選んでください | 食事の事情があるか選んでください |
| kinds 空 | 該当する項目を選んでください | 該当する事情を選んでください |
| オンボーディング導入文 | 年齢のめやす、アレルギー、食べない食事の3項目から始めます。 | 年齢のめやす、アレルギー、食事の事情の3項目から始めます。 |
| superRefine 矛盾メッセージ | 対象外状態と項目を確認してください | **据え置き**（内部整合用。通常 UI では出しにくい） |

status の `none` / `present` / `unconfirmed` の表示語は変更しない。

## 5. 挙動（不変）

- `none`: そのメンバーは通常生成の対象になり得る（他条件を満たす場合）
- `present` + 1 つ以上の kind: そのメンバーは通常生成の対象外。専門職の指示に従う案内
- `unconfirmed`: 確認するまでそのメンバーを含む AI 献立を生成しない
- kind の選択は「事情の申告」であり、献立内容への細かい調整指示ではない

## 6. 実装方針

### 6.1 表示ラベルの単一ソース

現状、kind ラベルが次に二重定義されている。

- `src/features/household/household-onboarding-page.tsx` の `unsupportedDietOptions`
- `src/features/household/household-settings-page.tsx` の `unsupportedDietKindLabels`

**同じディレクトリ内の共有定数**（例: `unsupported-diet-copy.ts`）に寄せ、親質問・説明文・バリデーション用短文も含めて export する。ブラウザ境界（`src/features`）内に閉じ、`shared/` や Netlify Functions へは出さない（サーバは日本語ラベルを必要としない）。

### 6.2 変更対象ファイル（想定）

| 種別 | パス |
|---|---|
| 新規 | `src/features/household/unsupported-diet-copy.ts`（名称は実装時に既存命名へ合わせ可） |
| 本番 UI | `household-onboarding-page.tsx`, `household-settings-page.tsx` |
| スキーマ | `household-settings-schema.ts`（status 未選択・kinds 空メッセージ） |
| 単体テスト | `household-onboarding-page.test.tsx`, `household-settings-page.test.tsx`、schema テストがあれば追随 |
| E2E | `e2e/fixtures/auth.ts`, `e2e/specs/onboarding.spec.ts`, `e2e/specs/settings.spec.ts`, `e2e/specs/menu-domain-pantry.spec.ts` |

settings の present 時 fieldset には、現状 legend のみで説明文がない。**onboarding と同じ説明文を追加**する。

### 6.3 変更しないもの

- `shared/contracts/domain.ts` の `unsupportedDietKinds` 英語キー
- `shared/safety/medical-scope.ts` の検出パターン
- 生成エラーコード `unsupported_diet` / `unsupported_diet_unconfirmed` のキー
- DB マイグレーション・generated types

## 7. テスト方針

1. **単体**: 新 label / checkbox name / 説明文テキストで要素を引くアサーションへ更新。旧文言での `getByLabelText` / `getByRole` が残っていないことを確認
2. **schema**: バリデーションメッセージ文字列を参照するテストがあれば追随
3. **E2E**: `getByLabel("…")` の文字列を新親質問へ更新。fixture は共通化されているため漏れに注意
4. **回帰しないこと**: kind の保存値が引き続き `weaning_food` 等であること（表示だけ変わる）を既存 save アサーションで担保

検証コマンド（Docker、スコープ実行）:

```bash
docker compose run --rm --no-deps app npx vitest run src/features/household/
docker compose run --rm --no-deps app npm run typecheck
docker compose run --rm --no-deps app npm run lint
docker compose run --rm --no-deps app npm run format:check
```

E2E は実装計画の該当 Task で `e2e/fixtures/auth.ts` を含む経路を実行する。

## 8. リスクと緩和

| リスク | 緩和 |
|---|---|
| 親質問が長く 320px で折り返し・タップ領域が崩れる | 既存 field スタイルで折り返し確認。label と select は縦積みのまま |
| E2E / 単体の文言ハードコード漏れ | 実装後に旧文言（`食べない食事はありますか` 等）を repo 検索し、入力面の残存ゼロを確認 |
| UI refresh 設計書との文言差分 | 本設計が入力面の最新権威。UI refresh 表は歴史記録として残し、矛盾時は本設計を正とする |

## 9. 成功条件

- 「該当あり」時の3項目が、離乳食・飲み込み不安・治療食指示の**事情**として読める
- 治療食について、指示を書く欄がない理由が説明文で分かる
- enum キー・DB・生成拒否は変更前後で同一
- 対象単体テストと E2E セレクタが新文言で通る

## 10. 関連ドキュメント

- `docs/superpowers/specs/2026-07-11-kondate-mvp-design.md` §6（対象外確認）
- `docs/superpowers/specs/2026-07-21-ui-refresh-design.md`（「食べない食事はありますか」への改名）
- 実装計画: 本設計承認後に `writing-plans` で作成
