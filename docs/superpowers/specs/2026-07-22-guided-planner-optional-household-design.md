# 献立作成ウィザード・家族設定任意化 設計書

- 日付: 2026-07-22
- 状態: ユーザー承認済み
- 対象: ログイン後の開始導線、献立作成、家族設定、生成・履歴・再生成のモード境界

## 1. 背景

現行UIは配色と文言を改善済みだが、献立作成画面では家族選択、食事、メイン食材、ジャンル、追加条件、冷蔵庫、安全確認、保存状態、生成操作が1画面に連続している。「3ステップ」という案内と実際の情報量が一致せず、非エンジニアの利用者が迷いやすい。

また、現行実装は初回設定完了を主要画面への到達条件とし、家族を1人以上登録しなければAI献立を生成できない。利用者には、家族の年齢やアレルギーに合わせた献立ではなく、単純なメニューのアイデアだけを得たい場合もある。

本設計は、献立作成を1画面1質問のウィザードへ変更し、家族設定を任意化する。同時に、家族向けの安全条件を使う生成と、家族条件を使わないアイデア生成を、UIからDBまで明示的に分離する。

## 2. 既存設計との関係

本設計は、次の既存判断を対象範囲内で更新する。

- `2026-07-11-kondate-mvp-design.md` の「初回設定を完了してから主要機能を使う」「生成対象の家族を1人以上必須とする」という判断を、家族設定任意・アイデアモード許可へ変更する。
- `2026-07-21-ui-refresh-design.md` の「レイアウト、情報設計、ナビゲーションを変更しない」という非目標は、本設計の対象画面には適用しない。
- 従来の家族モードにおけるアレルギー、年齢、安全条件、所有者検査、利用上限、再送防止、生成復帰の要件は変更しない。
- AIへの情報送信説明と現行版への同意は、家族設定の有無に関係なく初回AI生成前に必須とする。

## 3. 目的と成功条件

### 3.1 目的

- 献立生成までに一度に読む情報を減らし、現在位置と次の操作を明確にする。
- 家族情報を登録しなくても、ログイン済み利用者が一般的な献立アイデアを生成できるようにする。
- 家族向け安全確認済みの献立と、家族条件未使用のアイデアを誤認させない。
- 主に家庭料理を担う女性利用者を意識しつつ、性別を固定観念で表現せず、温かく上品で日常的に使いやすい外観にする。

### 3.2 成功条件

- 家族を1人も登録していない利用者が、ログインから献立生成と結果確認まで完了できる。
- 献立作成は、食事、メイン食材、ジャンル、対象の順に1画面1質問で進む。
- 生成前に全条件と、安全条件を使用するか否かを確認できる。
- 戻る操作、AI情報説明への移動、通信切断があっても回答を失わない。
- 家族モードでは既存の安全確認をすべて維持する。
- アイデアモードを家族向け安全確認済みと表示しない。
- 320px幅で横スクロールを発生させず、操作領域を44px以上にする。
- 通常文字、補足文字、主要ボタンがWCAG 2.1 AA相当のコントラストを満たす。

## 4. 対象範囲

### 4.1 含める

- ログイン後の初回開始画面
- 家族設定の任意化と、後から設定できる導線
- AI情報送信説明と家族設定状態の分離
- 献立作成ウィザードと生成前確認画面
- 家族モードとアイデアモードのフロントエンド、API、DB契約
- アイデアモードの生成、結果表示、履歴、再生成
- 対象画面で使うデザイントークンと共通UI部品
- 既存データと既存家族モードの後方互換

### 4.2 含めない

- 結果画面全体の情報設計変更
- 下部ナビゲーションの再構成
- 冷蔵庫、履歴一覧、設定画面全体の再設計
- 既存買い物リスト機能そのものの再設計、および買い物リストのアイデアモード対応
- ログイン前の生成
- 家族情報を使わない緊急献立の新しい商品仕様

対象外画面の抜本変更は、本設計の基盤完成後に独立した設計・実装計画として扱う。ただし、データ契約変更の影響を受ける既存機能には互換対応と回帰テストを行う。

## 5. ユーザーフロー

### 5.1 初回ログイン後

1. 開始画面で次の2つを表示する。
   - 主操作: 「献立アイデアを考える」
   - 副操作: 「家族情報を登録する」
2. 家族設定を省略した場合、プロフィールへ省略済み状態を保存し、同じ開始選択を毎回要求しない。
3. 家族設定は設定画面または献立作成の対象ステップから、いつでも開始できる。
4. AI情報の説明が未確認の場合、生成開始時に説明画面へ移動する。確認後は回答を保持したまま生成前確認画面へ戻る。

開始画面のパスは `/welcome` とする。`/` への遷移は、家族設定が `not_started` または `in_progress` なら `/welcome`、`complete` または `skipped` なら `/planner` へ振り分ける。`in_progress` の開始画面では「家族設定を続ける」と「設定せず献立アイデアを考える」を表示する。`complete`または`skipped`の利用者が`/welcome`へ直接アクセスした場合も、操作を表示せず`replace`で`/planner`へ戻す。開始画面は安全境界ではないため、ログイン済み利用者による `/planner` への直接遷移は拒否しない。

AI情報の説明で「今はAIを使わない」を選んだ場合は、回答を保持して生成前確認へ戻し、同意が完了するまで生成操作を利用不可にする。緊急献立への既存導線は維持する。

AI情報の説明はモード差を明記する。両モードで献立条件、選択した冷蔵庫食材、自由入力がAIへ送られることを説明し、家族モードだけは匿名化した年齢帯、アレルギー、安全条件、好みも送られることを追加する。アイデアモードでは氏名、メール、家族設定を送らないと明記する。自由入力には個人名や機微情報を入力しない案内を維持する。

### 5.2 献立作成ウィザード

質問は次の順序で固定する。

1. 食事: 朝食、昼食、夕食
2. メイン食材: 複数選択または入力
3. ジャンル: 和食、洋食、中華、おまかせ
4. 対象:
   - 登録した家族に合わせる
   - 家族設定を使わず、アイデアだけ見る
5. 生成前確認

対象ステップで家族モードを選んだ場合は、登録済みかつ利用可能な家族を1人以上選ぶ。家族が未登録の場合はアイデアモードを選択可能な状態で表示し、「家族情報を登録する」を補助リンクとして示す。

アイデアモードを選んだ場合は、同じ対象ステップ内で1〜20人分の人数を必須入力する。1〜6人分は選択ボタン、7〜20人分は数値入力で指定する。既定値を暗黙に設定せず、利用者が毎回確認する。家族モードの分量は従来どおり選択家族の人数と分量設定から求め、別の人数入力を表示しない。

追加条件である調理時間、予算、今回だけ避ける食材、メモ、冷蔵庫食材は、生成前確認画面から任意で開く。必須4質問の進行を妨げない。

### 5.3 生成前確認

確認画面には食事、メイン食材、ジャンル、対象、追加条件を一覧表示する。アイデアモードでは「家族の年齢・アレルギーは確認されません」を主操作の直前に表示する。

「内容を変更する」から各質問へ戻れる。戻った後も他の回答は保持する。

### 5.4 結果、履歴、再生成

- アイデアモードの結果には「家族条件を使用していません」を常時表示する。
- アイデアモードでは生成実行とサーバー側の生成・再検証contextで家族設定、年齢別食品安全ルール、アレルゲンを読み込まず、家族再検証を行わない。献立作成画面がhousehold選択肢と家族追加導線を表示するため、所有者の利用可能な家族一覧を読むことまで禁止するものではない。アイデアモードは作成時から家族向け安全保証を持たないため、結果と履歴に同じ注意を常時表示する。
- 履歴カードと履歴詳細でも生成モードを識別できるようにする。
- idea生成を公開して主要route guardを外すTask内で、履歴一覧の文字badgeと履歴詳細のmode別child境界まで同時に実装する。idea詳細はこの時点ではnoticeと本文だけのread-only表示とし、family revalidation、shopping、採用、お気に入り、冷蔵庫反映、再生成をmountしない。次Taskはこの境界を維持し、許可する採用・お気に入り・冷蔵庫反映・再生成だけを有効化する。
- 再生成は元のモードを維持する。
- モードを変更する場合は、再生成ではなく回答を引き継いだ新規献立作成として開始する。
- 「これに決めた」とお気に入りはモードに関係なく利用できる。アイデアモードでの採用は家族安全の確認を意味しない。
- 調理後の冷蔵庫反映は、所有する冷蔵庫食材と生成時の使用量だけを更新するためアイデアモードでも利用できる。家族安全の再検証とは分離し、現在の食材所有・version競合検査を維持する。
- 買い物リスト操作だけは、本設計のアイデアモードでは利用できない。
- アイデアモードの結果・履歴・再生成後結果では、買い物の作成、プレビュー、再調整、再検証、pending replayをmountせず、買い物用sessionStorageも作らない。これはUI上の防御であり、既存HTTP/API/DBの拒否境界を代替しない。

## 6. ビジュアル設計

### 6.1 方針

「リネン＆テラコッタ」を採用する。純白、真っ黒、鮮烈なオレンジの大面積使用を避け、料理雑誌のような温かさと日常的な上品さを目指す。女性向けであることを単純なピンクや装飾過多で表現しない。

### 6.2 色

| 用途 | 色 | 値 |
| --- | --- | --- |
| アプリ背景 | リネン | `#f7f2e9` |
| カード背景 | アイボリー | `#fffdf8` |
| 主要操作背景 | ソフトクレイ | `#d9a48f` |
| 強調文字・濃色操作 | ディープクレイ | `#8b4e3b` |
| 本文 | エスプレッソ | `#423a32` |
| 補足 | ウォームグレー | `#6b5e52` |
| 選択面 | ペールクレイ | `#f4e6df` |
| 注意面 | ウォームノーティス | `#f8ece7` |

主要な組み合わせのコントラストは次のとおり。

- 本文 `#423a32` / カード `#fffdf8`: 10.97:1
- 補足 `#6b5e52` / カード `#fffdf8`: 6.17:1
- 主要操作文字 `#3b302b` / ソフトクレイ `#d9a48f`: 5.88:1
- アイボリー `#fffdf8` / ディープクレイ `#8b4e3b`: 6.35:1

### 6.3 文字と形

- 質問見出しは `"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif`、本文と操作は既存の `"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif` を使う。新しいWebフォント配信は追加しない。
- カードは18〜20px、主要操作は15px前後の角丸を基本にする。
- 影は薄く、境界線は暖色系にする。
- 選択状態は色だけでなく、枠、背景、チェック表示で伝える。
- 主操作は各画面に1つとし、同じ強さのボタンを並べない。
- 主要操作のhoverは `#cf947d`、activeは `#cc927b`、文字は `#3b302b` とする。文字コントラストはそれぞれ4.98:1、4.85:1を確保する。
- フォーカスリングは背景色にかかわらず視認できる3pxの `#8b4e3b` とし、2pxのoffsetを設ける。
- 状態遷移の動きは150〜200msの控えめなフェードまたはスライドに限定する。
- `prefers-reduced-motion` では装飾的な動きを無効化する。

### 6.4 共通UI部品

- `WizardFrame`: 質問番号、進捗、戻る操作、本文領域、主操作を配置する。
- `ChoiceCard`: 単一・複数選択に共通利用し、選択状態と説明を表示する。
- `ProgressIndicator`: 現在位置を文字とバーの両方で表示する。
- `InlineNotice`: アイデアモード、安全、保存失敗などを見出しと本文で表示する。
- `ReviewRow`: 確認画面の項目名、値、編集操作を表示する。

## 7. フロントエンド構成

### 7.1 画面と責務

- 開始画面は家族設定の開始または省略だけを担当する。
- `PlannerWizard` は現在の質問、戻る・進む遷移、回答済み判定を担当する。
- `MealStep`、`IngredientStep`、`CuisineStep`、`AudienceStep`、`ReviewStep` は表示と入力だけを担当する。
- 既存のルート層が下書きの取得、自動保存、競合解決、利用上限、生成開始を一元管理する。
- 各ステップはSupabaseや生成APIを直接呼ばない。
- 献立作成画面は対象ステップのhousehold選択肢表示に必要な家族一覧を取得できる。選択後のidea生成実行、prompt、安全snapshot、家族再検証へその一覧を渡してはならない。

### 7.2 ルーティング

- ログイン必須の `RequireSession` は維持する。
- 主要画面全体を囲む `RequireCompletedOnboarding` は廃止する。
- 家族設定画面は任意の独立ルートとして維持する。
- AI情報の同意は、主要画面への入場条件ではなく生成開始条件として扱う。
- 同意画面へ移動するときは安全な `returnTo` と保存済み下書きを使い、確認画面へ復帰する。

現行の `RequireCompletedOnboarding` は主要画面群全体を囲み、プロフィールが `complete` でなければ `/onboarding` へ強制遷移する。本設計の変更は単なるコンポーネント削除ではなく、全ログイン利用者のルート到達条件を変更する。`/welcome` とウィザードを実装し、アイデアモードのサーバー経路が利用可能になったTaskでガードを外す。先行Taskでガードだけを外してはならない。

同じTaskでルーター構造テスト、`RequireCompletedOnboarding` の単体テスト、初回設定・認証復帰・直接URL遷移に関するE2Eを新しい導線へ更新する。緊急献立が家族設定未完了でも到達可能という既存契約は維持する。

## 8. 状態とデータ契約

### 8.1 家族設定状態とAI同意の分離

既存の `profiles.onboarding_status` は家族設定の状態として扱い、許可値へ `skipped` を追加する。

```text
not_started | in_progress | complete | skipped
```

- `complete` は従来どおり、少なくとも1人の完全な家族設定を必要とする。
- `skipped` は家族設定を行わずに開始したことを表す。
- `complete` と `skipped` はAI情報への同意を意味しない。
- AI情報への同意は `privacy_consents` だけを正本とする。
- 既存の `complete` 利用者と家族データはそのまま維持する。

`onboarding_completed_at` は履歴上の初回時刻ではなく、現在の終端状態である `complete` または `skipped` へ最後に入った時刻を表す。`in_progress` へ戻るとnullにし、再び `complete` または `skipped` へ入るとその時刻で更新する。初回選択時刻の履歴保存は本設計の対象外とする。家族設定状態を更新するRPCからプライバシー同意の必須検査を外し、プライバシー画面は `privacy_consents` だけを更新する。生成サーバーは従来どおり現行版の同意を独立して検査する。

許可する状態遷移は次のとおりとする。

- `not_started` → `in_progress` または `skipped`
- `in_progress` → `complete` または `skipped`
- `skipped` → `in_progress` または `complete`
- `complete` は家族編集や家族削除によって別状態へ戻さない

要求状態と現在状態が同じ再送は、`onboarding_completed_at`や`updated_at`を変更しない冪等な読出しとして成功させる。RPCは認証確認後に対象profile rowを`SELECT ... FOR UPDATE`し、ロック後の状態で冪等性と遷移可否を判定する。`start_household_onboarding`と同じprofile row lock順を使い、別タブの`skipped→complete`と`skipped→in_progress`が競合しても、後勝ちで禁止遷移を成立させない。

`complete` は「家族設定を過去に1回以上完了した」プロフィール状態であり、「現在も利用可能な家族が1人以上いる」という不変条件ではない。`complete` への遷移時だけは完全な家族設定が1人以上あることをDBで検査する。最後の完全な家族を後から削除してもプロフィールは `complete` のまま維持し、献立作成時に現在利用可能な家族を別途取得して判定する。利用可能な家族が0人なら家族モードを選択不可にし、アイデアモードと家族追加導線を表示する。

`skipped` への遷移は入力途中の家族下書きを削除しない。再開時は同じ下書きから続ける。

家族設定完了操作は、家族memberの完了保存が成功した後にprofileを`complete`へ更新し、その成功後だけ`/planner`へ遷移する。どちらかが失敗した場合は画面に残る。プライバシー画面はこの完了処理を代行せず、同意有無と家族設定完了を結合しない。

現行DBは `onboarding_status` を `not_started | in_progress | complete` に制限し、`set_onboarding_status` も `skipped` を拒否している。また、現行RPCは `complete` とプライバシー同意を結合している。実装ではプロフィールのCHECK制約と完了時刻CHECKを置き換え、RPCへ上記の状態遷移を実装し、プライバシー同意検査を分離するマイグレーションが必須である。生成型、プロフィール取得、household query、pgTAPも同じTaskで更新する。

### 8.2 生成対象モード

フロントエンド、共有契約、下書き、生成予約、完成献立に次の値を追加する。

```ts
type TargetMode = "household" | "idea";
```

送信契約は判別可能なunionにする。

```ts
type PlannerSubmission =
  | {
      targetMode: "household";
      targetMemberIds: [string, ...string[]];
      servings: null;
    }
  | {
      targetMode: "idea";
      targetMemberIds: [];
      servings: number;
    };
```

実際の型には食事、食材、ジャンル、追加条件、冷蔵庫選択も含む。アイデアモードの `servings` は1〜20の整数とする。下書きだけは質問途中を表すため `targetMode: null` と `servings: null` を許可する。提出時のアイデアモードでは `servings: null` を許可しない。

空の `targetMemberIds` からモードを推測してはならない。モード、家族ID、人数の矛盾はブラウザ、共有スキーマ、DB制約のすべてで拒否する。

### 8.3 DB保存

次の領域へ `target_mode` を保存する。

- 献立作成下書き
- 生成時に凍結する提出内容
- 生成リクエストの整合性・再送判定対象
- 完成献立

生成リクエストHMACには `target_mode` とアイデアモードの `servings` を含める。既存の完成献立と対象家族を持つ既存下書きは `household` へ移行する。対象家族が空の古い下書きは `idea` へ自動移行せず、モードと人数を未選択状態にする。

現行の下書き、凍結提出、完成献立には `target_mode` がない。`menus.servings`、`safety_snapshot`、`safety_fingerprint`、`allergen_dictionary_version`、`food_safety_rule_version` はすべてNOT NULLである。実装マイグレーションは次を行う。

- 下書きと凍結提出へ `target_mode` とアイデア用 `servings` を追加し、モード・対象家族・人数の条件付きCHECKを追加する。`generation_drafts.target_mode`/`servings`は質問途中を表すためnullableとする。`private.generation_draft_submission_versions.target_mode`はNOT NULL、同表の`servings`はnullableとし、householdではNULL、ideaでは1〜20を強制する。
- 完成献立へ `target_mode` を追加し、既存行を `household` へbackfillしてからNOT NULLと `household | idea` のCHECKを設定する。
- `menus.servings`、`safety_snapshot`、`safety_fingerprint` は両モードでNOT NULLを維持する。
- `allergen_dictionary_version` と `food_safety_rule_version` だけをnullableへ変更し、`household` では両方NOT NULL、`idea` では両方NULLとなる条件付きCHECKを追加する。
- 既存の家族モード行、凍結提出、HMACは意味を変えず、追加列のbackfillだけを行う。

保存schemaを追加するTaskだけを適用した中間状態でも、現行household生成を壊してはならない。同じmigrationで`save_generation_draft`をmode/servings対応signatureへ置換し、次Taskでv2へ置換されるまで現行v1予約をhousehold専用として新列へ追随させ、完了処理も`menus.target_mode='household'`を明示保存する。Task単独でhouseholdの保存、予約、完了を通す。

空の古い下書きを開く場合、食事、食材、ジャンル、追加条件、冷蔵庫選択は保持する。`targetMode` と `servings` だけをnullにし、ウィザードは最初の未完了項目である対象ステップから再開する。これは既存回答を保持しながら、モードだけを利用者に再確認する例外フローである。

再生成は新規献立用のdraft revision表を流用せず、request-boundなprivate snapshot表を追加する。`request_id`は主キーとし、単独FKは張らない。外部キーは`(request_id,user_id)`から`private.ai_generation_requests(id,user_id)`への`ON DELETE CASCADE`複合FKだけとし、次を保持する。

- `user_id`
- `kind`: `regenerate_menu | regenerate_dish`
- `source_menu_id` と `source_menu_version`
- `replace_dish_id`: 一品再生成だけ非null
- `target_mode`
- `servings`: 両モードで1〜20
- `target_member_ids`: householdは1〜20、ideaは空
- `created_at`

snapshotは予約RPCが所有者・元献立version・対象料理をロック確認した同じトランザクションで、生成リクエスト行と1対1に作成する。生成リクエストの`(id,user_id)`をUNIQUEにし、snapshotの`(request_id,user_id)`から複合外部キーを張ってownerを構造的に一致させる。対象家族配列はDB制約でも一次元、NULL要素なし、重複なしを保証し、householdは1〜20件、ideaは0件とする。元献立へのlive FKは持たず、予約後に元献立または料理が削除されても監査・整合性情報としてsnapshotを保持する。UPDATEを拒否して不変とし、生成リクエストの30日保持が終了して削除されるときだけcascadeで削除する。献立全体・一品の両再生成で、HMAC、integrity replay、完了RPCが参照する予約時のモード・人数・対象家族・出典versionはこの`request_id`のsnapshotを正本とする。

このsnapshotは元献立aggregateや料理本文を複製せず、元献立削除後の実行継続を保証しない。実行コンテキスト構築時はliveの元献立と対象料理を所有者・version付きで再取得し、snapshotと一致しなければ外部AI呼出し前に `source_menu_changed` でfail-closedする。コンテキスト構築後から完了処理までに元献立または対象料理が変更・削除された場合も、完了RPCがsnapshotの出典versionとlineage参照を再確認し、完成献立を保存せず同じcodeで終了する。外部送信前なら予約したattemptを既存規則で返却し、送信後ならattemptは消費するが成功枠は消費しない。

TypeScriptの再生成integrity contextも`targetMode`による判別可能unionにする。household branchは対象家族の非空tupleを持ちruntimeでも1〜20件、idea branchは空tupleだけを持つ。`TargetMode`と任意配列を別fieldとして組み合わせ、idea+非空やhousehold+空を型上許す形にはしない。

### 8.4 生成コマンドの版移行

新規コマンドのHMAC版を `generation-command.v2` とし、canonical payloadへ `targetMode` と `servings` を追加する。既存の `generation-command.v1` は家族モード専用の旧形式として扱う。

現行の `private.ai_generation_requests.request_hmac_version` は等号CHECKと予約RPC内の検査の両方で `generation-command.v1` だけを許可する。実装マイグレーションは列CHECKを `generation-command.v1 | generation-command.v2` に変更し、予約RPCを「既存ledgerのv1回収」と「新規v2予約」を区別して検査する。列CHECKだけを緩和して、クライアントが新規v1を予約できる状態にはしない。

v2のHTTP wire commandは全kindでトップレベルに `commandVersion: "generation-command.v2"` を必須とする。新規献立のwire requestは従来どおり下書きIDとrevisionを送り、サーバーが凍結下書きから `targetMode` と `servings` を解決してHMACへ含める。献立全体・一品の再生成は、サーバーが所有者確認済みの元献立から `targetMode` と `servings` を解決し、再生成用の凍結提出へ複製してHMACへ含める。再生成のクライアント入力でモードや人数を上書きできない。

HTTP success bodyは`GenerationCommandResponse = GenerationStatusData | GenerationMigrationRedirect`とし、`GenerationMigrationRedirect`は`{ status: "migration_redirect"; legacyIdempotencyKey: string; idempotencyKey: string }`に固定する。`generationResponse`はこのunionだけをHTTP 200で返し、browser API parserは`status`で判別してrecoveryへ渡す。redirect recoveryは同じ`idempotencyKey`のv3 pending保存成功後だけv2 commandを通常送信する。

- デプロイ前に作成済みの凍結提出、リクエスト、完成献立は `household` として読めるようbackfillするが、保存済みv1 HMACは書き換えない。
- デプロイ後に新規予約できるのはv2だけとする。v1は既存のidempotency keyに束縛された状態取得、replay、処理中リクエストの完了に限って受理する。
- `commandVersion` がない新規HTTP commandは、`既存request → migration tombstone/mapping → true miss`の順で検索し、true missだけを`client_update_required`として外部AI呼出し前に拒否する。新bundleはcodeを型付きerrorとして保持し、`generation-machine.ts`の専用event/reducerで`update_required`終端phaseへ遷移する。このphaseは`online`、`network_error`、通常retryでofflineのようにcheckingへ戻らず、明示的な再読込だけを回復操作とする。「画面を再読み込みしてください」という文言と再読込操作を表示する。既存requestは保存済み版で回収する。mapping hitはHTTP 200 success envelopeの`{ status: "migration_redirect", legacyIdempotencyKey, idempotencyKey: v2Key }`へ固定し、内部repository型`GenerationRequestLookup`をwireへ露出しない。新bundleは型付きredirect caseから同じv2 keyをv3 pendingへ保存後、通常のv2 commandを送る。配信済み旧bundleは未知の`migration_redirect`をrejectしてgeneric offline表示になり得るため、再読込文言やCTAは保証しない。旧bundleについて保証するのは、サーバーが新規v1予約、quota、attempt、provider call、mapping変更を行わないfail-closed性までとする。
- 予約処理は最初に既存ledgerを検索し、保存済みHMAC版で照合する。同じkeyをv1からv2へ再解釈せず、予約枠や外部AI試行枠を二重消費しない。
- 処理中のv1は従来の家族モード経路でterminalまで完了させる。特に`request_hmac_version='generation-command.v1'`かつ既存`processing`の献立全体・一品再生成は、snapshotなしのlegacy household context/finalize分岐を使う。Task 3時点の家族安全、household保存、lineage、quota/attempt契約を維持し、新snapshot/source-version検査を要求しない。v1には予約時versionがないためsnapshotをbackfillしない。新規v1予約は禁止し続け、v1 readerとlegacy finalize分岐は30日のledger保持期間と最長処理期限を過ぎ、対象行が存在しなくなるまで維持する。新規v2再生成だけはrequest snapshotを必須とする。
- 端末に残るv1 pending commandは、まず既存リクエストの有無を確認する。存在すればv1として回収する。存在しない新規献立commandは、保存された `draftId` と `draftRevision` で現在の同revision下書きを再取得する。v1のDB契約は対象家族1〜20人を必須としており、v1は家族モード専用だったため、同revisionの対象家族が非空なら例外的に `household` と確定できる。この判断は空配列からモードを推測するのではなく、legacy schemaの判別済み版契約に基づく。食事、食材、ジャンル、追加条件、冷蔵庫選択は同revision下書きから再構築する。revisionが不一致、下書きが欠損、対象家族が空なら変換せず、現在の下書きを保持して最初の未完了ステップを表示する。
- 既存リクエストがないv1再生成commandは、所有者確認済みの元献立を取得する。v1時代の完成献立はmigrationで `household` へbackfillされるため、その保存済みモードと人数をv2凍結提出へ複製する。元献立が欠損または不整合なら変換しない。
- v1からv2への変換では、各タブが新しいidempotency keyを生成してはならない。サーバーのclaim処理が、利用者IDとlegacy idempotency keyを一意キーとするprivate migration ledgerをトランザクション内で作成し、新しいv2 idempotency keyを1つだけ発行または再読出しする。複数タブ・端末から同じlegacy keyをclaimしても同じv2 keyを返す。
- claim処理は、既存v1リクエストがあれば変換せずその回収先を返す。存在しない場合だけlegacy keyのtombstoneとv2 keyの対応を保存する。以後にlegacy keyで新規v1 HTTP commandが到着しても、HTTP/lookup層がmappingを読み、予約・quota・attempt・外部AI試行を行わず、対応するv2 keyを返す。新しい15引数DB予約RPC自体はmigration redirectを担当せず、v2の通常予約と同一key replayだけを扱う。
- claim処理は認証user単位のtransaction advisory lockで同一ownerの別keyも直列化する。lock後に既存v1とsame-key mappingを再確認し、これらの冪等回収は新規作成countに含めない。真の新規だけowner内最大100件のbounded expired cleanupを行った後、有効mapping最大32件、10分内の新規mapping最大8件を同じDB transaction内で権威的に検査する。32件到達後の33件目または10分内9件目はinsertせず、直接RPCとHTTPの両方で安定code `legacy_migration_limit`を返す。上限はownerごとに独立する。
- migration ledgerはAI ledgerの30日にlegacy pending TTLと最大processing期限を加えた期間以上（本実装ではclaimから31日）保持し、owner-bound RLS相当の関数内検査を行う。cleanupは期限超過だけでなく、対応するv2 requestが保持中でないことも確認し、requestが残る間はmappingを削除しない。v2予約はclaim済みの対応を検査し、同じv2 keyの通常の冪等性境界へ合流する。
- v1からv2へ変換した端末コマンドは、claimで得たv2 keyを持つ新コマンドの保存成功後に旧コマンドを削除する。両方を送信可能な状態で残さない。

端末保存は `commandVersion` を持つ新スキーマと新しいstorage keyを使用する。現行keyのversion discriminatorなしデータだけをlegacy v1として読む。両keyが存在する場合は、新スキーマを正本とし、owner、TTL、request ID、migration mappingの整合を確認してからlegacy側を削除する。既存requestまたはmappingを回収できるlegacy pendingは`client_update_required`表示時にも無条件削除しない。true missかつ変換不能と確定した行は回答復元に必要な情報を保持したまま送信不能化し、自動再送を止める。

## 9. サーバー側の安全境界

### 9.1 共通で維持する防御

両モードで次を維持する。

- Supabase JWTによる認証
- 所有者検査とRLS
- 入力サイズ、列挙値、下書きrevisionの検査
- 冪等性、HMAC、利用者上限、短期レート制限、アプリ全体上限
- 医療・治療食依頼の拒否
- 冷蔵庫食材の所有者・期限確認
- 今回だけ避ける食材と必須食材の矛盾検査
- AI出力の構造、指定食材、重複結果、禁止内容の検証
- 中断復帰と同一リクエストの結果回収

### 9.2 家族モード

現行の対象家族取得、安全スナップショット、アレルギー・年齢条件、ラベル確認、現在フィンガープリントのロック再検証を維持する。対象家族は1〜20人で、全員がログイン利用者の完全な家族設定でなければならない。

再生成のcontext構築とfinalizeはrequest snapshotを読む前に`request_hmac_version`を判定する。snapshotなしの既存processing v1 whole/dishはlegacy household分岐へ入り、Task 3時点の家族安全とlineageで成功または失敗のterminalまで進む。v2だけが新snapshotとsource-version再検証を使う。

### 9.3 アイデアモード

- 対象家族と家族由来の年齢、アレルギー、好みを読み込まず、AIへ送信しない。
- 再生成adapterもrequest snapshotのmodeを先に判別し、idea branchではcurrent household safetyと家族用`buildStoredGenerationContext`を呼ばず、専用idea contextを構築する。household branchは既存の家族安全構築を維持する。
- 家族別取り分け、家族別注意、家族別ラベル確認を生成結果に含めない。
- 現行の年齢別食品安全ルールはすべて対象年齢帯を必要とするため、アイデアモードには適用しない。アイデアモード専用の一般安全ルールを本設計で新設したとは扱わない。
- DBのnot-null契約を維持するため、安全スナップショットはnullにせず、`mode: "idea"`、`assurance: "none"`、空の家族一覧を持つ専用形式にする。生成コンテキストの `foodRuleVersion` と `allergenVersion` はnullとし、専用スキーマと完了処理がアイデアモードに限ってnullを許可する。架空の安全ルール版は保存しない。
- 安全フィンガープリントは、家族安全を確認した証明ではなく、`mode: "idea"` と専用スナップショットのcanonical表現が改変されていないことを示すSHA-256値として保存する。UIでは安全確認済みの意味に使わない。
- 現行の `private.current_safety_fingerprint()` とTypeScript側の家族フィンガープリント関数は、非空の完全な家族と年齢別ルール版を前提とするため変更しない。アイデアモードには、固定canonical JSON `{"assurance":"none","members":[],"mode":"idea"}` だけをSHA-256化する専用DB helperと対応するTypeScript関数を追加する。専用helperは家族表・アレルゲン表・年齢別ルール表を読まず、完了RPCが予約時と保存時に同じ値を再計算して照合する。
- 完了処理は対象家族が0人であること、家族別データが0件であること、予約時のモードとフィンガープリントが一致することを確認する。
- AI出力の `menu.servings` は凍結提出の `servings` と完全一致しなければ検証エラーにする。完了RPCも予約済み提出の人数と保存する完成献立の人数を照合し、不一致時は行を作成しない。
- 結果に「家族条件を使用していません」と表示し、アレルギー対応や年齢適合を保証しない。

完成献立のメンバー配列はアイデアモードに限り空を許可する。結果コンポーネントは家族別取り分け、家族別注意、ラベル確認の領域自体を表示しない。履歴など既存の完成献立利用箇所は、空の対象家族を欠損データと誤判定しないよう互換対応する。

本設計ではアイデアモードの献立を買い物リストの出典にできない。結果・履歴詳細ではアイデアモードの買い物リスト操作を表示しない。マージ済みの既存買い物リストの作成、プレビュー、再調整、再検証、pending replayは家族モードで維持し、異なるモードを同一リストへ混在させない。アイデアモード対応の買い物リストは、集約フィンガープリントと再検証境界を別設計で確定してから追加する。

買い物リストのfrom-menu、preview、reconcile、revalidateの全HTTP処理と `apply_shopping_draft`、`apply_shopping_reconciliation` は、出典献立の `target_mode` が `household` であることを検査する。create/reconcileのHTTP/serviceとDB RPCは有効期限内mutation replayを最初にread-onlyで返し、replay hitなら出典削除、identity障害、mode変化後も保存済み成功を返してlive modeを再解釈しない。replay missだけidentity、mode、full処理へ進む。preview/revalidateはmutation replayを新設せず各既存契約に従う。`stored-menu-loader.ts`にはowner-scopedで`id,user_id,version,target_mode`だけを読む`loadStoredMenuIdentity`を置き、家族/member/catalogをnested selectするfull aggregate loaderと分離する。`ShoppingDependencies`もmutation replay→identity→既存`loadMenu`の段階を分け、replay missのcreate/preview/reconcileはidentity直後にideaをfull aggregate、家族再検証、fingerprint、pantry読出し、active list取得、RPCより前に拒否する。既存list revalidateも各live sourceのidentityを先に読み、ideaが混入していれば家族queryや安全projection書込みへ進まずfail-closedする。外部契約は買い物4経路で`422 / idea_menu_not_supported / アイデア献立は買い物リストに利用できません`に統一する。DB RPCでもideaなら同codeで、リスト、item、出典snapshot、list version、mutation ledgerを一切変更せず拒否する。UI非表示だけを境界にしない。

両apply RPCは有効期限内のidempotency replayをread-onlyで最初に判定し、replay hitでは保存済み成功応答を返して現在のmodeを再解釈しない。replay miss後は、所有者・menu version・`target_mode`を同じ出典献立行からlockなしのidentity readで取得し、owner/not-found、source version、modeの順で判定する。ideaはこの時点でwriteもrow lockも行わず拒否する。householdの全writerは`mutation replay（該当時）→ lockなしsource identityのowner/version/mode → active list FOR UPDATE（存在時）→ source rows/menu FOR SHARE再確認 → shopping safety locks（menu id昇順）→ writes`のglobal orderへ統一する。初回new listは既存のuser単位active-list直列化/unique契約をactive-list段階で維持し、逆順lockを作らない。期限切れ同一key削除とbounded cleanupも必要lock後のwrite phaseに置く。`refresh_shopping_list_safety`、`mutate_shopping_item`、`private.lock_and_check_shopping_list_safety`も`replay（該当時）→ active list FOR UPDATE → source rows/menu FOR SHARE → safety locks（menu id昇順）→ write`へ揃える。同一transactionでhelperがlistを二重lockしてもよいが手順は一意にする。idea拒否はtransaction rollbackへ依存せずmutation ledgerを含む全行を不変にする。apply draft/reconciliation対refresh/mutateの全cross-RPC、複数source、初回listをdblinkで競合させ、deadlockなしと既存error優先順位を固定する。

完成献立の家族安全を直接再検証するAPIも、最初に`loadStoredMenuIdentity`だけを読み、直後に`target_mode`を検査する。ideaは空member由来のhousehold用errorへ落とさず、full aggregate、家族表、アレルゲンcatalog、年齢rule query、再検証行書込みより前に`422 / idea_menu_revalidation_not_supported / アイデア献立は家族条件で確認できません`で拒否する。householdだけが既存full aggregateと再検証へ進む。

## 10. エラー処理

- AI情報の説明が未確認なら、回答を保存して説明画面へ移動する。確認後は生成前確認へ戻る。
- 家族設定が `not_started` または `in_progress` の利用者が対象ステップでアイデアモードを確定したとき、家族下書きを残したまま状態を `skipped` へ更新する。`/planner` へ直接移動しただけでは状態を変更しない。
- migration後にモード未選択となった古い空対象下書きは、既存回答を保持して対象ステップから再開する。エラーとして破棄せず、アイデアモードへも自動変換しない。
- 家族モードで選択した家族が削除、未完了、利用不可になった場合は対象ステップへ戻す。アイデアモードへ自動降格しない。
- アイデアモードに家族IDが含まれる、または家族モードの家族IDが空の場合は、検証エラーとして生成しない。
- 自動保存に失敗した場合は現在の画面に残し、再試行できる状態を表示する。
- 生成開始後の通信切断は既存の復帰機構を使い、同じモードと同じリクエストの状態を回収する。
- 新bundleはlegacy true missの`client_update_required`を通信切断として自動再送せず、更新必須の終端状態として再読込案内と操作を表示する。既存requestまたはmigration mappingがある場合はこのerrorより回収・redirectを優先する。
- アイデアモードの再生成理由では、年齢適合を意味する `child_friendly`（「子どもが食べやすく」）を表示せず、APIでも拒否する。他の定型理由と自由理由には、医療・治療食依頼の既存検査を適用する。
- idea献立への買い物4経路は`idea_menu_not_supported`、直接家族再検証は`idea_menu_revalidation_not_supported`として、用途に合う固定messageで副作用なく拒否する。

## 11. アクセシビリティ

- すべての操作領域を44px以上にする。
- 質問見出しへフォーカスを移してから各ステップを表示する。
- 戻る・進む操作だけでなく、現在の質問番号を読み上げ可能にする。
- 選択状態を色だけで示さない。
- 入力検証errorはissue pathから実入力単位のfield error mapへ変換する。fieldは`mealType`、`mainIngredients`、`cuisineGenre`、`targetMode`、`targetMemberIds`、`servings`、`timeLimitMinutes`、`budgetPreference`、`avoidIngredients`、`memo`、`pantrySelections`とし、追加条件を単一fieldへ集約しない。`mapPlannerIssuePathToField`は配列indexをroot fieldまたはgroup controlへ正規化する。安定したinput/error ID、`aria-invalid`、`aria-describedby`で該当入力とfield-local messageを関連付け、画面上部のalertだけに依存しない。submit時のfocus順は質問順に加え、対象質問内を`targetMode → targetMemberIds → servings`、review内を`timeLimitMinutes → budgetPreference → avoidIngredients → memo → pantrySelections`とする。
- キーボードだけで質問、確認、編集、生成まで操作できるようにする。
- 320px幅と200%拡大で横スクロールを発生させない。
- `prefers-reduced-motion` を尊重する。

## 12. テスト方針

### 12.1 Vitest / React Testing Library

- `TargetMode` と家族IDの条件付き契約
- アイデアモードの人数1〜20、家族モードの `servings: null`、矛盾入力の拒否
- 下書きの未選択状態と既存下書きの移行
- 古い空対象下書きで既存回答を保持し、対象ステップから再開すること
- 各質問の選択、戻る、進む、回答保持
- 家族未登録時のアイデアモードと登録導線
- 家族変更時に自動降格しないこと
- AI情報説明から確認画面へ戻ること
- アイデアモードの常時表示と、家族向け表現を出さないこと
- アイデアモードで買い物リスト操作を表示しないこと
- アイデアモードで買い物hook/query/pending replayをmountせず、4つのshopping endpointを呼ばず、shopping sessionStorageを作らないこと
- アイデアモードで `child_friendly` を表示せず、APIでも拒否すること
- 新bundleが`client_update_required`と`migration_redirect`を型付きで扱い、generation machineのterminalな`update_required` phase/event/reducer、online/network retry非復帰、再読込文言・操作へ写すこと。旧parser fixtureは未知redirectをrejectしgeneric offlineになるが、サーバーの予約/quota/attempt/provider/mapping副作用が0件であること
- shopping create/reconcileがmutation replayをidentityより先に読み、source削除・identity障害・mode変化後も保存済み成功を返すこと。replay missのidea新規keyだけが422で、preview/revalidateは既存契約を維持すること
- field errorの`aria-invalid`/accessible description、最初の不正入力へのfocus、キーボード操作、step focus、reduced motion
- デザイントークンのコントラスト

### 12.2 pgTAP

- 家族設定の `complete` と `skipped`、AI同意の独立性
- `skipped → in_progress → complete` で完了時刻がnull化・再設定され、最後の家族削除後も `complete` を維持すること
- 同一状態の再送が時刻を変えず、別sessionの`skipped→complete`と`skipped→in_progress`がprofile row lockで直列化されること
- `target_mode`、対象家族配列、人数の条件付きDB制約
- 保存schema Task単独でv1 householdの下書き保存、14引数予約、完了が通ること
- `menus` のhousehold行はアレルゲン版・年齢別ルール版が必須、idea行は両方NULLで、servings・snapshot・fingerprintは両モード必須であること
- 既存行の `household` への移行
- `request_hmac_version` がv1/v2以外を拒否し、新規v1予約をRPCが拒否すること
- v2予約内容、HMAC、再送時のモード一致と、既存v1 replayの版固定
- 献立全体・一品の再生成snapshotがrequest-boundかつ更新不可で、元献立・料理が変更または削除された場合は外部送信前または完了前に `source_menu_changed` でfail-closedし、完成献立を作らないこと
- 再生成snapshotがrequest ownerと複合FKで一致し、21人、NULL要素、重複家族IDを拒否すること
- v1/v2で同じidempotency keyを二重予約・二重消費しないこと
- migration前からprocessingのsnapshotなしv1 whole/dish再生成が、旧signatureの成功・失敗finalizeでterminal化し、household保存、lineage、quota/success/attempt、後続回収が整合すること
- 複数タブ・端末が同じlegacy keyを同時claimしても同じv2 keyを受け取り、遅れて到着したv1 HTTP commandがtombstoneから同じv2 keyへ副作用なくredirectされること
- ownerごとの有効mapping 32件、10分8件をDB transaction内で強制し、33件目/9件目と並行別key直接RPCが`legacy_migration_limit`、same-key/既存v1がcount不変、別ownerが独立であること
- claim直後、pending TTL直前のv2予約、最大processing期限直前のterminal化、AI ledger保持終了の境界で、対応requestが残る間はmigration mappingも残り、両方の保持終了後だけbounded cleanupされること
- アイデアモードでAI出力人数と凍結提出人数が不一致なら、完了行を作成しないこと
- アイデアモード完了処理で家族別データを拒否すること
- 家族モードの現行フィンガープリントロックが維持されること
- 両モードの所有者境界とRLS
- 買い物RPCをservice roleで直接呼んでも、アイデア献立を出典にできず、list/item/source/snapshot/version/mutation ledgerが不変であること。replay hitの保存済み成功、owner/version/modeのerror優先順位、全writerのactive-list→source→menu-id昇順safety lockを維持し、apply/reconcile対refresh/mutateの全cross-RPCがdeadlockしないこと

### 12.3 Playwright

- ログイン後、家族設定を省略し、4質問、AI情報説明、確認、生成結果まで進む経路
- アイデアモードで人数を指定し、結果の分量へ反映される経路
- 家族登録済み利用者が家族モードで生成する既存経路
- 回答途中の再読み込みと別タブ復帰
- 生成中の通信切断と結果回収
- 新bundleがlegacy true missで自動再送せず、再読込案内へ到達する経路
- 選択家族の変更時にアイデアモードへ自動降格しないこと
- idea結果・履歴・再生成後で買い物network requestとshopping storageが0件、householdで既存create/reconcile/replay/raceが成功すること
- shopping create/reconcile成功後にsourceを削除した同key replayが保存済み成功を返し、idea sourceへの新規keyが422になること
- 320px幅での横スクロール、44px操作領域、field error関連付け、固定操作、フォーカス順序

### 12.4 セキュリティ統合テスト

- 登録家族の呼び名、アレルギー、好みに固有canaryを保存してからアイデアモードを生成し、家族DB読出し結果、生成コンテキストDTO、OpenRouterへ送る本文、保存済み安全スナップショット、完成献立の家族別子行のすべてにcanaryが存在しないことを確認する。
- `targetMode: "idea"` と非空の家族ID、`targetMode: "household"` と空の家族ID、各モードと矛盾する `servings` を、共有スキーマ、API、予約RPC、コンテキスト復元、完了RPCの各境界で拒否する。
- アイデアモードのAI応答で1〜20内の別人数を返す敵対ケースを用意し、サービス検証と完了RPCの両方で拒否する。
- 既存v1処理中リクエスト、v1 replay、未送信v1端末コマンド、v2新規予約を並べ、外部AI試行枠と成功予約枠を二重消費しないことを確認する。
- migration前からprocessingのsnapshotなしv1 whole/dishをmigration後に成功・失敗の両方で終端化し、新snapshot/source-version検査を通さずにTask 3時点の家族安全、household保存、lineage、quota/attempt契約と後続回収を維持することを確認する。
- 同じ未送信v1 commandを2タブで同時変換し、migration ledgerがv2 keyを1つだけ発行し、片方のlegacy送信が遅延しても生成成功が1件だけであることを確認する。
- 両再生成kindで予約後の元献立・対象料理を、実行コンテキスト構築前と外部送信後の各タイミングで変更・削除し、`source_menu_changed`、attempt返却/消費、成功枠非消費、完成献立0件を確認する。
- idea献立を買い物4 HTTP経路と直接menu revalidationへ送っても、軽量identity query以外の家族・member・catalog query、fingerprint、pantry、RPC、projection writeが0件で、買い物は`idea_menu_not_supported`、直接再検証は`idea_menu_revalidation_not_supported`を返すことを確認する。

### 12.5 提出前検証

リポジトリの `AGENTS.md` が定める9段階の検証を順番どおり実行する。DB契約と主要導線を変更するため、pgTAPとE2Eを省略しない。

## 13. 実装の分割方針

実装計画は次の8 Taskに分け、順番に実行する。表中の既存制約変更は各Taskの必須範囲であり、後続Taskへ先送りしない。

| Task | 主な責務 | 必ず含める既存制約の変更 | 依存 |
| --- | --- | --- | --- |
| 1 | デザイントークンと共通ウィザード部品 | 現行カラートークン、ボタン、focus、contrast testを本設計の値へ更新する。既存安全表示の文字/roleと、wizard操作44px、カード角丸・shadowを回帰契約に含める。 | なし |
| 2 | 家族設定状態とAI同意の分離 | `profiles.onboarding_status` と完了時刻のCHECKへ `skipped` を追加し、`set_onboarding_status` のprofile row lock、冪等再送、状態遷移、プライバシー同意結合を変更する。家族完了→profile完了→遷移の順序、生成型、household query、privacy画面、pgTAP/raceを更新する。このTaskではまだ主要ルートのガードを外さない。 | Task 1 |
| 3 | `TargetMode`、人数、保存スキーマ | 共有Zod契約、nullableな下書き、mode条件付きnullableな凍結人数、`menus.target_mode` を追加する。`menus.servings`、snapshot、fingerprintはNOT NULLを維持し、アレルゲン版・年齢別ルール版だけをモード条件付きnullableへ変更する。`save_generation_draft`と現行v1 household予約・完了を中間schemaへ追随させ、Task単独で既存生成を維持する。 | Task 2 |
| 4 | 生成コマンドv2とlegacy移行 | `request_hmac_version` のDB CHECKと予約RPCのv1固定検査をv1回収・v2新規予約へ変更する。owner複合FK、1〜20/空/重複なし制約を持つrequest-bound immutable snapshotを追加する。kind/mode別integrity union、HMAC、既存v1 replay、処理中v1、generation machineのterminalな型付きupdate-required、端末pendingを実装する。owner-bound claim/tombstoneはuser lockと32件/8件rate上限を持ち、HTTP 200の厳密なmigration redirect wireで遅延v1を同じv2 keyへ収束させ、mappingをAI requestより短く保持しない。 | Task 3 |
| 5 | アイデアモードのサーバー境界 | 予約、コンテキスト、prompt、再生成adapter、出力検証、専用idea fingerprint helper、完了RPC、人数一致、家族canary非送信を実装する。軽量identity queryをfull aggregateから分け、create/reconcileのreplay-firstを維持し、買い物RPC/HTTP/serviceの全writerをactive-list→source→昇順safety lockへ統一する。既存list revalidateと直接menu revalidationを含め、家族query・shopping safety・全writeより前にideaを用途別の安定codeで拒否する。 | Task 4 |
| 6 | `/welcome`、献立作成ウィザード、最小結果・履歴境界 | 開始画面、4質問、アイデア人数、生成前確認、実入力単位のfield error関連付け、追加条件、同意往復、古い空対象下書きの対象ステップ再開を実装する。Task 5のサーバー経路が利用可能になってから `RequireCompletedOnboarding` を主要ルートから外す。同じTaskでidea結果と履歴一覧・詳細のmode-aware read-only境界、常時注意、家族/買い物hookの非mountと全shopping request/storage不在、許可操作の非表示を実装し、安全に本文を閲覧できる状態まで完成させる。 | Task 5 |
| 7 | 結果、履歴、再生成の完全なモード対応 | Task 6の履歴badgeとmode別read-only境界を維持し、idea結果・詳細の採用・お気に入り・許可する冷蔵庫操作、`child_friendly` 拒否、モード維持再生成を有効化する。結果・履歴・再生成後も買い物UI/HTTP/pending/storageを不在にし、単体・コンポーネント・E2Eを両モードへ拡張する。 | Task 6 |
| 8 | セキュリティ統合・全体回帰 | canary、矛盾payload、人数改変、v1/v2競合とmigration rate、shopping RPC/HTTP/service/browser、source削除後replay、全cross-RPC deadlock race、通信復帰、320px、44px、field error accessibilityを統合検証し、`AGENTS.md` の9段階gateを完走する。 | Task 7 |

Task 2〜5はDBマイグレーションを伴う。各Taskでマイグレーション、生成型、pgTAP、対象TypeScriptを同じcommit系列に揃え、中間状態を次Taskの暗黙前提にしない。Task 6でidea生成を利用者へ公開するときは、同じTask内で最小結果と履歴read-only境界まで実装し、注意表示や家族再検証回避をTask 7へ先送りしない。各Taskは既存の家族モードを回帰させず、Task 5以降は家族モードとアイデアモードの両方を検証してから次へ進む。
