# 匿名緊急共有レシピ（コミュニティ緊急プール）設計

- 日付: 2026-08-01
- 状態: 設計合意（1次・2次・敵対的レビュー反映後）
- 互換: **本番 DB リセット前提。後方互換・段階移行は不要**
- レビュー: 2026-08-01 一次 / 二次 / 敵対的 → 擬陽性除外のうえ本文修正

## 1. 目的

AI で生成・永続化された完成献立のうち、**緊急献立として構造的に通し得るもの**の一部を、ユーザー操作なしで匿名の「緊急用共有レシピ」に変換し、他ユーザーの緊急献立候補として再利用できるようにする。

プライバシーを最優先し、提供者の特定・家族情報・安全スナップショットの漏洩を防ぐ。閲覧者の**現在の**安全条件で再検証し、アレルギー等の安全を保証しない（既存方針と同一）。

## 2. 非目標（この版）

- 自分専用の緊急ストック（履歴・お気に入りで足りる）
- 献立ごとの明示的「共有する」ボタン
- 同意オフ時のプール一括削除・個別取り下げ UI
- 「みんなのレシピ」一覧・検索・ランキング・評価・通報
- 人手モデレーションキュー（**運用者による status 無効化は可** — §11.3）
- 既存本番データ・旧クライアントとの後方互換
- 既存 privacy / 生成 API のデュアルリードや互換パーサの追加（本機能に関して）
- 共有化 AI をユーザー向け generate Function の同期寿命に乗せること（**禁止**）

## 3. 合意済み要件

| 項目 | 決定 |
| --- | --- |
| 同意 | 初めて献立を作る流れで**任意チェック**（既定オフ）。AI 説明同意とは別 |
| 蓄積 | 完成献立の成功後、**適格ゲート + 上限内ランダム抽選**で自動一般化・格納 |
| AI Pass1 | 指定自由文の一般化（材料**グラフ**は維持。名前文字列は §9.1 のルールを優先） |
| AI Pass2 | 一般化後の点検＋修正 |
| サーバー関門 | Zod・グラフ不変・食ルール・PII/有害パターン。不合格は非掲載 |
| コスト | **アプリ側共有化バジェット** + ユーザー単位日次上限。通常 generate 枠と分離 |
| 対象 | finalize 済み完成献立のうち **緊急適格**（§8.1）を通過したもの |
| 他ユーザー向け UI | **緊急献立候補が主**。提供者名・共有バッジは出さない |
| 自分向け UI | 設定の同意トグル + 提供管理一覧（最小） |
| 同意オフ後 | **新規の自動共有化のみ停止**。既掲載は残す。**in-flight は掲載前に再確認して止める** |
| 互換 | 本番 DB リセット前提。**後方互換なし** |

### 3.1 DB リセットが免除するもの / しないもの

| 免除する | 免除しない |
| --- | --- |
| 旧データの移行・バックフィル | RLS + grants + private 分離 |
| 旧クライアント・旧 consent 版の並行受理 | `consent_version` / contract の単一現行版 |
| デュアルスキーマ | 安全境界（browser は `safety-pure` のみ） |
| | 非PII ログ、アカウント削除インベントリ、pgTAP |

## 4. 既存実装との関係

| 既存 | 扱い |
| --- | --- |
| `privacy_consents` / `/privacy` | 維持。共有同意は**別**テーブル |
| `menus` + `is_favorite` | 自分用のまま |
| `shared/emergency/fixtures.v1.ts` | **第1ソース（S1）** |
| `filterEmergencyMenus` | **多ソース化**（§10）。S2 も同一 Stage S 経路 |
| `validateGeneratedMenu` / `emergencyGenerationContext` | 配信時必須。`timeLimitMinutes: 15` 固定は変えない |
| `remapFixtureForMembers` | S2 にも**同等の配信時 remap**を適用（§9.5） |
| 緊急 GET `consumesAiQuota: false` | 維持 |
| OpenRouter | Functions のみ。共有化は **generate 同期パス外** の worker |
| 所有境界 | 変更なし |

実装が正。本設計と実装が食い違う場合は実装後に設計を追随させるか、実装を正として更新する。

## 5. 全体フロー

```text
[初回 AI 献立フロー — /privacy]
  □ AI 説明を確認した（必須・既存）
  □ 匿名で緊急候補に役立ててよい（任意・既定オフ・新規）
  CTA「確認して進む」: privacy 必須のみ。share は任意

[生成成功・finalize 完了]
  → enqueue RPC（原子的）:
       consent 有効？ / 緊急適格ゲート？ / 日次上限？ / 抽選？
       → yes: attempt 予約 + job pending INSERT (unique source_menu_id)
  ※ ユーザー向け生成応答を待たせない・失敗させない

[share worker — 独立 Function / schedule]
  claim pending→running
  ルール除去・食材名の決定論処理（§9.1）
  カノニカル形構築（テンプレ adaptations 等）不能 → skipped
  Pass1 AI → Pass2 AI
  サーバー関門
  プール INSERT 直前: consent 再確認（revoke なら skipped・非掲載）
  成功: pool active + origin + success 台帳

[GET /api/emergency-menus]
  S1 を Stage S → 最大 EMERGENCY_MAX_CANDIDATES まで採用
  空き枠だけ S2 を bound fetch → 配信時合成 → 同一 Stage S
  S1 を常に S2 より優先（優先帯内での pantry ソートは既存踏襲可）
```

## 6. データモデル

本番リセット前提。単一初期スキーマ。

### 6.1 共有同意 — `public.user_share_consents`

- `user_id` uuid PK → `auth.users` **ON DELETE CASCADE**
- `consent_version` text not null（例: `2026-08-01.v1`）
- `accepted_at` timestamptz not null
- `revoked_at` timestamptz null
- RLS: 本人のみ SELECT/INSERT/UPDATE
- 生成 API の必須条件に**しない**

有効の定義: `consent_version = 現行版` かつ `revoked_at IS NULL`。

### 6.2 ジョブ — `private.share_generalization_jobs`

- `id` uuid PK
- `source_menu_id` uuid **unique**（`menus` への FK は **ON DELETE SET NULL** 可。列名は `source_menu_id` であり account-deletion の `user_id` CASCADE ガード対象外）
- `contributor_user_id` uuid null（**ON DELETE SET NULL**。列名を `user_id` にしない）
- `status`: `pending` | `running` | `succeeded` | `failed` | `skipped`
- `skip_reason` / `failure_code` — 非PII の短い enum コードのみ
- `pass1_model` / `pass2_model` text null
- `claimed_at` / `heartbeat_at` timestamptz null（lease）
- `created_at` / `finished_at`
- プロンプト・生 AI 出力は永続化しない
- public / authenticated へ **grant しない**

**stuck reaper:** `running` かつ `heartbeat_at`（または `claimed_at`）が閾値超過 → `failed`（`failure_code=lease_expired`）。v1 は **同一 source_menu の自動リトライなし**（terminal failed で再抽選不可）。reaper のみ必須。

### 6.3 プール — `private.shared_emergency_recipes`（推奨: private）

PostgREST 直読を避けるため **private schema** を推奨。Function は service_role または security definer 経由。

- `id` uuid PK（**新規採番**。source menu id と一致させない）
- `menu_payload` jsonb not null — 緊急カノニカル `ValidatedMenu`（§9.5）。payload 内の `menuId` / dish / step / ingredient id も**すべて新規 UUID**
- `meal_type` text not null
- `total_elapsed_minutes` smallint not null
- `status`: `active` | `disabled`（運用者 kill switch）
- `standard_allergen_ids` text[] not null default `{}` — 掲載時にカタログ由来で確定（Stage S 前メタ）
- `eligible_age_bands` text[] not null — 掲載時に保守的に確定。安易に「全年齢」にしない
- `created_at` timestamptz not null
- プール行に `user_id` / `contributor_user_id` を**持たない**

### 6.4 origin — `private.shared_emergency_recipe_origins`

- `recipe_id` uuid PK/FK → pool
- `contributor_user_id` uuid null **ON DELETE SET NULL**（列名 `user_id` 禁止）
- `source_menu_id` uuid null **ON DELETE SET NULL**
- public 非公開

### 6.5 台帳 — private

既存 AI / identity 日次台帳パターンに寄せる。

| 台帳 | 内容 |
| --- | --- |
| ユーザー日次 | attempt 予約数、success（掲載）数 |
| アプリ日次 | success 掲載数、**AI 呼び出し回数**（Pass1/2 各 1） |

通常 generate の freemium/Plus 枠・`reserve_ai_generation` とは**分離**。  
共有化 AI が既存 `GLOBAL_DAILY_AI_LIMIT` を共有するかは **共有しない（完全独立）** とし、運用アラートは共有化台帳側で行う（設計固定）。

### 6.6 enqueue の原子性

単一 RPC（例: `private.try_enqueue_share_job(p_menu_id)`）内で:

1. finalize 済み・所有者確認
2. 緊急適格ゲート（§8.1）
3. consent 有効
4. ユーザー attempt/success 上限
5. アプリ success / AI call 上限（予約可能な範囲）
6. 抽選
7. `source_menu_id` unique で job INSERT
8. attempt 台帳 +1（予約）

いずれか失敗 → job なし・生成 UX 非影響。  
**success 台帳 + AI call 確定**は worker が Pass 完了／掲載時に行う（失敗時: attempt は消費のまま、AI call は実際に呼んだ分だけ計上）。

## 7. 同意 UI

### 7.1 画面固定: `/privacy` を拡張

| 要素 | 必須 | 既定 | CTA 条件 |
| --- | --- | --- | --- |
| 「説明を確認しました」（既存） | AI 生成に必須 | オフ | primary に必要 |
| 共有任意チェック（新規） | 任意 | **オフ** | primary に不要 |
| 「確認して進む」 | — | — | privacy チェックのみで enable |
| 「今はAIを使わない」/ 緊急導線 | — | — | 共有同意を付けない（既存） |

共有ブロックは必須 AI 同意と**視覚的に分離**（別カードまたは secondary）。推奨トーンや既定オンにしない。

共有チェック文言に必ず含める:

- どの献立が選ばれるかは選べない（条件を満たした完成献立からランダム・上限あり）
- 家族の呼び名・アレルギー設定そのものは共有しない
- 手順等は一般化してから使う
- 他の人の画面に誰が作ったかは出ない
- あとから設定で止められるが、**すでに提供済みの献立は他の方の緊急候補に残り続ける**
- アレルギーの安全は保証しない

### 7.2 設定トグル

- オフ → `revoked_at = now()`。以降 enqueue なし。**running/pending は worker が INSERT 前に再確認して skipped**
- オン → 現行 `consent_version` で再同意（`revoked_at` null、`accepted_at` 更新）
- オフ操作時にも「既提供分は残る」を再表示

### 7.3 管理一覧

- 設定内セクション（パスは settings 内で可）
- RPC: `security definer`、`contributor_user_id = auth.uid()` のみ
- 返す: 一般化後タイトル（主菜名または dish 名の連結規則を実装で固定）、**日付（時刻なし）**、件数上限・ページング
- **返さない:** `source_menu_id`、contributor 以外の id 相関に使える raw pool id（不要なら出さない）、提供者以外のデータ
- 個別取り下げ UI はこの版のスコープ外

### 7.4 privacy-copy / 削除説明の更新（必須）

既存「アカウント削除後も…本文やアレルギーは残しません」と方針 B が矛盾するため、ユーザー向けに追記する:

- 匿名一般化済みの緊急候補本文は、削除後も他ユーザー向けに**残ることがある**
- 誰が作ったかの対応づけは残さない

## 8. 抽選・適格・上限

### 8.1 緊急適格ゲート（AI 前・必須・決定論）

抽選・job 作成の**前**にすべて満たすこと。不能は AI を呼ばず終了（attempt も消費しない / job も作らない）。

1. finalize 済み完成メニュー
2. `totalElapsedMinutes ≤ 15`
3. mealType 別の最低 dish 構成（既存 `minDishCountForMealType` および緊急 Stage S が要求する role 制約を満たす見込み）
4. steps / timeline が空でない
5. **pantry 紐づけ材料を含まない**（いずれかの ingredient に `pantrySelectionId != null`、または generation 時 pantry usage が非空 → 不適格）。理由: 材料名ロックと固有名漏洩の両立が困難なため v1 は **skip**
6. カノニカル形（§9.5）を決定論で構築可能
7. idea / household いずれも、上記を満たせば可（idea も可）

### 8.2 抽選パラメータ（初期・定数化）

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| `SHARE_LOTTERY_PERCENT` | 20 | 適格成功のうち job 化する割合 |
| `SHARE_PER_USER_DAILY_SUCCESS_CAP` | 1 | 掲載成功/ユーザー/日 |
| `SHARE_PER_USER_DAILY_ATTEMPT_CAP` | 2 | job 化（attempt）/ユーザー/日 |
| `SHARE_APP_DAILY_AI_SUCCESS_CAP` | 200 | アプリ掲載成功/日（仮。env 化） |
| `SHARE_APP_DAILY_AI_CALL_CAP` | 500 | Pass 呼び出し回数/日（失敗含む） |
| `SHARE_JOB_LEASE_MINUTES` | 15 | running の reaper 閾値 |
| `EMERGENCY_MAX_CANDIDATES` | 5 | 緊急レスポンスの候補上限 |
| `SHARE_POOL_FETCH_LIMIT` | 20 | S2 を Stage S に載せる前の DB 取得上限（meal_type 一致・active のみ） |

抽選はサーバーのみ。finalize 応答に当選事実を載せない。

### 8.3 対象の再生成

新しい `menus` 行が finalize されたときのみ。同一 menu の再 enqueue なし（unique）。

## 9. AI パイプラインと緊急カノニカル形

### 9.1 ルール除去・材料名（AI 前）

**除去・null 固定:**

- 家族表示名、メール、内部 user id の露出
- `preference_snapshot` / `safety_snapshot` / 提供者 `safety_fingerprint`
- 提供者由来の `labelConfirmations`（配信時に閲覧者側で再計算）
- `pantrySelectionId`（適格ゲートで pantry 献立は既に除外）
- 自由記述の苦手・カスタム条件・memo 由来の文

**材料グラフの不変（ids 再採番後も構造維持）:**

- dish 数・role・position、ingredient の quantity/unit/storeSection の対応関係
- **ingredient / dish の `name` 文字列は「ユーザー・pantry 由来の固有名を残すため」にはロックしない**  
  - v1 は pantry 献立を適格外にすることで主リスクを避ける  
  - それでも残る人名パターンは Pass2 + サーバー関門で fail-closed

### 9.2 Pass1 — 文章一般化

- 対象自由文: dish `description`、recipe `steps.instruction`、timeline `instruction`、adaptation 自由文（テンプレ構築後）、dish `name` のうち一般化が必要なもの
- structured outputs のみ
- グラフ（数量・構成）はサーバーが入力で再固定

### 9.3 Pass2 — 点検＋修正

1. プライバシー残渣（人名、家族呼び、「うちの残り」等）— **ingredient name を含む全 `collectMenuTextSources` 相当**
2. 共有向きの一般性
3. 手順と材料の整合
4. 安全保証表現の削除
5. 材料グラフは触らせない

### 9.4 サーバー関門（fail-closed）

- Zod（validated menu）
- グラフ不変
- 日本語の保証表現・PII っぽいパターンの拒否（版付きリスト・テスト必須）
- 非食品・明らかに有害な指示の denylist（失敗コードのみログ）
- 不合格 → 非掲載（Pass1 のみ公開禁止）

### 9.5 緊急カノニカル形（プール保存形）— **Critical 解消**

プールに保存する `menu_payload` は次を満たす:

1. **新規 UUID** のみ（source の menu/dish/ingredient/step id を再利用しない）
2. `pantryUsage` / ingredient `pantrySelectionId` = 空/null
3. `labelConfirmations` = 空（配信時の validate が閲覧者向けに扱う）
4. **テンプレ `adaptations` を必ず持つ** — 最低 `member_1` 起点のレビュー可能な形  
   - 提供者世帯の人数・表示名・個人 portion 文言は載せない  
   - 自由文は一般化済みの中立表現  
   - ingredient-bound の `safetyActions` は、決定論でバインドできるものだけ残す。**バインド不能ならその献立は skipped（非掲載）** — under-six 向けに空 adaptation で「通したように見せる」ことは禁止
5. `totalElapsedMinutes ≤ 15`、mealType と dish roles が緊急検証前提を満たす
6. 掲載時メタ: `standard_allergen_ids`（材料テキストからカタログ照合で保守的に付与）、`eligible_age_bands`（テンプレが安全にカバーできる帯のみ。不明なら狭くする）

**配信時（GET 緊急）:**

1. active かつ meal_type 一致の S2 を `SHARE_POOL_FETCH_LIMIT` まで取得（順序: `hash(stable_salt, recipe_id)` 等で**グローバル newest のみに依存しない**）
2. 各 payload に `remapFixtureForMembers` **相当**で閲覧者メンバー数へ adaptation 展開
3. 既存と同じ `emergencyGenerationContext` + `validateGeneratedMenu`（Stage S）
4. metadata ゲート（eligibleAgeBands / standardAllergenIds）を S1 と同様に適用
5. 個別検証失敗は捨てて継続。S2 全体障害・期限超過は S1 のみで 200

under-six / `requiredSafetyConstraints` がある閲覧者: 合成後に Stage S を通らない候補は出さない（**空 adaptation での通過禁止**）。

## 10. 緊急献立への載せ方

### 10.1 定数と優先

| 定数 | 初期 | 意味 |
| --- | --- | --- |
| `EMERGENCY_MAX_CANDIDATES` | 5 | 返却候補の最大件数 |
| `SHARE_POOL_FETCH_LIMIT` | 20 | S2 検証前ロード上限 |

手順:

1. S1（フィクスチャ）を現行どおり Stage S
2. 通過分を優先キューに載せ、最大 N まで採用
3. 空き `N - |S1_pass|` があるときだけ S2 を bound fetch → 合成 → Stage S
4. S2 通過分で空きを埋める
5. **優先帯:** すべての S1 採用分が、S2 より前（または同等ソートでも S1 を上位キーにする）

### 10.2 filter の多ソース化

- `filterEmergencyMenus` を「内部で fixture 直読のみ」から、**候補配列を受け取れる純粋コア** + Function 側マージに分割する（実装）
- 入力候補: `{ menu, metadata: { eligibleAgeBands, standardAllergenIds }, source: "fixture" | "community" }[]`
- 出力: 現行 `EmergencyFilterResult` 形を維持
- `emptyReason: "no_matching_fixture"` は **歴史的名称として維持**し、意味は「S1∪S2 の後も安全通過ゼロ」（リセット前提でも wire 変更コストを抑える）。コメントと設計で明示
- `fixtureVersion` は S1 の版を返す。community のみのときもフィールドは維持（値は S1 版）。必要なら後続で `catalogVersion` を足す（この版の必須ではない）

### 10.3 安全・表示・障害

- 提供者の当時安全は無効
- 安全保証コピーなし
- ユーザー向けに source バッジなし
- ログ: `sourceCounts: { fixture, community }` の非PII 集計可。contributor id 禁止
- S2 読取/検証の部分失敗で全体 500 にしない

### 10.4 自分の提供分の除外

v1 では **除外しない**（プロダクト好み。必須ではない）。wire に contributor を出さないことだけ守る。

## 11. RLS・API・削除

### 11.1 権限マトリクス（必須）

| オブジェクト | anon/authenticated 直 | 許可 |
| --- | --- | --- |
| `user_share_consents` | 本人 RLS | 本人 CRUD 相当 |
| `private.share_generalization_jobs` | 不可 | service_role / definer |
| `private.shared_emergency_recipes` | 不可 | service_role / definer（緊急 Function） |
| `private.shared_emergency_recipe_origins` | 不可 | service_role / definer（管理 RPC は本人分のみ） |
| 台帳 | 不可 | private RPC |

管理 RPC: `security definer` + `auth.uid()` 固定。`p_user_id` 引数で他人を指定不可。

### 11.2 アカウント削除

- Auth 削除に伴い: consent CASCADE 削除
- jobs / origins: `contributor_user_id` **SET NULL**、`source_menu_id` **SET NULL**
- プール本文: **残す**（方針 B）。`status` は変更しない（運用者が disabled にできる）
- account-deletion の expected_tables / pgTAP / runbook に新表を追加
- 列名 `user_id` を origins/jobs に使わない（CASCADE 強制ガードとの衝突回避）

### 11.3 運用者 kill switch

- `status = disabled` で Stage S 対象外
- エンドユーザー UI は提供しない（非目標の個別取り下げと両立）

### 11.4 共有化 worker

- **MUST:** ユーザー向け `generate-menu` / finalize のリクエスト寿命に Pass1/2 を載せない
- scheduled invoker または専用 background/queued Function
- 同時 `running` のグローバル／ユーザー上限を実装で設ける

### 11.5 ログ

- `failure_code` / `skip_reason` の閉じた enum のみ
- プロンプト・完了文・タイトル・menu_payload・email をログ禁止
- 相関は opaque `job_id` / `recipe_id`

## 12. 後方互換・リリース前提

- 本番 DB リセット。旧データ移行なし
- 単一 `shareConsentVersion`
- テストユーザー環境もリセット後を正とする
- §3.1 の「免除しない」項目は従来どおり必須

## 13. エラー表

| 状況 | UX | システム |
| --- | --- | --- |
| 同意オフ | 変化なし | enqueue なし |
| 適格外 | 変化なし | enqueue なし |
| 抽選外れ・上限 | 変化なし | enqueue なし |
| Pass1/2/関門失敗 | 通知なし | failed・非掲載・AI call 計上 |
| revoke 後 in-flight | 通知なし | INSERT 前 skipped |
| S2 障害 | フィクスチャのみ | 非PII ログ |
| 同意トグル失敗 | 設定エラー | 旧状態 |
| job 投入失敗 | 生成は成功 | 生成非影響 |
| lease 期限切れ | なし | failed、再試行なし |

## 14. テスト観点

- 同意既定オフ、オフでも生成可、revoke 後 enqueue なし、in-flight 非掲載、既存プール残存
- 適格: >15 分・pantry 付きは AI 非呼び出し
- カノニカル: adaptations テンプレ必須、空 adaptations で Stage S 通過しないこと
- under-six 閲覧者: S2 が unconstrained で誤通過しない
- 提供者 child adaptation 文言が閲覧者に出ない
- 材料名: pantry 献立がプールに入らない
- UUID: pool payload id ≠ source menu id
- 抽選・台帳の原子性、二重 job なし
- Pass 後グラフ不変、保証表現で不合格
- 緊急: S1 優先、cap、S2 bound、同一 Stage S、contributor 非露出
- RLS pgTAP: pool/origins/jobs 直読不可、管理 RPC 他人空
- 削除: origin unlink、本文残存、copy 更新
- 共有化 AI が通常 generate 枠を削らない
- worker が generate 同期パスにいないこと（設計レビュー／構成テスト）
- 旧 shareConsentVersion reject

## 15. 実装領域（指針）

1. migrations + pgTAP（consent / jobs / pool / origins / 台帳 / RLS / 削除）
2. contracts（version、上限定数、failure codes、wire）
3. `/privacy` dual + settings トグル + 管理一覧 + privacy-copy
4. enqueue RPC + finalize 成功フック
5. share worker Function（Pass1/2、関門、reaper 連携）
6. emergency filter 多ソース化 + emergency-menus S2
7. unit / function / e2e（同意・緊急）

## 16. 実装計画で固定してよい詳細

- worker の具体起動手段（schedule 間隔、Netlify background 等）— ただし §11.4 MUST は不変
- 管理一覧の正確なルート文字列
- denylist / PII パターンの初版リスト本文
- `SHARE_APP_DAILY_*` の本番 env 最終値（初期仮置きは §8.2）

プロダクト方針の分岐は本設計で閉じている。

## 17. レビュー反映サマリ（擬陽性除外後）

| ID | 扱い |
| --- | --- |
| adaptations 空 vs Stage S（C1 系） | **修正** §9.5 テンプレ必須 + 配信 remap |
| ≤15 分・緊急適格（C2/C3 系） | **修正** §8.1 |
| S2 無制限ロード（C3 系） | **修正** §8.2 / §10.1 |
| 材料名ロックと PII（敵対 C1） | **修正** pantry 除外 + 名前は固有名ロック対象外 + 関門 |
| revoke in-flight | **修正** INSERT 前再確認 |
| 削除 FK / CASCADE ガード | **修正** §6 / §11.2 |
| enqueue 原子性・AI call cap | **修正** §6.6 / §8.2 |
| filter 多ソース・metadata | **修正** §9.5 / §10.2 |
| worker を generate に載せない | **修正** §2 / §11.4 |
| privacy-copy と方針 B | **修正** §7.4 |
| 掲載遅延で timing 攻撃を完全遮断 | **Minor / 非採用 v1** — 日付粒度管理一覧 + 非 newest 順序で緩和 |
| 個別通報 UI | 非目標のまま。運用 disabled で代替 |
| 自分の提供分を緊急から除外 | **非必須** §10.4 |

---

**設計ステータス:** 実装計画作成可（上記 Critical を本文に閉じた）。
