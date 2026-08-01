# 匿名緊急共有レシピ（コミュニティ緊急プール）設計

- 日付: 2026-08-01
- 状態: 設計合意（実装前）
- 互換: **本番 DB リセット前提。後方互換・段階移行は不要**

## 1. 目的

AI で生成・永続化された完成献立の一部を、ユーザー操作なしで匿名の「緊急用共有レシピ」に変換し、他ユーザーの緊急献立候補として再利用できるようにする。

プライバシーを最優先し、提供者の特定・家族情報・安全スナップショットの漏洩を防ぐ。閲覧者の**現在の**安全条件で再検証し、アレルギー等の安全を保証しない（既存方針と同一）。

## 2. 非目標（この版）

- 自分専用の緊急ストック（履歴・お気に入りで足りる）
- 献立ごとの明示的「共有する」ボタン
- 同意オフ時のプール一括削除・個別取り下げ UI
- 「みんなのレシピ」一覧・検索・ランキング・評価・通報
- 人手モデレーションキュー
- 既存本番データ・旧クライアントとの後方互換
- 既存 privacy / 生成 API のデュアルリードや互換パーサの追加（本機能に関して）

## 3. 合意済み要件

| 項目 | 決定 |
| --- | --- |
| 同意 | 初めて献立を作る流れで**任意チェック**（既定オフ）。AI 説明同意とは別 |
| 蓄積 | 完成献立の成功後、**上限内でランダム抽選**し自動で一般化・格納（勝手に貯まる） |
| AI Pass1 | **文章の一般化のみ**（材料・構成は維持） |
| AI Pass2 | 一般化後の**点検＋修正**（問題があれば同構造のまま直す） |
| サーバー関門 | Zod・材料不変・食ルール・簡易 PII。不合格は非掲載 |
| コスト | **アプリ側バジェット** + ユーザー単位日次上限（通常 generate 枠とは分離） |
| 対象メニュー | 履歴に載る**完成献立**（お気に入り必須にしない） |
| 他ユーザー向け UI | **緊急献立候補が主**。提供者名・「共有」バッジは出さない |
| 自分向け UI | 設定の同意トグル + **提供に使われた管理一覧（最小）** |
| 同意オフ後 | **新規の自動共有化のみ停止**。既にプールに入った分は残す |
| 互換 | 本番 DB リセット前提。**後方互換なし**（クリーンマイグレーション・単一版 contract） |

## 4. 既存実装との関係

| 既存 | 扱い |
| --- | --- |
| `privacy_consents` / `/privacy` | 維持。共有同意は**別**フラグ／テーブル |
| `menus` + `is_favorite` | 自分用のまま。共有ストック列は足さない |
| `shared/emergency/fixtures.v1.ts` | **第1ソース**として維持 |
| `filterEmergencyMenus` / `validateGeneratedMenu` | プール候補にも**同一経路**で適用 |
| `GET` 緊急献立（`consumesAiQuota: false`） | 閲覧は従来どおり AI 枠非消費 |
| OpenRouter | Netlify Functions のみ。共有化 Pass1/2 も同様 |
| 所有境界 | `shared/safety` は Functions 側。ブラウザは `safety-pure` / contracts のみ |

実装が正。本設計と実装が食い違う場合は実装後に設計を追随させるか、実装を正として更新する。

## 5. 全体フロー

```text
[初回 AI 献立フロー]
  □ AI 説明を確認した          → 生成に必要（既存）
  □ 匿名で緊急候補に役立ててよい → 任意・既定オフ（新規）

[生成成功・finalize 完了]
  share_consent 有効？
  ユーザー日次上限・アプリ日次バジェット・抽選
       │ 当選
       ▼
  share_job を unique(source_menu_id) で確保（同期を長くしない）
       ▼
  ルール除去（PII・世帯固有フィールド）
       ▼
  Pass1 AI 文章一般化（structured）
       ▼
  Pass2 AI 点検＋修正（structured）
       ▼
  サーバー決定論チェック
       │ 合格
       ▼
  shared_emergency_recipes へ匿名 INSERT（active）

[他ユーザー GET /api/emergency-menus]
  S1 フィクスチャ ∪ S2 プール
  → 閲覧者の現行安全で filter
  → フィクスチャ優先で枠を埋め、空きを S2 で補う
```

生成成功パスは、共有化ジョブの失敗によって**ユーザー向け生成 UX を失敗させない**。

## 6. データモデル（論理）

本番リセット前提のため、既存行のバックフィルや互換カラムは設けない。単一の初期スキーマでよい。

### 6.1 共有同意

`user_share_consents`（名称は実装で調整可）

- `user_id` (PK, FK auth.users, cascade)
- `consent_version` — 文言版（例: `2026-08-01.v1`）。版更新時は再同意
- `accepted_at`
- `revoked_at` nullable — 設定オフ時にセット。オフ後は抽選しない
- 生成に必須ではない

### 6.2 一般化ジョブ（private）

`private.share_generalization_jobs` 等

- `id`
- `source_menu_id` **unique**（二重処理防止）
- `contributor_user_id`
- `status`: `pending` | `running` | `succeeded` | `failed` | `skipped`
- `skip_reason` / `failure_code`（非PIIの短いコードのみ）
- `pass1_model` / `pass2_model`（成功時）
- `created_at` / `finished_at`
- プロンプト本文・生 AI 出力は**永続化しない**

### 6.3 匿名プール

`shared_emergency_recipes`（公開 wire は Function 経由のみ推奨）

- `id` — 候補識別
- `menu_payload` — 検証済み一般化メニュー（`ValidatedMenu` 相当。提供者家庭情報なし）
- `status`: `active` 等
- `created_at`
- メタ（meal_type, main ingredient stems 等）はフィルタ性能用に正規化列でも可

提供者紐づけは **private のみ**:

- `private.shared_emergency_recipe_origins`
  - `recipe_id`
  - `contributor_user_id`（削除時 null 可）
  - `source_menu_id`
- ブラウザが他ユーザーの origin を読めないこと

### 6.4 予算・上限台帳（private）

既存 AI / identity 台帳パターンに寄せる。

- ユーザー日次: 共有化**試行**上限・**掲載成功**上限
- アプリ日次: 共有化 AI 成功掲載キャップ、および AI 呼び出し回数の監視（Pass1+Pass2）

通常の献立生成クォータ（freemium / Plus）とは**分離**。

## 7. 同意 UI

### 7.1 初回

AI 説明確認と同じ「初めて AI 献立を作る流れ」に dual チェックを置く。

| チェック | 必須 | 既定 | 効果 |
| --- | --- | --- | --- |
| 説明を確認しました（既存） | AI 生成に必須 | オフ | privacy consent |
| 完成した献立の一部を、匿名化したうえで他の方の緊急献立の参考にしてよい | 任意 | **オフ** | share consent |

文言に含めること:

- どの献立が選ばれるかは選べない（ランダム・上限あり）
- 家族の呼び名・アレルギー設定そのものは共有しない
- 手順等は一般化してから使う
- 他の人の画面に誰が作ったかは出ない
- あとから設定で止められるが、**すでに出した分は残る**
- アレルギーの安全は保証しない

### 7.2 設定

- 「匿名の緊急献立への提供」トグル
- オフ → `revoked_at` セット → 以降 job を作らない。既存 active は残す
- オン → 現行 `consent_version` で再同意

### 7.3 管理一覧（最小）

- 本人が提供元になった active の、一般化後タイトルと日時
- RPC 経由のみ。他者の提供者情報は返さない
- 個別取り下げはこの版のスコープ外

## 8. 抽選と上限（初期仮置き・定数化）

サーバー側のみで決定。クライアント抽選は不可。

| パラメータ | 初期案 | 意味 |
| --- | --- | --- |
| `SHARE_LOTTERY_PERCENT` | 20 | 前提達成の成功生成のうち一般化キューへ載せる割合 |
| `SHARE_PER_USER_DAILY_SUCCESS_CAP` | 1 | 1 ユーザー 1 日あたり**プール掲載成功**上限 |
| `SHARE_PER_USER_DAILY_ATTEMPT_CAP` | 2 | 当選〜 AI 試行の上限 |
| `SHARE_APP_DAILY_AI_SUCCESS_CAP` | 契約化（例 500） | アプリ全体の掲載成功/日 |
| AI 呼び出し | 当選 1 件あたり最大 2 回（Pass1+Pass2） | バジェットは呼び出し数でも監視 |

前提（すべて）:

1. 共有同意が有効（現行版・未 revoke）
2. ユーザー日次上限未達
3. アプリ日次バジェット未達
4. 当該 `source_menu_id` 未処理
5. finalize 済みの完成メニュー

トリガー: 生成成功の永続化直後。job 行確保は短く、AI は非同期（既存 Netlify パターンに合わせて実装計画で確定）。

再生成で新しい menu ができた場合は**新しい id** が抽選対象。親の再抽選はしない。

## 9. AI パイプライン

### 9.1 ルール除去（AI 前・必須）

AI およびプールに渡さない / 残さない例:

- 家族表示名、メール、内部ユーザー id の露出
- `preference_snapshot` / `safety_snapshot` / safety_fingerprint の提供者固有値
- member 向け `adaptations`、個人紐づけの labelConfirmation
- `pantrySelectionId` および冷蔵庫固有名に依存する表現の構造的除去
- 自由記述の苦手・カスタム条件

### 9.2 Pass1 — 文章一般化

- 入力: 除去済み構造
- 出力: 同一スキーマの structured outputs
- **材料名・数量・ dish 構成は入力を正**とし、モデルが変えてもサーバーが入力で上書きマージしてよい
- 対象自由文: dish name/description、recipe steps、timeline instruction 等（実装で一覧固定）

### 9.3 Pass2 — 点検＋修正

Pass1 結果をレビューし、問題があれば同構造のまま修正する。観点:

1. プライバシー残渣（人名、家族呼び、固有の「うちの残り」等）
2. 共有向きの一般性
3. 手順と材料の整合（一般化による矛盾・欠落）
4. 「アレルギーでも安心」等の保証表現の削除・言い換え
5. 材料・構成は触らせない（サーバーが再固定）

### 9.4 サーバー関門

- Zod（validated menu 相当）
- 材料・構成の不変条件
- 既存食ルール／検証の適用可能な範囲
- 簡易 PII・保証表現のパターン拒否
- 不合格 → 非掲載（Pass1 のみの中途公開はしない）

生プロンプト・生完了テキストは保存・ログしない。失敗コードのみ。

## 10. 緊急献立への載せ方

### 10.1 ソース

| ソース | 内容 | 優先 |
| --- | --- | --- |
| S1 | レビュー済みフィクスチャ | 優先して枠を埋める |
| S2 | 共有プール active | 空き枠を補完 |

### 10.2 安全

- 提供者の当時安全は**無効**
- 配信時に閲覧者 `CurrentSafetyContext` で既存と同様に検証・フィルタ
- household 経路では既存フィクスチャ同様のメンバー remap が可能な形のみ。不能なら落とす
- 安全保証コピーは出さない
- 現行世帯制約が常に優先

### 10.3 表示

- 提供者・「コミュニティ」バッジはユーザー向けに出さない
- 運用ログに `source: fixture | community` を非PIIで残すのは可

### 10.4 障害

- S2 読取失敗時は S1 のみで 200 継続（全体 500 にしない）
- 共有化 job 失敗はユーザー通知しない

## 11. RLS・API 境界

- プールの全件 list を authenticated に直接許可しない。緊急 Function / 限定 RPC のみ
- origin（contributor）は private。管理一覧 RPC は `auth.uid()` の提供分のみ
- OpenRouter キー・共有化処理は Netlify Functions のみ
- `shared/contracts` / `shared/emergency` に wire と版定数
- ブラウザは `@shared/safety/*` を import しない（既存境界）

### アカウント削除

- 同意・job・origin の本人参照を削除または unlink
- プール本文は残し、`contributor_user_id` を null 化（方針 B: 既掲載を急に消さない + 提供者は消える）

## 12. 後方互換・リリース前提

- **本番 DB はリセットする前提**。本機能のための旧データ移行・デュアルスキーマ・旧 consent 版の並行受理は行わない
- テストユーザーが既にいる環境も、リセット後のクリーン状態を正とする
- contract / consent_version / fixture との合成は**単一の現行版**のみ
- 既存の AI privacy `privacyNoticeVersion` 運用は維持するが、共有同意は別 version を持ち、リセット後の初回からその版だけを使う

## 13. エラー表（要約）

| 状況 | UX | システム |
| --- | --- | --- |
| 同意オフ | 変化なし | 抽選なし |
| 抽選外れ・上限 | 変化なし | skip |
| Pass1/2/サーバー失敗 | 通知なし | failed・非掲載 |
| S2 障害 | フィクスチャのみ | 非PII ログ |
| 同意トグル保存失敗 | 設定でエラー | 旧状態維持 |
| job 投入失敗 | 生成は成功のまま | 再試行方針は実装計画で |

## 14. テスト観点

- 同意既定オフ、オフでも生成可、revoke 後は新規 job なし・既存プール残存
- 抽選のサーバー決定、menu 二重処理なし
- 除去後に PII・snapshot・adaptation が AI 入力・payload に無い
- Pass1/2 後も材料構成が入力と一致
- 保証表現・PII 残渣でサーバー不合格
- 緊急: フィクスチャ優先、S2 同一 filter、contributor 非露出
- RLS: 直読不可、管理一覧は本人のみ
- 削除: origin unlink、本文残存
- 共有化 AI が通常 generate 枠を消費しない
- DB リセット後の単一版のみ（互換パーサ不要であることのテストは「旧版を reject」で足りる）

## 15. 実装時の主な変更領域（指針）

1. migrations: consent / private jobs / pool / origins / 台帳
2. contracts: share consent version、job/pool 型、上限定数
3. privacy / settings UI: 共有チェック・トグル・管理一覧
4. finalize 成功フック → job enqueue
5. Function: Pass1/2 OpenRouter、ワーカーまたは invoker
6. `emergency-menus` Function: S2 読込 + 既存 filter
7. テスト: unit / function / pgTAP RLS / 必要なら e2e の同意トグル

正確な Task 分割は実装計画（writing-plans）で行う。

## 16. 未決（実装計画で固定してよい数値・手段）

- `SHARE_APP_DAILY_AI_SUCCESS_CAP` の本番値
- job 実行の具体手段（バックグラウンド Function / キュー / finalize 後 invoker）
- 管理一覧の画面パス（設定内セクションで可）
- フィルタ用正規化列の有無

プロダクト方針に関する分岐は本設計で閉じている。
