# プライバシーを守る収益計測設計

- 日付: 2026-08-11
- 状態: **技術再レビュー待ち・人間承認待ち**
- 対象: 無料ユーザー収益化 Phase 0A
- 前提: [無料ユーザー収益化 — AdSense 見送り後の比較判断記録](./2026-08-09-free-tier-monetization-decision.md)
- 種別: 設計。**本書だけでは実装、計測開始、Plus 申込解放を行わない**

---

## 1. 結論

収益計測は、第三者 analytics SDK を入れず、次の 3 層を分離した first-party 構成とする。

1. **利用者が任意で許可する導線計測**
   - Plus CTA の表示・選択、Plus LP 表示だけを扱う。
   - 専用の任意同意を既定 off で設け、AI 送信同意や匿名共有同意を流用しない。
   - 認証済み Function が閉じた列挙値だけを受け、世代付き同意ゲートと同一 transaction で
     短期個票へ記録する。
2. **サービス運用上のサーバー正本**
   - Free 上限、Checkout、Stripe の支払い状態、OpenRouter の実原価を対象 Function、DB、
     Stripe、OpenRouter から取得する。
   - クライアント申告を売上、原価、quota、契約状態の正本にしない。
3. **判断用の非識別集計**
   - 日次・surface・cohort・variant 単位の件数と金額だけを `private` に保持する。
   - 個人別の行動列、メール、氏名、家族情報、献立条件、URL、prompt、生 AI 出力を含めない。
   - 少数セルを抑制した集計だけを人間が閲覧する。

Phase 0B では申込停止を維持し、任意同意者の CTA / LP シグナルと、全体の AI 原価だけを
観測する。Checkout 開始率、試用、有料転換、継続は Phase 1B の限定 pilot で初めて評価する。

## 2. 目的と対象外

### 2.1 目的

- 導線ごとの Plus 関心を、母集団と重複除外単位を固定して比較できる。
- Stripe の売上・返金等と OpenRouter の実原価を、クライアント申告なしで集計できる。
- billing operational data と analytics 出力を技術的・権限的・保持期間上も分離する。
- 同意撤回、アカウント削除、内部利用、テスト traffic、再送を扱える。
- 限定 pilot の解放・再閉鎖判断に必要な測定能力を先に検証できる。

### 2.2 対象外

- `PLUS_LP_UPGRADE_COMING_SOON` または `BILLING_ENABLED` の変更。
- チラシ UI フラグの変更、Plus の価格・quota・trial 日数の変更。
- Plus CTA、LP、設定画面の新しい訴求内容や配置。
- 第三者 analytics、広告タグ、計測ピクセル、fingerprinting。
- Amazon / 楽天の成果報酬計測。
- 経営 KPI の合格閾値、販売主体、税務、返金方針の決定。
- 生のイベントを閲覧する管理画面。

## 3. 不変条件

1. 氏名、メール、Auth user ID、家族・アレルギー情報、献立条件、買い物項目、自由文、
   prompt、生 AI 出力を analytics 出力に含めない。
2. 完全な URL、query string、referrer、User-Agent、IP アドレスをイベント payload または
   analytics DB に保存しない。
3. Stripe Customer / Subscription / Invoice / Charge ID、OpenRouter generation ID、内部 request
   ID は operational data にだけ置き、analytics 集計へ出さない。
4. browser は `private` 表、横断集計、原価、売上へ直接アクセスしない。
5. `private` 表は `public` / `anon` / `authenticated` / `service_role` の直接 CRUD を剥奪し、
   固定 `search_path` の最小 RPC だけを許可する。
6. client event は参考指標に限る。売上、原価、quota、trial、paid、返金、chargeback は
   サーバーまたは外部サービスの正本だけで確定する。
7. 集計単位と帰属窓を後から都合よく変更しない。変更時は measurement version を上げ、
   旧版と混ぜない。
8. Plus 申込停止中の Phase 0B で checkout 開始率や転換率を算出しない。
9. consent が無い利用者について、新しい個人別導線イベントを作成しない。全 Free 利用者の
   hard-limit 件数は count 遷移時に直接更新する非識別 daily aggregate から取得し、帰属用個票は
   同意者だけに作る。
10. 表示回数を増やすために CTA を意図的に再 mount したり、同意を Plus 利用の条件にしない。

## 4. 用語とデータ分類

| 分類 | 例 | 個人との対応 | 用途 | 出力可否 |
| --- | --- | --- | --- | --- |
| billing operational data | customer/subscription/invoice、契約状態、返金 | あり | 課金、権益、会計照合 | analytics へ ID を出さない |
| measurement consent | user ID、同意版、同意・撤回時刻 | あり | 任意計測の可否 | 本人と運用者のみ |
| short-lived measurement row | measurement subject ID、event、surface、時刻 | 同意行を介して対応可能 | 重複除外、帰属 | 生の閲覧を通常運用にしない |
| pilot membership | user ID、cohort、variant、開始・成熟時刻 | あり | 限定対象の安定割当・提供 | operational data として限定 |
| cost operational data | request/generation ID、目的、実費 | 間接対応し得る | 原価照合、再取得 | ID は集計へ出さない |
| analytics output | 日次、surface、variant、件数、金額 | なし | 意思決定 | 少数セル抑制後のみ閲覧 |

短期個票の `measurement_subject_id` は同意行が発行する random UUID とし、browser へ返さない。
同意行は Auth user ID と対応するため匿名ではない。イベント行は subject ID と consent generation
を持ち、同意行への外部キーで cascade できるようにする。HMAC subject は、鍵 rotation と削除を
両立させるための対応表または旧鍵 ring が必要となり、ここではプライバシー上の実益より削除漏れ
の危険が大きいため採用しない。

## 5. 同意と利用者向け説明

### 5.1 同意方式

- 導線計測には専用の任意同意を用意し、既定は off とする。
- AI 送信同意、匿名共有同意、利用規約同意を導線計測の同意として扱わない。
- 同意しなくても Free / Plus の機能、申込、解約、問い合わせを同条件で利用できる。
- 同意は設定からいつでも撤回できる。撤回後の client event は拒否し、短期個票を削除する。
- 同意中であることを証明する状態・同意版・accepted 時刻は同意が有効な間保持する。通常撤回後の
  consent row は最大 35 日で削除でき、row 欠落は未同意として扱う。account deletion の terminal
  block は Auth delete まで保持する。
- 集計済みで個人と対応しない数値は、撤回・アカウント削除後も残る。
- server-authoritative な課金処理、不正利用防止、障害対応、会計・原価照合は導線計測同意と
  分離する。必要性と保持はプライバシー説明に明記する。

### 5.2 提案する固定コピー

同意見出し:

> 利用状況の計測（任意）

本文:

> Plus の案内をより分かりやすくするため、案内が表示された回数、選ばれた回数、Plus の
> 説明画面が開かれた回数と、無料の 1 日上限に達した日時を計測してよいですか？ 献立の内容、
> 家族設定、氏名、メールアドレスは計測しません。重複を除くため、これらの操作記録と上限到達日時は
> アカウントと対応できる状態で最長 35 日間保存し、その後は個人と対応しない集計だけを残します。
> 同意しなくても使える機能は変わらず、設定からいつでも止められます。同意している間は、設定を
> 反映するために同意状態と同意した日時を保存します。停止後の同意記録は最長 35 日で削除します。

チェックラベル:

> Plus の案内の利用状況を計測してよい

撤回時の説明:

> 計測を止めると、これからの案内操作は記録しません。個人と対応しない集計済みの数字は
> 残ります。

上記は Phase 0B の固定コピーとし、同意版は `2026-08-11.v2` を維持する。

Phase 1B で Checkout 帰属を始める前に、別 notice `2026-08-11.v3` を人間承認し、v2 同意者を含めて再同意を
取得する。v3 の本文は次に固定する。

> Plus の案内をより分かりやすくするため、案内が表示された回数、選ばれた回数、Plus の
> 説明画面が開かれた回数、無料の 1 日上限に達した日時と、Plus のお支払い画面を準備したこと
> （申込準備日時）を計測してよいですか？ 献立の内容、家族設定、氏名、メールアドレスは計測しません。
> 重複を除くため、これらの操作記録、上限到達日時、申込準備日時はアカウントと対応できる状態で
> 最長 35 日間保存し、その後は個人と対応しない集計だけを残します。同意しなくても使える機能は変わらず、
> 設定からいつでも止められます。同意している間は、設定を反映するために同意状態と同意した日時を
> 保存します。停止後の同意記録は最長 35 日で削除します。

v2 は Phase 0B client funnel / hard-limit 帰属だけに有効で、Checkout 帰属の根拠にしない。文言、目的、項目、
第三者送信、保持のどれかを広げる場合はさらに版を上げ、再同意なしに新目的へ利用しない。

## 6. イベントモデル

### 6.1 event 別 envelope

client event の request は共通 base と event ごとの閉じた discriminated union にする。

| event | 必須項目 | 禁止・サーバー決定 |
| --- | --- | --- |
| `plus_cta_exposed` | `eventId`、`event`、CTA `surface`、`measurementVersion` | `plus_lp_direct` は禁止。variant はサーバーが決定 |
| `plus_cta_selected` | `eventId`、`event`、CTA `surface`、`measurementVersion` | `plus_lp_direct` は禁止。variant はサーバーが決定 |
| `plus_lp_view` | `eventId`、`event`、`measurementVersion` | source surface と variant はサーバーが決定 |

`eventId` は browser の `crypto.randomUUID()` が 1 操作ごとに生成する canonical UUID v4 とし、再送冪等性だけに
使う。Function の strict Zod schema は UUID v4 と unknown key を検査し、text、oversized、非 v4 UUID を DB / RPC
到達前に closed 4xx で拒否する。DB / RPC の `event_id` は text ではなく `uuid` 型とし、version nibble 4 と RFC
variant も検証する。CTA の表示と選択を結ぶ唯一の authority は
`(measurement_subject_id, consent_generation, measurement_version, surface, JST day)` の canonical tuple であり、
browser-generated exposure identifier は wire contract に持たない。LP ingest は同じ subject / generation /
measurement version の selected を server-side で検索し、帰属候補がなければ source surface を
`plus_lp_direct` とする。

Phase 0B の variant は `control_v1` だけを許可する。client payload から variant を受けず、server が active
measurement version と検証済み surface の exact mapping から `control_v1` を付与する。canonical exposure の
variant を authority とし、selected と帰属 LP はそこから継承する。direct LP も active version と
`plus_lp_direct` から server が `control_v1` を付与する。将来複数 variant を導入する場合は、server-side の
stable user assignment を別設計で定義し、measurement version の更新と人間の再承認を終えるまで開始しない。

時刻、user、plan、environment、同意状態、consent generation は request を信頼せずサーバーで
付与する。任意の metadata、URL、referrer、page title、campaign、自由文は受けない。未知キーは
strict schema で拒否する。

### 6.2 イベント

| event | 発生元 | 正本性 | Phase | 定義 |
| --- | --- | --- | --- | --- |
| `plus_cta_exposed` | client | 参考 | 0B | 許可 surface の CTA が描画された |
| `plus_cta_selected` | client | 参考 | 0B | 同じ canonical tuple の CTA 主操作を選択 |
| `plus_lp_view` | client | 参考 | 0B | `/plus` の full view が描画され h1 が表示 |
| `consenting_hard_limit_reached` | server | 帰属用 | 0B | 同意中の Free identity が success / attempt limit へ初めて到達した server event |
| `free_hard_limit_aggregate` | quota count transition | 正本集計 | 0B | limit 到達遷移から非識別 daily aggregate を直接更新 |
| `limit_exceeded_rejection` | server | 運用 | 0B | limit 到達後に拒否した request。reach KPI の代用にしない |
| `checkout_ready` | server | 正本 | 1B | Session bind と server-side Stripe URL 検証後の operational ready。率への帰属は accepted v3 短期行だけ |
| `trial_started` | Stripe webhook | 正本 | 1B | allowlist price の subscription が初めて `trialing` 投影 |
| `paid_started` | Stripe webhook | 正本 | 1B | 正の金額の初回 invoice paid を確認 |
| `subscription_renewed` | Stripe webhook | 正本 | 1C | 初回以外の正の金額の invoice paid を確認 |
| `refund_recorded` | Stripe / 会計照合 | 正本 | 1B | refund の確定額を確認 |
| `chargeback_recorded` | Stripe / 会計照合 | 正本 | 1B | dispute による控除額を確認 |
| `ai_cost_recorded` | OpenRouter response/reconcile | 正本 | 0B | 実 call の provider cost を確定 |

`session_bound` は補償処理用 operational state で KPI にしない。`checkout_ready` は URL 検証後、
成功ログと同じ境界で一度だけ記録する。応答が端末へ届いたことまでは保証しないため、レポート名も
「Checkout 準備数」とし「Stripe 画面到達数」と呼ばない。
`checkout.session.completed` は Checkout 完了の運用事実として扱えるが、paid の代用にはしない。
trial 終了後の有料開始は正の金額の invoice paid を正とする。subscription の `active` だけで
売上を確定しない。

### 6.3 surface

Phase 0B で許可する surface は次だけとし、異なる surface の率を合算しない。

| surface | 場所 | 主な eligibility |
| --- | --- | --- |
| `planner_hard_limit` | planner review の上限到達 CTA | Free、client funnel だけ |
| `generation_hard_limit` | generation status の上限 CTA | Free、client funnel だけ |
| `regeneration_hard_limit` | 再生成 sheet の上限 CTA | Free、client funnel だけ |
| `planner_quality_lock` | 「くわしく作る」のロック案内 | Free、quality 非利用 |
| `planner_flyer_lock` | チラシ週間献立の locked preview | Free、UI flag 有効時だけ |
| `menu_flyer_upsell` | 献立成功後の週次 banner | Free、UI flag 有効時だけ |
| `settings_plan` | 設定のプラン節 | Free、billing surface open |
| `plus_lp_direct` | CTA 帰属がない `/plus` 表示 | 認証済み Free |

将来の常設リンク、welcome、通知、メール等は新しい surface として設計・承認する。既存
surface の別名に押し込まない。

client が送る surface は実際の DOM を証明できないため、正本ではなく `client_surface_claim` と
扱う。サーバーは次の許可行列と eligibility を検査し、1 user / surface / JST day の上限を越えて
集計へ寄与させない。

- `plus_cta_exposed | plus_cta_selected`: `plus_lp_direct` 以外の CTA surface。
- `plus_lp_view`: CTA exposure に帰属する元 surface、または `plus_lp_direct`。
- hard-limit CTA surface は client の presentation claim であり、canonical CTA exposed / selected → LP
  funnel にだけ使う。server hard-limit reach へ surface を帰属させない。
- quality surface: Free かつ quality 非提供の場合だけ受理。
- flyer surface: Free かつ `FLYER_WEEKLY_UI_ENABLED` が true の release だけ受理。
- settings / direct LP: entitlement が Free であることを再確認する。

許可 enum を正しく送る悪意ある client を完全には判別できない。影響は authenticated user-day
1 件へ上限化し、client event は参考値のままとする。

## 7. eligibility、重複除外、帰属

### 7.1 共通 eligibility

- production の認証済みユーザーである。
- entitlement のサーバー正本が Free である。読取不能時は client funnel の母集団へ入れない。
- client event は現行版の任意同意が有効である。
- surface 固有条件をサーバーが再確認できる場合は再確認する。できない表示イベントは
  `client_reference` と明示する。
- private の internal account exclusion、preview/deploy preview、local、E2E を除外する。

### 7.2 集計単位

- CTA exposure は `measurement_subject_id × consent_generation × measurement_version × surface × JST day` の unique
  件数とする。この tuple が唯一の authority であり、同一 user-day の再 mount は同じ canonical exposure と
  して扱う。
- CTA selected は canonical exposure の `selected_at` が初めて設定された 1 件とする。exposure
  ingest が欠けていても実際に選択された CTA は表示済みなので、selected RPC が exposure と
  selected を同一 transaction で作る。したがって selected は必ず exposed の部分集合になる。
- 全 client event の replay guard 一意キーは `private.revenue_measurement_event_dedupes` の
  `(measurement_version, event_id)`、KPI の一意キーは上記 canonical exposure とし、同じ制約へ
  混在させない。
- ingest RPC は consent row を `FOR UPDATE` して同一 subject / generation の ingest を直列化し、active
  measurement version と request version の exact 一致を確認する。schema / consent / eligibility 検証を通った
  new event ID は、canonical row が既存でも replay guard へ一度だけ insert し、closed
  `outcome = canonical_noop` を保存して同じ値を返す。この guard は security / idempotency state であり、KPI、
  event count、raw audit count のいずれにも加算しない。新しい canonical row を作る場合は
  `outcome = recorded` の guard と canonical row を同一 transaction で insert する。同じ event ID / event kind
  の再送は `duplicate_event_id`、同じ ID の別 event kind は `event_id_kind_conflict` とし、guard を増やさない。
  返却値はこの 4 値だけの closed enum とし、自由文理由を返さない。selected の canonical 既存判定は
  `selected_at IS NOT NULL` とし、exposure row が既存でも `selected_at IS NULL` なら新しい selected として
  dedupe insert と `selected_at` 更新を同一 transaction で行う。selected 受信時に canonical exposure row が
  なければ、同じ tuple の exposed row 作成、selected 設定、dedupe insert を同一 transaction で行う。exposed
  応答喪失、再 mount、新 event ID、exposed / selected の並行実行でも browser ID の対応付けを行わない。
- LP 表示は `measurement_subject_id × consent_generation × measurement_version × source_surface × JST day` の unique
  件数とする。複数 CTA 候補がある場合は、LP 受信時刻より前で最も新しい selected を 1 件だけ
  exact same measurement version 内で選び、同時刻なら server sequence の大きい方を正とする。
- hard-limit reach の `limit_kind` は `success | attempt` の閉じた enum とし、同じ user-day で両方へ
  到達した場合も別件として保存・報告する。合算 KPI は作らない。
- 全利用者の Free 母集団分類は、`private.ai_generation_requests` に quota 判定時点で書かれた
  server-owned immutable snapshot を正本とする。hard-limit 件数自体は後述の count 遷移から更新する
  非識別 daily aggregate を正本にする。Free の exact tuple は現行列名で
  `quota_success_limit = 3`、`quota_attempt_limit = 6`、`quota_short_limit = 4` とし、この tuple が
  一致する request だけを Free と分類する。新しい `plan_snapshot` 列は設けず、identity 日次台帳
  単独からも推定しない。
- plan を日中に変更した identity は request ごとの snapshot で分類し、Free snapshot の request
  だけを Free active / hard-limit の候補にする。internal account、production 以外、E2E / test の
  除外を distinct 集計より先に適用する。
- hard-limit reach は超過拒否ではなく、identity / JST day / limit kind の server-authoritative な
  初回到達とする。success は mark-success transaction の count 遷移後に
  `success_count = quota_success_limit` となった時刻、attempt は独立 provider attempt 設計の
  service-role 送信開始 RPC の count 遷移後に `sent_count = quota_attempt_limit` となった時刻を
  event time とする。
- lock 済み count が limit - 1 から limit へ遷移した場合だけ reach とする。request snapshot が Free exact
  tuple `3 / 6 / 4`、`measurement_environment = production`、`traffic_class = external`、かつ
  `revenue_measurement_version` が観測対象版であることを同じ server 境界で確認する。
- 条件を満たす場合は、success なら既存 `user_usage_day`、attempt なら既存 `user_attempt_day` を usage day
  とし、usage day / limit kind / measurement version その他の閉じた非識別 dimension を持つ daily
  aggregate へ identity-day reach count 1 を原子的 UPSERT する。attempt 側は送信開始 RPC 内の隔離された
  measurement subtransaction で行う。user、identity、request、実 event timestamp は aggregate へ
  保存しない。event が JST 日境界を越えても、server event day ではなく quota usage day へ計上する。
- request や他の未同意者個票へ analytics reach 属性を追加しない。3 回目の成功は後続 request がなくても
  success reach であり、6 回目の外部送信はその後 provider failure / timeout / validation failure に
  なっても attempt reach である。Free から Plus へ同日変更した後の Plus limit 到達は Free exact tuple で
  ないため対象外とする。
- `failure_code = user_daily_limit | user_attempt_limit` の超過拒否は別の運用 KPI
  `limit_exceeded_rejection` として集計し、reach の event time、件数、帰属の代用にしない。
  short-window 拒否も別運用件数とし、hard-limit reach KPI に含めない。
- 全体 hard-limit 件数の正本はこの非識別 daily aggregate とする。同意が accepted なら、同じ count 遷移を
  起点に consent row を lock し、同意者用 `private.revenue_measurement_hard_limits` へ subject / generation、
  measurement version、usage day、limit kind、actual server event time、event 時点 cohort snapshot だけを 35 日
  短期保存する。
  request ID は保存せず、未同意者には個票を作らない。同意 funnel の正本はこの同意短期行とし、全体
  aggregate から同意帰属を再構成しない。
- quota core の count 遷移を measurement 失敗で rollback しない。measurement UPSERT / consent 短期 insert は
  明示的な例外隔離境界で実行し、失敗時は core 成功を維持したまま manifest へ closed failure reason を
  設定し、安全な closed code だけを log して当該観測窓を invalid にする。RPC retry では core count 遷移が
  再発しないため aggregate を再加算しない。
- reach 発生時点の UI presentation surface は server から安全に決定できないため、server KPI の
  surface は closed sentinel `none` とする。request kind、呼出元、後続画面から planner / generation /
  regeneration surface を推定しない。hard-limit 短期表が surface を持たないのはこのためである。
- Checkout は Stripe Session URL 検証後の durable operational ready fact を Session ごとに 1 回とする。
  consent attribution は accepted v3 / same generation / exact measurement version / same pilot / 24 時間 LP を
  満たす 35 日短期 row だけを率へ使い、未同意を含む全 operational ready 件数は別に残す。
- Stripe event は既存 webhook event ID の冪等性を利用し、invoice / refund / dispute ごとの
  一意 ID でも二重計上を防ぐ。
- 外部 AI call は送信前に server が UUID の `provider_attempt_id` を発行して追跡する。actual-call
  completeness 母数、billed cost 分子、unreconciled の扱いは§10.1 の全 state matrix だけを正とする。詳細は
  [provider attempt の at-most-once 化と quota lock 順統一](./2026-08-11-provider-attempt-quota-lock-design.md)
  を正とする。repair / retry も physical call ごとに別 attempt として親 request の用途へ配賦する。

unique 件数と延べ件数を混在させない。Phase 0 の CTA KPI は unique 件数だけを正とする。
client ingest は offline queue へ永続化しない。同じ event ID の in-memory retry は最初の試行から
10 分以内だけ許可し、canonical exposure の selected は exposed から 30 分以内だけ受理する。
古い再送は closed code で拒否する。新しい event ID による同日再送は
`canonical_noop` guard として保存するが、KPI、event count、raw audit count へ追加しない。guard 自体は
per-user / JST day ingest cap に含める。

### 7.3 帰属窓

- `CTA → LP`: 同じ measurement subject / generation / measurement version で CTA 選択後 30 分以内の最初の
  LP 表示。
- `hard limit → LP`: surface-independent に、同じ consent subject / generation / measurement version / limit kind で
  hard-limit reach 後 30 分以内の最初の LP 表示。overall を limit kind ごとにだけ報告し、
  presentation surface 別へ分解しない。全利用者の非識別 hard-limit 集計を分母に使わない。
- `LP → checkout_ready`: 同じ pilot membership、accepted v3 consent generation、measurement version の eligible
  LP 表示後 24 時間以内の最初の Checkout。ready transaction 時点で同じ v3 同意世代と version が有効な場合だけ
  率の分子へ帰属する。
- `trial_started → paid_started`: 同じ allowlist subscription の初回の正額 invoice paid。
- 帰属窓を越えた LP / Checkout は `direct_or_unattributed` として残し、直前イベントへ
  無理に帰属させない。

client clock は帰属に使わず、Function の受信時刻と Stripe event created を使う。Stripe の
遅延・順不同は既存 webhook の event ID / created / subscription 投影規則を維持する。
帰属した分子は source event の JST day / cohort へ計上し、LP や Checkout が日をまたいでも
destination day の分母へ混ぜない。direct / unattributed は destination event day へ計上する。

## 8. cohort と成熟条件

### 8.1 cohort

- Phase 0B: 各短期 event 受理時に active consent row の `accepted_at` から JST 週（月曜始まり）を導出し、
  `consent_cohort_week` として event へ server snapshot する。active consent proof と analytics event cohort を
  分離し、consent row 自体を 35 日で消す cohort 行として扱わない。
- Phase 1B: pilot 登録時の JST 週と固定 `pilot_variant` を cohort とする。
- 月額と年額、trial あり・なしを分ける。
- surface は cohort の代用にせず、別 dimension とする。
- user ID や measurement subject ID を analytics output の cohort key にしない。

### 8.2 成熟条件

| 指標 | 成熟条件 |
| --- | --- |
| CTA 選択率 / LP 到達率 | 対象 JST day の終了から 48 時間経過し、遅延 ingest が完了 |
| checkout 開始率 | 帰属対象 LP 表示から 24 時間 + ingest 48 時間経過 |
| 有料転換率 | trial end から 14 日経過、または paid / canceled / unpaid の終端を確認 |
| 月額継続 | 初回 paid 後 35 日経過し、2 回目の正額 invoice paid または終端を確認 |
| 年額継続 | 初回 paid 後 400 日経過し、更新 invoice paid または終端を確認 |
| 返金・chargeback | 対象月末から 180 日後の provisional close まで待つ。後発分は次期 correction |

年額 cohort が成熟する前に、年額継続率を月額と合算したり一般化しない。

### 8.3 Phase 0B 観測条件

人間承認に用いる提案値を次で固定する。変更する場合は観測開始前に本書を改訂し、途中の値を
混ぜない。

- production の同一 measurement version を **連続 21 mature JST days** 観測する。各日は JST day
  終了から 48 時間経過後に mature とし、21 日の途中で定義や版を変更した場合は最初から数え直す。
- 観測開始時に§11.4 の observation window manifest を `active` で作成し、request reserve 時の server-owned
  `revenue_measurement_version` がその manifest version と一致する row だけを対象にする。未稼働時・
  migration 前の `none` / `unknown` は除外する。report は manifest が `complete` の窓だけを読む。
- この窓は現行 `ai_generation_requests` の 30 日保持に明示的に依存する。mature した日を日次で
  materialize し、21 日期間の coverage / hard-limit snapshot は最古 source row が 28 日齢に達する
  前に完了させる。28 日齢で未完了なら Phase 1A を停止する。30 日到達時は既存 cleanup を予定どおり
  実行し、source row を延長保持しない。必要 snapshot が未完了のまま source を失った場合、その
  measurement version の当該観測窓を `invalid` として判断利用せず、連続 21 mature days を最初から
  再観測する。既存の 30 日保持 lock 自体は変更しない。
- reach aggregate、client snapshot、watermark の measurement write failure は manifest を terminal な
  `invalid` へ遷移させる。invalid window は後から complete へ戻さず、最後に対象とした usage day で effective
  end を terminal 固定する。同じ version の重複期間を作らず、その翌日以降から新しい window を作って
  連続 21 mature days を再観測する。各 request / aggregate は usage day で一意の window へだけ所属する。
- §7.2 の server-owned immutable request snapshot で Free exact tuple を持つ活動 request の
  `user_id` を、internal / test 除外後に期間 distinct した集合を `free_active_user` とし、観測母集団と
  する。identity 日次台帳だけでは分類せず、新しい非同意個票は作らない。
- coverage の分母は、同じ連続 21 mature JST days 内に Free exact tuple の活動 request を持つ
  `user_id distinct` とする。分子はその集合と、同期間に CTA / LP 計測行を持つ active consent の
  `user_id` の積集合を `user_id distinct` で数える。request と consent の join と distinct count は
  raw が残る間の materialize transaction 内だけで行い、集計後の snapshot には subject、user、identity
  の link を残さない。Plus snapshot だけの user や生成活動のない consenting user を分子へ入れない。
  これは同意率ではなく、導線計測で観測できた active population の下限である。
- Phase 1A の需要シグナルに使用する最低条件は、coverage 20%以上、consenting Free active user 100 以上、
  対象 surface ごとの exposed subject 30 以上とする。満たさない surface は参考表示もしない。
- client ingest failure 1%以下、cost `unreconciled` 1%以下、internal / test 混入 0、帰属対象
  selected の unattributed 20%以下を提案上限とする。
- 任意同意による selection bias は消えないため、上記を満たしても全 Free ユーザーの転換率とは
  呼ばない。Phase 1A は需要シグナル、採算、法務・運用条件を合わせて人間が判断する。

## 9. KPI 定義

各 KPI で適用可能な measurement version、eligibility、cohort、interval、variant、観測期間を揃える。
surface-dependent client funnel は同じ surface に揃え、surface-independent な server KPI は closed
sentinel `none` を使う。適用不能な dimension を presentation 情報から推定しない。

### 9.1 Phase 0B

- `CTA 選択率 = selected となった canonical exposure ÷ canonical exposure`
- `CTA 後 LP 到達率 = CTA に 30 分以内で帰属した unique LP view ÷ unique CTA selected`
- `上限到達後 LP 到達率 = 同意者の hard limit に 30 分以内で帰属した unique LP view ÷ 同じ
  event-snapshotted consent cohort / limit kind の unique consenting hard limit reached`。surface は
  両辺とも `none` とし、overall by limit kind だけを算出する。
- `measurement coverage = 同じ連続 21 mature JST days に Free exact tuple の活動 request を持つ
  user と CTA / LP 行を持つ active consent user の一時 join による積集合 user ID distinct ÷
  同期間の request snapshot 由来 Free active user ID distinct`。join と count は materialize
  transaction 内だけで行い、materialize 後は user / subject / identity link を残さない。
- `Free 基準 AI 原価 / 成功 = allocation_bucket が free_baseline の OpenRouter 実原価 ÷
  success_allocation_bucket が free_baseline の生成成功数`
- `Plus 増分 AI 原価 / 成功 = Plus quota / quality / flyer 増分へ配賦した実原価 ÷
  対応する success_allocation_bucket の生成成功数`

成功分母は§10.3 の immutable `success_allocation_bucket` だけから数える。attempt の原価 bucket、親の plan、
最終 repair purpose から report 時に成功を再分類しない。

measurement coverage を必ず併記し、任意同意者の CTA 率を全ユーザーの率として表示しない。
surface 別 funnel の正本は canonical CTA exposed / selected → LP だけとし、hard-limit reach や
`request_kind` から presentation surface 別 funnel を生成しない。

### 9.2 Phase 1B 以降

- `Checkout 準備率 = 同じ pilot・accepted v3 consent generation・measurement version の eligible LP view から
  24 時間以内に帰属した checkout_ready membership 数 ÷ 同じ pilot・同じ v3 generation・version の eligible LP view
  membership 数`。全 checkout_ready、unattributed checkout、未同意または別 generation の Checkout
  は別件数で報告し、この率の分子へ混ぜない。
- `有料転換率 = 成熟した trial_started subscription のうち paid_started となった数 ÷ 成熟した trial_started 数`
- `月額継続率 = 成熟した monthly paid cohort の subscription_renewed 数 ÷ 同 cohort の paid_started 数`
- `年額継続率 = 成熟した yearly paid cohort の更新数 ÷ 同 cohort の paid_started 数`
- `cash gross（税込） = Stripe の正額 invoice paid の amount_paid 合計`
- `recognized revenue（税抜） = invoice line の税抜額を service period の暦日数で日割りした合計`
- `refund / chargeback = Stripe / 会計正本の確定控除額合計`
- `cash net = cash gross − cash refund / dispute movement − Stripe の実手数料`
- `recognized Plus contribution = 同一認識期間の税抜 recognized revenue − 実手数料 −
  recognized refund / dispute adjustment − Plus 増分 AI 原価 − 承認済み plus_incremental 配賦費用`
- `cash contribution = cash gross − cash refund / dispute movement − 実手数料 − Plus 増分 AI 原価 −
  承認済み plus_incremental 配賦費用`

表示価格から手数料率を掛けた参考値を実績 net にしない。Stripe の実手数料を取得できない
期間は `net_unavailable` とし、推定値と実績値を混ぜない。月額・年額比較と単位寄与の主比較は
`recognized Plus contribution` とし、cash contribution は資金移動の補助指標として別表示する。

### 9.3 会計・期間按分

- cash gross は支払確定日、cash refund / dispute movement と決済手数料は対応する Stripe balance
  transaction の発生日へ帰属させる。
- invoice は lifecycle / gross の正本、Stripe balance transaction は実 cash movement / fee の
  正本とする。refund / dispute を含む cash 控除は balance transaction ID ごとの signed amount を
  一度だけ ledger 化し、同じ控除を refund と chargeback の両方で二重に引かない。
- 月額・年額の比較と単位寄与には cash gross ではなく税抜 recognized revenue を使う。
- recognized revenue は各 invoice line の `period.start` 以上 `period.end` 未満の暦日へ均等配分し、
  月次 report はその月の日額を合計する。JPY の割り切れない端数は service period 最終日に置く。
- invoice が税額を信頼できる形で返さない場合は `tax_unavailable` とし、税抜単位寄与を算出しない。
  税率や税込表示から逆算しない。
- refund は Stripe で `succeeded` を確認し対応する balance transaction が確定した日、dispute の
  recognized adjustment は lifecycle が `lost` または merchant acceptance で終端した日へ一度だけ
  認識する。dispute 作成時の引落しと `won` 時の返金は cash movement にだけ記録し、終端前は
  recognized contribution を `provisional` とする。`won` は recognized dispute adjustment を 0 とし、
  同じ控除を refund と dispute の両方へ重複計上しない。
- recognized refund / dispute adjustment は credit note または会計正本で税抜額を確認できる場合だけ
  主比較へ含める。確認できなければ `tax_unavailable` として主比較を非算出にする。確定日は cash
  contribution から実 movement を控除し、cohort lifetime contribution にも一度だけ含める。過去月の
  recognized revenue は書き換えず、別の負額 correction row として監査可能にする。
- 月次 recognized report は対象月末から 180 日後に `provisional_close` する。close 後に確定した
  refund / dispute その他の修正は、元月を上書きせず次の open period に correction として一度だけ
  計上し、元の recognition month を参照列で保持する。
- monthly / yearly、trial 有無、currency を別セルとし、異なる認識期間を合算しない。

費用は `ai_variable | payment_fee | shared_recurring | one_time` に分ける。AI と決済手数料は直接
帰属する。Plus により増えた専用監視等の shared recurring は、対象月の Plus external AI call
比率で月内へ一度だけ配賦する。one-time 実装・法務費は 12 か月へ均等償却し、各月内は同じ call
比率で配賦する。既存サービスを Plus の有無にかかわらず維持する共通固定費は増分単位寄与から
控除せず、全体純寄与レポートに別掲する。immutable expense header は
`(source_expense_line_id, recognition_month)` を一意キーとし、allocation version、scope、認識額、通貨を
header ごとに一度だけ固定する。scope と allocation version を unique key へ含めず、同じ source line / month を
scope 違いまたは version 違いで再登録する二重計上を DB で拒否する。bucket share は header 配下の child として
保持し、合計を必ず 1 にする。

共通費・一時費には AI call の `allocation_bucket` と別の closed
`allocation_scope = plus_incremental | whole_service_nonincremental` および
`expense_allocation_bucket = plus_quota_activity | plus_quality_activity | plus_flyer_activity |
plus_unallocated_activity | whole_service_nonincremental` を使う。`plus_incremental` の非 0-call 月は対象
expense header 配下の share 合計を 1 とし、実 call 比率で Plus activity
bucket へ配賦する。

対象月の Plus external AI call が 0 件なら、`allocation_scope = plus_incremental` の shared recurring と
当月認識する one-time だけを expense bucket `plus_unallocated_activity` へ `share = 1` で配賦する。この
bucket は Plus channel total に含めるが生成成功へ割れないため per-success は `not_calculated` とする。
`whole_service_nonincremental` scope は call 数に関係なく同名 bucket だけへ `share = 1` で配賦し、Plus
channel contribution から除外して全体純寄与へ別掲する。AI call の `unallocated` は親・attempt 分類欠落を
示す data-quality blocker であり、正常な 0-call 月の expense `plus_unallocated_activity` と混同しない。
1 枚の invoice を正当に scope 間で分ける場合だけ、会計上区別できる distinct
`source_expense_line_id` と各 line amount を作り、全 line amount 合計が invoice total と一致することを
deferred constraint / close validation で確認する。単一 line の cross-scope 複製で split を表現しない。
レポートは header 認識額を channel total へ一度だけ計上し、bucket 別には `header amount × child share` を使う。
child 件数分だけ header を再加算しない。allocation version は header に固定された exact 値を report dimension へ
引き継ぎ、同じ line を旧版・新版の両方として混在させない。

費用訂正は元 header を上書きせず、元 line と異なる `source_expense_line_id` の signed reversal / correction
header を追加する。各訂正 header は元 line への参照と closed entry kind を持ち、訂正 source ID の unique で一度だけ
計上する。元額、reversal、correction の signed 合計と invoice total / correction 証憑の一致を close 時に検証し、
allocation version 変更を訂正の代用にしない。

## 10. AI 原価

### 10.1 正本

OpenRouter の完了 response に含まれる `usage.cost`（アプリへ請求される総額）を第一取得元とし、
`cost_details.upstream_inference_cost` は請求額の代用にしない。欠落時は generation ID による
metadata API の `total_cost` を再取得し、実装時の現行公式 schema で同じ請求単位であることを
確認する。単位または意味を確認できない値は `unreconciled` とし原価 KPI に入れない。
prompt / completion 内容を返す content API は使用しない。日次合計は OpenRouter Analytics の
`total_usage` と照合する。

保存する operational 項目は次に限定する。

- 送信前に server が発行する UUID `provider_attempt_id`、取得できた generation ID、内部 request ID、
  発生時刻。`provider_attempt_id` は generation ID の有無にかかわらず unique とする。
- 独立設計が確定する `attempt_state`、lease、各 state の server 時刻、deletion / cleanup reconciliation
  marker と closed unreconciled reason。収益計測は state 遷移を再定義せず、後述の state matrix で読む。
- 実 model ID と、次の閉じた `call_purpose`。
  - `menu_primary | menu_repair | dish_primary | dish_repair`
  - `quality_primary | quality_repair | flyer_primary | flyer_repair`
  - `share_primary | share_repair | benchmark | smoke | development_test`
- `free_baseline | plus_quota_increment | plus_quality_increment | plus_flyer_increment |
  community_share | internal_benchmark | internal_operations | development_test | unallocated` の
  `allocation_bucket`。この最終値は Task 5 が次節の一意な導出規則で原価行へ保存し、provider attempt table
  には保存しない。
- provider Task 0A が外部送信前に固定する immutable
  `success_ordinal_snapshot = free_ordinal | plus_ordinal | not_applicable` と
  `attempt_ordinal_snapshot = free_ordinal | plus_ordinal | not_applicable`。
- `parent_kind = generation | flyer_weekly | none`。`none` は share worker、benchmark、smoke、
  development test の親なし call に限定し、nullable parent ID の意味を曖昧にしない。
- provider Task 0A が全 parent kind で固定する immutable
  `measurement_environment = production | preview | test | local`、
  `traffic_class = external | internal | automated_test`、`personal_quota_disabled_snapshot`、
  `revenue_measurement_version`。未稼働 `none` と migration 前 `unknown` は active version へ再分類しない。
- request 開始時の既存 quota exact tuple と、そこから導出した `free | plus` 分類。これは原価行の
  監査用分類であり、`private.ai_generation_requests` へ新しい `plan_snapshot` 列を要求しない。
- prompt / completion / reasoning / cached token の数値。
- provider が返した billed cost、単位、upstream cost（監査用）、取得状態、取得・照合時刻。
- nullable `parent_request_id` UUID は照合用 opaque 値として保存するが、
  `private.ai_generation_requests` への FK を張らない。request の 30 日 cleanup を阻害せず、cost row は 40 日、
  未照合時は最大 90 日の既定保持を独立して満たす。献立本文や失敗 message は保存しない。

attempt state の actual-call completeness 母数、billed cost 分子、cleanup / deletion の扱いは次の表を唯一の
authority とする。report、reconciliation、cleanup、drain、test は同じ表を参照し、別の候補定義を持たない。

| attempt state | completeness 母数 | billed cost 分子 | cleanup / deletion |
| --- | --- | --- | --- |
| `reserved` | 除外 | 除外 | lease 失効後に HTTP 未送信を証明できる場合だけ `void_unsent`。証明前は送信済みと推定しない |
| `void_unsent` | 除外 | 除外 | 未送信 terminal。reservation は一度だけ返却可能 |
| `send_started` | sent-or-uncertain として含める | provider evidence を得るまで非加算、`unreconciled` | 再送・sent quota 返却なし。有界 reconciliation の対象 |
| `ambiguous` | sent-or-uncertain として含める | 推定額を入れず非加算、`unreconciled` | 再送・sent quota 返却なし。有界 reconciliation の対象 |
| `archived_unreconciled` | sent-or-uncertain として含める | 推定額を入れず非加算、`unreconciled` | operational terminal。user / identity link を切離した最小 evidence だけ保持 |
| `response_observed` | actual call として含める | 公式 billed amount を確定できた場合だけ含め、未確定は非加算、`unreconciled` | terminal。metadata / Analytics reconciliation は同 attempt へ冪等適用 |

`unreconciled` は completeness 母数から落とさず、billed cost が 0 だったとの意味にも使わない。cost 分子と
unreconciled 件数 / 比率を必ず別列で報告する。

### 10.2 provider attempt 依存 contract と配賦

provider attempt state machine、at-most-once、quota lock 順、generation / flyer / 親なし call の
reserve・send-start、旧 mark RPC の置換は、独立した
[provider attempt の at-most-once 化と quota lock 順統一](./2026-08-11-provider-attempt-quota-lock-design.md)
を正とする。本書はその成果物を次の contract として利用し、quota core の interface を再定義しない。

1. generation、flyer、share worker、benchmark、smoke、development test を含む全 external provider call
   は、成功・失敗・timeout・invalid response にかかわらず、HTTP 送信前に一意な
   `provider_attempt_id`、call purpose、execution class、parent kind、immutable success / attempt ordinal
   snapshot、environment / traffic / personal quota / revenue measurement version snapshot を持つ。provider Task 0A は
   最終 `allocation_bucket` を持たない。
2. generation 親、`flyer_weekly_requests` 親、親なし worker / benchmark / smoke の各経路が、独立設計の
   対応する reserve・send-start contract を通る。親なし call は user quota を消費しないが、attempt と
   実送信状態を省略しない。
3. 呼出側は send-start transaction の commit 成功応答後だけ HTTP を送る。同じ attempt の再送、
   response loss、lease expiry、ambiguous、`response_observed`、`archived_unreconciled` の解決は独立設計の
   closed state / RPC を正とし、本書の原価処理から送信可否を変更しない。
4. parent request cleanup 後も原価 row が残るよう、nullable parent UUID は非 FK とする。一方で
   `parent_kind` と call purpose により generation、flyer、親なしを閉じて分類する。account deletion では
   attempt state にかかわらず独立設計の detach matrix に従い、保持する attempt / cost 双方から user ID、
   identity key、opaque parent UUID、lookup mapping を原子的に除く。非 FK の parent UUID も必ず null とし、
   immutable classification / measurement version snapshot だけから配賦して user link を再構成しない。
5. Task 5 は独立設計の immutable snapshot と closed classification だけから、次の優先順で最終
   `allocation_bucket` を一意に導出して原価行へ保存する。この mapping は本書を唯一の authority とし、
   provider Task 0A で再定義しない。
6. 第 1 優先として `measurement_environment <> production` は parent kind / purpose / ordinal にかかわらず
   `development_test` とする。第 2 優先として production でも `traffic_class <> external` は、purpose が
   `benchmark` の場合だけ `internal_benchmark`、それ以外は `internal_operations` とする。quota disabled、
   internal account、automated smoke、親付き local / E2E generation・flyer・quality をこの 2 段で先に除外し、
   Free / Plus の cost・success 分子へ入れない。
7. 第 3 優先の production / external だけを purpose / ordinal で分類する。regular generation は、request の
   quota exact tuple が Free なら `free_baseline` とする。Plus regular は
   `success_ordinal_snapshot` と `attempt_ordinal_snapshot` がともに `free_ordinal` の場合だけ
   `free_baseline`、いずれかが `plus_ordinal` なら `plus_quota_increment` とする。`not_applicable`、欠損、
   legacy unknown、矛盾値は `unallocated` とし、推定しない。ordinal の境界と予約時固定規則は独立設計だけを
   正とし、本書では再定義しない。
8. production / external generation の `quality_primary | quality_repair` は ordinal にかかわらず
   `plus_quality_increment`、production / external flyer の `flyer_primary | flyer_repair` は
   `plus_flyer_increment` とする。
   `production_worker` の `share_primary | share_repair` は `community_share`、benchmark / smoke は
   production / external と矛盾するため `unallocated` とする。
9. primary、provider fallback、invalid body 後の repair、retry は physical call ごとに別 attempt とし、
   environment、traffic class、personal quota、call purpose、execution class、parent kind、immutable ordinal
   snapshot から一度だけ配賦する。
10. response header / body を観測した低レベル parser は output validation より先に generation ID と usage
   を抽出し、invalid AI body でも同じ attempt の原価行を残す。reconcile、metadata retry、duplicate
   callback は同じ `provider_attempt_id` を使い、state / cost を二重加算しない。
11. 1 call は 1 allocation bucket だけを持つ。必要な attempt、state、call purpose、execution class、
    parent kind、environment / traffic / personal quota / ordinal snapshot / revenue measurement version の
    いずれかが欠ける場合は AI `unallocated` とし、Phase 1A の停止条件に含める。`none | unknown` version は
    active version の cost / success report へ入れない。

独立設計の Task 0A / 0B migration、全送信経路の切替、旧 RPC の非併用、crash / deadlock integration が完了して
いない間は Phase 0B の観測を開始しない。`provider_attempt_id` または attempt state が不完全な状態を
暫定配賦や推定で補わない。

### 10.3 terminal success の一意な配賦

Task 5 は terminal successful になった eligible parent ごとに、immutable な
`success_allocation_bucket` を exactly one 固定する。closed enum は
`free_baseline | plus_quota_increment | plus_quality_increment | plus_flyer_increment |
internal_benchmark | internal_operations | development_test | unallocated` とする。成功分母の唯一の authority は
この列であり、physical attempt の `allocation_bucket` は原価分子だけの authority とする。1 parent の primary、
fallback、repair、retry の physical cost が複数 bucket に分かれることはあるが、1 terminal success を複数の成功
bucket に数えない。

Task 5 の terminal attribution / materialization transaction は、成功 parent と同じ
`revenue_measurement_version` の関連 attempt 集合を lock 済み正本から解決し、次の優先順を一度だけ適用する。

1. `measurement_environment <> production` は `development_test`。
2. production かつ `traffic_class <> external` は、benchmark purpose の場合だけ `internal_benchmark`、それ以外は
   `internal_operations`。quota-disabled generation は ordinal を使わずこの規則で `internal_operations` となる。
3. production / external の quality generation は `plus_quality_increment`。
4. production / external の flyer success は `plus_flyer_increment`。
5. production / external の regular generation は、関連 physical attempt の
   `attempt_ordinal_snapshot` に `plus_ordinal` が 1 つでもあれば `plus_quota_increment`。全関連 attempt が
   `free_ordinal` で、parent の `success_ordinal_snapshot` も `free_ordinal` の場合だけ `free_baseline`。
6. 関連 attempt が 0 件、version 不一致、`none | unknown`、ordinal / purpose / parent classification の欠損・矛盾、
   または上記で一意に決まらない場合は `unallocated`。推定や多数決を行わない。

share worker / benchmark / smoke / development test の親なし call は generation success 分母を持たず、この表へ
success row を作らない。successful eligible parent ごとの安定した内部 success fact ID と exact
`revenue_measurement_version` を一意キーに含め、retry / materialization 再実行は完全一致なら no-op、不一致なら
`success_allocation_conflict` で fail closed にする。account deletion では user / identity / parent lookup を共通
detach しても、非識別化された success fact ID、version、bucket は report lineage のため保持できる。

日次・期間 report の Free / Plus 成功分母は `success_allocation_bucket` と exact
`revenue_measurement_version` だけを filter する。attempt cost と success の version が一致しない期間、
`unallocated` success、success row 欠損は data-quality blocker とし、別 bucket の分母へ補完しない。

OpenRouter Analytics が返す spend unit を実装直前に確認し、USD と公式に確認できた場合だけ
USD 原価として保持する。JPY 換算は、人間が承認した会計レートの取得元と適用日が決まるまで
行わず、表示価格との混合通貨の単位寄与を算出しない。

## 11. データ構造とアクセス境界

実装 Task では、次の責務を満たす名前・型を migration 作成時に確定する。以下の table / RPC
名は設計上の固定候補であり、generated types は手編集しない。

### 11.1 同意

`private.revenue_measurement_consents`

- `user_id` 主キー、Auth delete に `ON DELETE CASCADE`。random `measurement_subject_id` を unique
  とする。
- `notice_version`、再同意ごとに新規発行する server-generated opaque `consent_generation`、
  `accepted_at`、`revoked_at`、
  `consent_state = accepted | revoked | account_deletion_blocked`、
  `state_reason = user_accept | user_revoke | account_deletion` の閉じた列挙、
  `ingest_blocked_at`、`account_deletion_blocked_at`、`updated_at`。通常 revoke と terminal な
  account deletion を同じ blocked 値だけで表現しない。
- `(measurement_subject_id, consent_generation)` を外部キー参照可能な unique とする。re-accept は
  新しい random subject と新しい generation を発行し、旧世代へ戻さない。revoked row が既に削除済みなら
  fresh row として作成する。accept RPC は `account_deletion_blocked` と
  `account_deletion_blocked_at` を解除できず、terminal state なら closed error で拒否する。
- accept RPC と `block_and_purge_revenue_measurement` RPC は、user UUID から決定論的に導く 2 つの integer key で
  同じ transaction-scoped advisory lock を処理の最初に取得し、その後に consent row を `FOR UPDATE` または
  UPSERT する。hash 衝突は無関係 user の余分な直列化だけを起こし、安全性を弱めない。block RPC は row 欠落
  でも server-generated random subject / generation を持つ `account_deletion_blocked` terminal row を原子的に
  UPSERT し、既存 `accepted | revoked` も terminal へ昇格する。subject / generation は全 state で non-null を
  維持し、accept はこの terminal row を絶対に上書きしない。
- accepted row は active consent state / proof として同意中保持する。通常 revoked row は `revoked_at` から
  最大 35 日で削除でき、row 欠落は未同意とする。`account_deletion_blocked` row は Auth delete まで保持する。
  analytics cohort 保持のために active proof を削除せず、cohort は各短期 event へ snapshot する。
- private table の直接 SELECT / INSERT / UPDATE / DELETE は `PUBLIC`、`anon`、`authenticated`、
  `service_role` から revoke する。本人 read は public schema の authenticated wrapper RPC だけに許可し、
  返却を `measurement_enabled`、`notice_version`、`can_accept` の安全な状態へ限定する。measurement
  subject、consent generation、user ID、block reason、時刻は返さない。
- browser は user JWT で public schema の read / accept / revoke wrapper RPC を呼ぶ。各 wrapper は
  `SECURITY DEFINER`、固定 `search_path`、完全 schema 修飾とし、`PUBLIC` / `anon` から EXECUTE を revoke、
  `authenticated` だけへ EXECUTE を grant する。関数内で `(select auth.uid())` が non-null であることと
  対象 user の ownership を検査し、caller 指定の別 user ID を受けない。private consent 操作は wrapper
  から用途別 private RPC を呼ぶ経路だけに限定する。
- event ingest / 集計 RPC とは権限を分け、analytics 集計 role や browser に横断 SELECT を与えない。
  consent table は private schema にあるため、`public` かつ `user_id` を持つ table を走査する既存 RLS
  inventory の対象外である。inventory を弱めたり例外名を足したりせず、この配置を維持する。

### 11.2 短期個票

`private.revenue_measurement_exposures`

- server-generated internal `canonical_exposure_row_id`、`measurement_subject_id`、`consent_generation`、server
  exposed / selected time、
  `received_at`、`expires_at`、surface、variant、`measurement_version`、`consent_cohort_week`、environment、
  server sequence。internal row ID は browser へ返さず、表示と選択の authority に使わない。
- consent の subject / generation へ外部キーを張り、同意行削除で cascade する。
- KPI は `(measurement_subject_id, consent_generation, measurement_version, surface, jst_day)` を unique とし、
  replay guard の
  event ID は `private.revenue_measurement_event_dedupes` で一意化する。Phase 0B の variant は server が active
  measurement version と surface から exact `control_v1` を付与し、canonical row の値を authority とする。
- selected RPC は consent 行を `FOR UPDATE` で読み、現行 generation・accepted・非 blocked を
  確認してから tuple で canonical exposure を解決し、その `selected_at` を同一 transaction で一度だけ
  設定する。row がなければ exposed row と selected を同じ transaction で作る。

`private.revenue_measurement_lp_views`

- measurement subject / generation / measurement version、server view time、`received_at`、`expires_at`、source surface、
  attributed canonical exposure、server-owned variant、event 時点の `consent_cohort_week`。帰属ありなら
  canonical exposure の variant を継承し、direct LP なら active version + `plus_lp_direct` から導出する。
- `(measurement_subject_id, consent_generation, measurement_version, source_surface, jst_day)` を unique とする。
- 同意確認、帰属候補選択、LP row insert と LP request の event ID dedupe insert を同一 transaction で
  行う。LP の `eventId` は次の dedupe 表へ保存し、LP row の任意列やログへ逃がさない。

`private.revenue_measurement_event_dedupes`

- 全 client event の `measurement_subject_id`、`consent_generation`、`measurement_version`、`event_id`、
  `event_kind`、`outcome = recorded | canonical_noop`、server `received_at`、ingest JST day、`expires_at`、event
  時点の `consent_cohort_week` を持つ。`event_id` は DB / RPC とも `uuid` 型に固定する。
- consent の subject / generation へ外部キーを張り、
  `(measurement_version, event_id)` を unique とする。exposed / selected / LP の各 ingest は consent row
  lock 後、同じ event ID / kind が既存なら `duplicate_event_id`、別 kind なら `event_id_kind_conflict` を返す。
  new ID で canonical が既存なら `canonical_noop` guard を insert し、canonical row / KPI / event count / raw audit
  count は変更しない。canonical も新規なら対応する短期行と `recorded` guard を同一 transaction で insert する。
  返却は `recorded | canonical_noop | duplicate_event_id | event_id_kind_conflict` の closed enum とし、unique
  conflict を成功一般や自由文 error へ潰さない。selected は `selected_at` の null→non-null 遷移を新 canonical
  とみなし、既存 exposure row 自体を重複扱いしない。
- guard は raw 行動監査ではなく security / idempotency state である。`recorded | canonical_noop` の両方を
  subject / generation / version / ingest JST day の per-user/day cap に含め、no-op ID の無制限保存を拒否する。
- 通常 revoke、account purge、Auth delete CASCADE の対象とし、replay guard だけが個票より長く残らない。

`private.revenue_measurement_hard_limits`

- 同意者の hard-limit 帰属専用の短期表とし、measurement subject / consent generation / measurement version、server event
  time、server `received_at`、`expires_at`、quota usage day、`limit_kind = success | attempt`、event 時点の
  `consent_cohort_week` を持つ。request / user / identity ID と surface は持たず、集計では sentinel `none` を
  使う。
- consent の subject / generation へ外部キーを張り、
  `(measurement_subject_id, consent_generation, measurement_version, usage_day, limit_kind)` を unique とする。
- §7.2 の count が limit - 1 から limit へ遷移した境界だけで consent 行を `FOR UPDATE` し、現行 accepted
  generation と非 blocked を再確認して subject / generation、usage day、kind、actual server event time、
  cohort snapshot を insert する。全体集計は同じ遷移が更新した非識別 daily aggregate を使い、この同意表
  や rejection failure code から再構成しない。競合は unique conflict を no-op とする。
- exposure / LP view と同じく 35 日で削除し、通常 revoke、account purge、Auth delete CASCADE の
  すべてで対象 subject / generation 行を消す。

`private.revenue_measurement_checkout_attributions`

- internal `ready_fact_id`、measurement subject / consent generation / measurement version、internal canonical LP row
  ID、pilot membership ID、server ready time / received time、`expires_at` を持つ。Stripe Session ID、URL、user ID、
  customer ID は持たない。
- `(ready_fact_id)` を unique とし、同じ operational ready fact を複数同意世代・version・LP へ帰属させない。
  canonical LP は subject / generation / exact measurement version が一致し、同じ pilot membership で 24 時間以内の
  eligible row だけを許可する。
- consent subject / generation へ外部キーを張り、通常 revoke、account purge、Auth delete で cascade する。
  accepted notice `2026-08-11.v3` 以外では作らず、v2 / 未同意 Checkout は operational ready fact だけを残す。

exposure、LP view、hard-limit、checkout attribution、event replay guard を含む linkable 短期行の `expires_at` は server time の
`received_at + interval '35 days'` またはそれより早い期限とする。短期表は user ID、URL、referrer、
IP、UA、自由 JSON カラムを持たない。ingest request ごとに
長期 aggregate を加算せず、短期行から閉じた期間を materialize するため、再送後の二重加算を
起こさない。`consent_cohort_week` は event 受理時の server snapshot であり、後日の active consent row
削除・re-accept 後に再導出または旧 event へ付け替えない。

`private.revenue_measurement_memberships`

- pilot の安定割当と提供判定だけを保持する billing operational data とする。
- user ID を Auth delete CASCADE で持ち、cohort week、variant、interval、開始・成熟・expiry を
  保存する。行動履歴を入れず、analytics report へ user ID を出さない。

### 11.3 operational 原価・金銭

- `private.ai_generation_requests` は quota 判定時の server-owned immutable
  `quota_success_limit`、`quota_attempt_limit`、`quota_short_limit` と failure code を request ごとに
  保存する。quota 3 列は現行実装の列名をそのまま正本とし、
  `plan_snapshot` という新規列は追加しない。Free active / hard-limit 集計は exact tuple
  `3 / 6 / 4` を使い、後日の entitlement や identity 日次台帳から再分類しない。
- environment / internal exclusion は現行 request 列には存在しない。prerequisite の provider Task 0A migration で
  generation / flyer parent と全 provider attempt に server-owned immutable な固定候補列
  `measurement_environment = production | preview | test | local` と
  `traffic_class = external | internal | automated_test`、`personal_quota_disabled_snapshot` を追加し、各 reserve
  transaction で保存する。caller 値を受けず、parent attempt は parent snapshot を copy する。Phase 0B migration
  は server-owned `revenue_measurement_version` を追加する。計測未稼働時の version は
  `none`、migration 前の既存 row は NULL のまま保って `unknown` として観測対象外にする。後日の internal
  allowlist、deploy metadata、user 状態、稼働 version から再分類しない。
- `personal_quota_disabled = true` の request は、Free exact tuple と一致しても必ず
  `personal_quota_disabled_snapshot = true` かつ `traffic_class = internal` として reserve し、他の traffic
  class を拒否する DB invariant を provider Task 0A で設ける。quota 台帳を
  増やさない request を Free active user、hard-limit、coverage の分母へ入れない。
- request 表には analytics 目的の reach 列や reach 用 index を追加しない。Free hard-limit 全体値は§11.4 の
  非識別 daily aggregate へ count 遷移時に直接 materialize する。
- AI call cost は `private` の専用表に置き、送信前の `provider_attempt_id` を一意にして upsert する。
  generation ID は non-null の場合に追加 unique とする。独立 provider attempt 設計の immutable
  success / attempt ordinal snapshot、environment / traffic / personal quota / revenue measurement version snapshot、
  call purpose、execution class、parent kind、attempt state / lease / unreconciled reason を監査列として保持し、
  Task 5 が§10.1 の
  state matrix と§10.2 の mapping から最終 `allocation_bucket` を一度だけ導出・保存する。
  cost row は attempt の immutable `revenue_measurement_version` をそのまま copy し、provider attempt ID と version
  の組み合わせを lineage / report filter の正本にする。nullable parent request UUID は非 FK とし、request cleanup
  から独立させる。account deletion では独立設計の全 state detach matrix に従い、attempt と cost の user /
  identity / opaque parent / lookup mapping を同じ gate 下で原子的に除去する。
- terminal success の分母は Task 5 が作る専用の immutable success attribution fact に置く。stable internal
  success fact ID、parent kind、nullable opaque parent UUID、`revenue_measurement_version`、
  `success_allocation_bucket`、terminal success time だけを必要最小限持ち、eligible successful parent ごとに
  `(success_fact_id, revenue_measurement_version)` を unique とする。同じ parent / version の二重 fact は追加 unique
  または materialization conflict check で拒否する。bucket の authority は§10.3 だけとし、日次成功分母はこの
  fact だけを数える。account deletion 後に保持する場合は user / identity / parent lookup を共通 detach し、opaque
  parent UUID が非 FK でも必ず null にする。
- Stripe の既存 billing 表を entitlement として維持し、金額・refund・dispute の監査行は
  別 operational 表とする。analytics 用カラムを既存 entitlement 行へ混在させない。
- Stripe event ID、invoice / refund / dispute ID で冪等化する。
- cash movement / fee は Stripe balance transaction ID を一意キーとする signed ledger にし、
  invoice / refund / dispute の source kind と関連 ID を閉じた列へ保存する。
- 共通費・一時費は immutable header と bucket child へ分ける。header は
  `(source_expense_line_id, recognition_month)` を unique にし、immutable な `allocation_version`、closed
  `allocation_scope`、認識 signed amount、currency を 1 つだけ固定する。scope / allocation version を unique
  key に含めず、同じ source line / month の cross-scope / cross-version 登録を拒否する。child は header ID /
  `expense_allocation_bucket` を unique にして share を持ち、header 配下の share 合計 1 を deferred constraint /
  close validation で保証する。
  `plus_incremental` scope の非 0-call 月は活動 bucket へ、0-call 月は `plus_unallocated_activity` だけへ share 1、
  `whole_service_nonincremental` scope は call 数にかかわらず同名 bucket だけへ share 1 とする。1 invoice を
  複数 scope へ正当に split する場合は distinct line ID / line amount を要求し、invoice total との一致を
  検証する。同じ月に異なる line ID の両 scope が共存することは許可する。
- reversal / correction header は元 header ID、closed `entry_kind = reversal | correction`、外部訂正 source
  ID を持ち、元 line と異なる `source_expense_line_id` を必須にする。外部訂正 source ID を unique にして一度だけ
  計上し、signed amount と元 line 参照で元額を上書きせず訂正する。元 line + reversal / correction line の
  signed 合計と invoice / 証憑 total の reconciliation を close 条件にする。
- 10 年保持する `private.revenue_financial_core` は最初から user ID / Auth FK / measurement subject を
  持たず、取引日、金額、通貨、税区分、source kind、recognition month、correction 参照、Stripe
  object / balance transaction の opaque ID など会計照合に必要な最小列だけを持つ。Stripe event /
  invoice / refund / dispute / balance transaction 等を `(source_kind, source_id)` で unique にして冪等化する。
- `private.revenue_financial_account_workflows` は user ID 主キー、Auth delete CASCADE で、durable な
  `workflow_state = linked | unlinking | unlinked` を持つ。account が存在する間の financial link 可否の
  server 正本とする。
- billing の共通 lock 順は
  `account deletion gate → financial workflow → checkout lock → session / customer mapping` とする。Checkout /
  pilot / customer 初期化、checkout lock acquire、Session bind、financial link mutation、user を解決できる
  webhook は必要な class を skip しても相対順を変えない。
- workflow を `linked` で初期化できる入口は、pilot membership / 最初の billing customer row の作成または
  checkout lock acquire の service-role RPC に限定する。いずれも共通 account-deletion gate を最初に
  `FOR UPDATE` して `active` を要求し、その後 workflow を lock する。workflow 欠落時の `linked` 初期化と
  membership / customer mapping / checkout lock の対象 mutation は同じ DB transaction で行い、片方だけの
  commit を許さない。`draining | drained` gate または `unlinking | unlinked` workflow は
  `account_deletion_in_progress` で closed 拒否する。
  Phase 1B 前 migration は既存の eligible billing customer を決定論的に列挙し、account deletion pending と
  既知の `unlinked` を除外して `linked` を backfill する。eligible なのに初期化できない欠損は closed alert とし、
  Checkout / pilot 開始を止める。`unlinked` かつ Auth user が残る間の Checkout / pilot 再登録は
  `account_deletion_in_progress` で拒否し、customer 作成、webhook、retry から自動 relink しない。
- `private.revenue_financial_links` は `core_id` を PK / unique、`user_id ON DELETE CASCADE` を持つ短期 link 表
  とし、user ID に index を張る。1 core を複数 user へ link できない。管理経路の Auth 直接削除でも link と
  workflow だけが cascade し、financial core は存続する。
- financial link を作成・更新し得る全 RPC / webhook は、共通 gate、workflow の順で `FOR UPDATE` する。
  gate が `active` かつ workflow が `linked` の場合だけ entitlement / user link を作成・更新できる。
  `draining | drained` または `unlinking | unlinked` では Checkout Session 完了、subscription webhook、retry、
  順不同 event も financial core だけを source ID で冪等記録し、entitlement、membership、customer link、
  financial link を作成・復元しない。workflow row 欠損時も fail closed で link しない。
- Stripe Customer / Checkout Session は DB transaction 外で作成するため、各外部境界の直前と直後に短い
  transaction で gate → workflow → checkout lock / mapping を再確認する。Customer 作成後に gate が draining
  なら、外部作成前に checkout lock へ固定した operation / idempotency key と opaque Customer ID を user-owned
  compensation row および user FK なし core へ冪等記録し、entitlement mapping を作らず削除側の Stripe
  reconciliation へ渡す。外部 response loss で Customer ID が不明でも operation key から TTL 後に Stripe を
  再照合する。Session 作成後・bind 前に draining / unlinking を検出したら
  URL を caller へ返さず、Session expire を DB lock 外で実行し、その結果を再び gate / workflow 下で記録する。
  expire の失敗・応答不明を best-effort 成功として扱わない。
- `private.revenue_checkout_ready_facts` は internal ready fact ID、Stripe Session ID unique、pilot membership の
  operational ID、server ready time、environment、URL validation version だけを持つ durable operational table と
  する。URL 自体、measurement subject / generation、canonical LP は持たず、Stripe ID は operational role だけが
  扱い analytics output へ出さない。同じ Session の retry は既存 fact と完全一致なら idempotent no-op、不一致は
  `checkout_ready_conflict` で fail closed にする。
- production server は `URL` で parse し、`protocol === 'https:'`、`hostname === 'checkout.stripe.com'`、
  `port === ''`、`username === ''`、`password === ''` をすべて満たす場合だけ Checkout URL を valid とする。
  local / test は server-owned environment が一致する場合だけ、設定された mock URL の exact `origin` allowlist を
  使い、production branch へ mock origin / flag を持ち込めない。userinfo は全環境で拒否する。
- URL validation 失敗時は URL を返さず ready fact / attribution を作らない。Session expire を DB lock 外で行い、
  compensation row へ durable に完了結果を記録する。expire failure / response loss が未解決なら
  `checkout_ready` 完了不能として fail closed にし、削除 / retry は§12.3 の reconciliation で収束させる。
- URL validation 成功後の ready record transaction は
  `common gate → financial workflow → checkout lock / Session → consent` の順で lock する。gate active、workflow
  linked、Session bind / idempotency、pilot membership を確認して operational ready fact を一度だけ作る。その後
  measurement 用の例外隔離 subtransaction で consent row を lock し、accepted notice v3、同じ consent
  generation / active measurement version、same pilot、24 時間以内の canonical LP を確認して§11.2 の checkout
  attribution を作る。v2 / 未同意 / 候補なしでも ready fact と全 Checkout operational count は commit し、率へは
  入れない。attribution write 失敗は ready fact を rollback せず、closed failure で該当 observation window を
  invalid にする。URL は ready transaction commit 後だけ返す。
  core の Stripe opaque object ID は app user link 削除後も Stripe 側との外部照合可能性が残るため、匿名と
  呼ばず、厳格な financial role / RPC、監査、10 年保持のプライバシー説明対象にする。
- 10 年は法定期間の断定ではなく調査・訂正に備える保守的な設計判断であり、Phase 1B 前に税務・
  会計・法務の専門家確認を必須とする。

### 11.4 集計

`private.revenue_measurement_daily`

- JST day、measurement version、cohort week、event、surface、variant、interval、plan、
  call purpose、AI call allocation bucket、success allocation bucket、expense `allocation_version` / allocation scope /
  bucket。
- unique subjects、event count、success count、cost amount / currency、gross / refund / fee 等の
  集計値。
- measurement subject ID、外部 ID、user ID を持たない。
- 全 dimension は `not null` の閉じた sentinel（例: `none` / `unattributed`）を持ち、SQL NULL の
  unique 挙動へ依存しない。period、exact `measurement_version`、全 dimension の複合 unique keyを固定し、
  success / cost を異なる version 間で合算しない。
- 競合更新は原子的 UPSERT とし、SELECT 後 INSERT/UPDATE をしない。
- expense materialization は header に immutable 保存された exact allocation version だけを dimension へ写し、
  同じ source line / month を異なる version の行として生成または合算しない。

`private.revenue_measurement_quota_reach_daily`

- quota usage day、`revenue_measurement_version`、`limit_kind = success | attempt`、surface=`none`、
  その他必要な closed non-identifying dimension、`identity_day_reach_count` だけを持つ。user、identity、
  request、event timestamp、subject を持たない。
- §7.2 の lock 済み count が limit - 1 から limit へ遷移した場合だけ、usage day / version / kind 等の複合
  unique へ `identity_day_reach_count = identity_day_reach_count + 1` を原子的 UPSERT する。RPC retry や
  同日 Free→Plus 後の Plus reach では加算しない。

`private.revenue_measurement_observation_windows`

- `measurement_version`、non-null window start / planned end、nullable effective end を持つ。window start と
  planned end は作成後 immutable とし、`window_start <= planned_end` を check する。`state = active` の間は
  `effective_end IS NULL` を必須とし、version ごとの partial unique により同じ version の active row を
  同時 1 行だけ許可する。
- `invalid | complete` への terminal 遷移時にだけ、実際に対象とした最後の JST usage day を non-null
  `effective_end` として同一 transaction で固定する。terminal row は
  `window_start <= effective_end <= planned_end` を必須とし、state と effective end は同じ transition RPC で
  更新して以後 immutable とする。`BEFORE UPDATE` invariant trigger は `OLD` / `NEW` を比較し、window start /
  planned end の変更と terminal row の state / effective end 変更を常に拒否する。
- 全 state に stored generated enforcement range
  `daterange(window_start, CASE WHEN state = 'active' THEN planned_end ELSE effective_end END + 1, '[)')` を作り、
  partial 条件なしの
  `EXCLUDE USING gist (measurement_version WITH =, enforcement_range WITH &&)` で、active の planned range と
  active / terminal の effective range を同じ制約へ入れる。active partial unique も、同じ version の active row
  が 1 件であることを明示する追加 invariant として維持する。closed
  `state = active | invalid | complete`、`reason`、
  `measurement_write_failed` flag、日次 / 21 日 watermark、created / updated / completed time だけを持ち、
  subject、user、identity、request ID を持たない。
- Phase 0B migration の prerequisite として、version clause なしの
  `CREATE EXTENSION IF NOT EXISTS btree_gist` を実行し、利用可能であることを確認してから exclusion
  constraint を作る。extension 利用不可または constraint 作成失敗時は migration / 観測開始を fail
  closed にする。gist 不要の代替制約へ無断 fallback せず、設計変更として人間の再承認を受ける。
- `invalid` と `complete` は terminal とし、invalid を active / complete へ戻さない。materialization failure、
  28 日齢停止、30 日 cleanup による source 欠落等の closed reason を保存する。固定 report は `complete` だけを
  読み、active / invalid を意思決定へ出さない。complete 遷移は `measurement_write_failed = false` かつ
  unresolved closed failure log がない場合だけ CAS で許可し、それ以外は fail closed で invalid にする。
- invalid 遷移時はその窓が実際に対象にした最後の usage day を effective end として同じ transaction で terminal
  固定する。再観測はその翌日以降を start とする新しい非重複 window だけを許可する。request / reach
  aggregate / materialized snapshot は server event day ではなく usage day により exclusion constraint 上ただ 1 つの
  window へ所属させ、重複窓への二重帰属を許さない。

`private.revenue_measurement_weekly`

- non-overlapping JST calendar week、同じ dimension、週内 distinct subjects を保持する。
- raw 短期行の保持中に subject distinct を直接数えて materialize し、日次 unique の合計から
  作らない。

materialization は source row の cutoff と watermark を固定し、48 時間を経過した日 / 週だけを
対象にする。同じ measurement version / period / dimension の snapshot は immutable とし、成功後に
再加算しない。transaction 内で source distinct 集計と snapshot insert を行い、既存 snapshot が
あれば内容一致を確認して no-op、不一致なら `measurement_snapshot_conflict` で停止する。
client late event は 10 分で拒否するため、48 時間後の release snapshot を書き換えない。

この immutable 48 時間規則は client funnel と request-snapshot-derived Phase 0B snapshot に限る。
Stripe と AI 原価は遅延・返金・照合修正があるため、外部 event / balance transaction /
provider attempt ID ごとの signed operational ledger を追記し、会計締め前の report を
`provisional` とする。締め後は元行を
上書きせず correction entry を次の open period へ一度だけ載せる。月次 provisional close は
month end + 180 日とする。この 180 日も Stripe が保証する期限ではなく、dispute 等の遅延を扱う
保守的な設計判断であり、専門家確認まで Phase 1B を開始しない。

### 11.5 RPC

- client event から DB RPC を直呼びせず、認証済み Netlify Function を入口にする。同意の本人
  read / accept / revoke だけは authenticated consent RPC を user JWT で呼ぶ。consent 表の
  authenticated 直接 SELECT は許可せず、read RPC は §11.1 の安全な状態だけを返す。
- Function は entitlement を読み、認証済み user ID と閉じた payload を service_role-only RPC
  へ渡す。measurement subject / generation は RPC が同意行から取得する。同意の有効性は
  Function の事前読取で確定せず、ingest RPC が consent 行を lock して同じ transaction 内で再確認する。
- service_role-only `SECURITY DEFINER` RPC は `search_path` を固定し、`PUBLIC`、`anon`、
  `authenticated` から EXECUTE を revoke する。consent RPC は別シグネチャで `PUBLIC` / `anon`
  を revoke、`authenticated` だけへ grant し、`auth.uid()` 所有者検査を必須にする。
- private 表への service_role 直接 CRUD は許可しない。
- 集計閲覧 RPC を browser へ公開しない。Phase 0 は DB 管理者が固定 report query を実行する。

## 12. 保持、撤回、削除

### 12.1 提案する保持期間

| データ | 保持 |
| --- | --- |
| client event / LP / Checkout attribution 個票 | server received_at から最大 35 日 |
| 同意者 hard-limit 帰属個票 | server received_at から最大 35 日 |
| 重複除外キー | server received_at から最大 35 日 |
| AI call cost operational row | 40 日。照合未完了は最大 90 日 |
| active consent state / proof | accepted 中は保持。account_deletion_blocked は Auth delete まで |
| revoked consent row | revoked_at から最大 35 日。削除後の row 欠落は未同意 |
| event cohort snapshot | 各 linkable 短期 event と同じく server received_at から最大 35 日 |
| pilot membership | monthly は開始から 100 日、yearly は開始から 460 日 |
| financial operational record | app user link を削除して必要最小列へ切り離した後 10 年 |
| 非識別日次集計 | 25 か月 |

これらは新しい measurement 固有値であり、既存 quota / feedback / generation の 30 日・40 日
ロック値を流用したものではない。10 年は国税庁資料が一律に要求する期間との解釈ではなく、
電子取引データの保存・監査と後発訂正に備える保守的な設計判断である。実装開始前、かつ
Phase 1B 前に税務・会計・法務の専門家と人間が承認する。

### 12.2 cleanup

- linkable 短期行と dedupe は `expires_at <= now()` だけを削除対象にする。暦日境界や JST 日の切替で
  保持期限を丸めず、`received_at + interval '35 days'` を越えて残さない。
- consent cleanup は `revoked_at + interval '35 days' <= now()` の通常 revoked row だけを対象にする。
  accepted row を経過日数で削除せず、account_deletion_blocked row は Auth delete CASCADE まで保持する。
- 既存 maintenance と同様に 1 category 最大 250 行、期限順、`SKIP LOCKED` または限定 ctid
  で有界削除する。
- 外部 API 呼び出し中に DB lock を保持しない。
- maintenance Function へ返すのはカテゴリ別削除件数だけで、subject / event ID はログしない。
- cleanup 失敗時は保持超過を alert し、新しい pilot の開始を止める。
- `ai_generation_requests` の現行 30 日 cleanup は既存 lock どおり必ず実行し、measurement 都合で source
  row を 30 日超えて保持しない。mature 日の日次 materialize を必須にし、最古 row が 28 日齢で未完了なら
  Phase 1A を停止する。30 日 cleanup までに必要 snapshot を完成できなければ当該 measurement version /
  観測窓を `invalid` にして判断利用せず、cleanup 後に連続 21 mature days を最初から再観測する。
- pilot の財務 event が固定期限までに成熟・照合しない場合、membership を延長せず
  `cohort_unmatured` として結論から除外して削除する。billing operational data の保持を
  measurement 都合で延長しない。

### 12.3 撤回とアカウント削除

- accept と `block_and_purge_revenue_measurement` は user UUID 由来の同じ 2-key transaction-scoped advisory
  lock を最初に取得して、row 欠落時の insert / delete 競合も直列化する。その後 accept / ingest / revoke /
  block は同じ consent 行を `FOR UPDATE` で直列化する。通常 revoked cleanup も同じ advisory lock の後に row を
  lock して削除する。ingest は lock 取得後に accepted、notice version、generation、非 blocked を再確認し、
  短期行 insert まで同一 transaction で完了する。
- 同意撤回 RPC は同じ lock を取得し、state / reason を通常の `revoked` へ設定して
  `ingest_blocked_at` と `revoked_at` を記録し、対象 measurement subject / generation の exposure、
  LP view、hard-limit、checkout attribution、event replay guard を削除して commit する。先行 ingest が
  あれば revoke が待ち、後続 ingest は blocked を見て拒否されるため、purge 後の再挿入を許さない。
- 通常 revoked row は revoked_at から 35 日以内に cleanup できる。re-accept は state が通常 `revoked` の場合だけ
  block を解除し、新しい random measurement subject と新しい generation を発行する。row 削除後の accept は
  fresh row を作る。どちらも新しい client event だけを受理し、旧 subject / generation / event を復元
  しない。`account_deletion_blocked` は terminal であり、accept RPC は state、reason、
  `account_deletion_blocked_at` のいずれも解除できない。
- pilot membership と billing / cost operational data は、提供・課金・会計上必要な範囲として
  分離し、導線計測の撤回だけで entitlement を変えない。
- 通常のアカウント削除は、最初の短い transaction で common account-deletion gate を最初に lock して
  `active → draining` へ CAS し、続いて financial workflow を lock する。workflow row がなくても
  `unlinking` tombstone を UPSERT し、`linked` は `unlinking` へ、既存 `unlinking | unlinked` は単調に維持して
  同じ transaction で commit する。gate と tombstone の片方だけの commit を禁止し、新規 AI reserve / send、
  Checkout / pilot / customer 初期化、checkout lock acquire、Session bind を先に閉じる。
  retry で gate が既に `draining | drained` でも workflow を同じ単調規則で再確認 / UPSERT し、欠落を no-op に
  しない。
- 次に provider drain を実行する。`send_started | ambiguous` は attempt ごとに exactly one の deletion-triggered
  provider reconciliation pass を DB transaction 外で行い、evidence ありは `response_observed`、timeout / 結果
  なしは `archived_unreconciled` へ final archive RPC で terminalize する。sent quota は返さず、parent /
  reservation を canonical 順で収束し、user / identity link を切り離す。追加 provider retry や send-start 期限
  待ちで削除を無期限停止しない。gate が `drained` になるまで measurement purge へ進まない。詳細は独立
  provider 設計を正とする。
- provider drain 後、不可逆な Stripe cancel より前に
  `block_and_purge_revenue_measurement` RPC を実行する。この RPC は advisory lock を先に取得し、consent row が
  欠けていても server random subject / generation 付き terminal row を UPSERT する。既存 accepted / revoked も
  state / reason を `account_deletion_blocked / account_deletion` へ単調に昇格し、exposure / LP view /
  hard-limit / checkout attribution / event replay guard purge まで同一 transaction で行う。並行 accept は terminal
  確認後に closed error となり、
  Auth delete が後で失敗しても terminal row を維持する。purge 失敗時は Stripe cancel / Auth hard delete へ
  進まない。
- measurement purge 後、削除側は gate → workflow → checkout lock / session / customer mapping の共通順で、
  対象 user の全 checkout lock、bind 済み Session、Customer、Subscription を列挙する。bind 済み Session は
  DB lock 外で expire し、結果を同じ順で durable に記録する。外部 Customer / Session 作成中で Session が未 bind
  の checkout lock は、既存 `CHECKOUT_LOCK_TTL_MS`（30 分）を変えず、compensation 完了または lock expiry まで
  次へ進まない。TTL 後は Stripe の Customer / Session / Subscription を再照合し、orphan Session / Subscription
  がないこと、または cancel / expire 対象として durable に列挙できたことを確認する。best-effort error を無視して
  financial unlink / Stripe cancel へ進まない。
- checkout / customer reconciliation 完了後に financial unlink RPC を実行する。この RPC は gate、workflow の順で
  lock し、全 financial links を削除して `unlinking → unlinked` を同一 transaction で完了する。既に
  `unlinked` なら idempotent no-op とし、欠落 workflow は最初の tombstone transaction の invariant violation として
  fail closed にする。失敗 / ambiguous response 時は workflow state を再読するまで Stripe cancel / Auth hard
  delete へ進まない。
- purge / financial unlink 成功後に Stripe cancel が失敗しても ingest block と
  workflow `unlinked` を維持し、削除 retry は記録済み state から再開して link を復元しない。cancel 失敗
  後の invoice / refund webhook も workflow を lock し、financial core だけを記録して link しない。Stripe
  cancel 後に Auth delete が失敗した場合は、既存の
  `account_delete_after_billing_cancel_failed` と同じ副作用認識可能な専用 error contract で返し、
  ingest block、workflow state、financial unlink を解除しない。
- Stripe cancel は TTL 後の再照合で列挙した subscription / customer state と照合し、全対象の成功または既に
  terminal を確認してから完了とする。late webhook / Session completion は `unlinked` workflow 下で core-only
  記録となり、entitlement / link を復元しない。これを確認してからだけ Auth hard delete へ進む。
- Auth delete 後は consent row、financial link、financial workflow、common deletion gate、その他 user-owned operational row が
  CASCADE で消える。user FK を持たない financial core は§12.1 の期間存続する。
- 管理経路から Auth user を直接削除する場合も、provider live state がなく、common gate が `drained`、workflow
  が `unlinked`、live checkout lock / Session / customer compensation がないことを assertion-only DB guard で
  要求する。generation / flyer parent trigger は attempt を `FOR UPDATE` せず、ledger release や逆順 mutation を
  行わない。いずれか未完了なら `account_deletion_drain_required` で Auth CASCADE 全体を fail closed にし、通常
  saga を要求する。全条件を満たす場合だけ consent / membership / financial link / workflow / gate が cascade
  し、user FK を持たない financial core と provider archived evidence は存続する。
- 集計済みで subject を含まない日次値は再計算不能な非識別集計として残す。

## 13. 少数セル、閲覧、出力

- 通常レポートは `unique subjects >= 10` のセルだけ表示する。
- 10 未満は `suppressed` とし、0 と区別する。行・列の subtotal から単一 suppressed cell を
  復元できる場合は、追加の最小セルも相補抑制する。
- 日次が少数なら、raw 保持中に作成した non-overlapping JST calendar week の distinct subject
  snapshot だけを使う。日次 unique の合計、rolling 7 days、任意の重複窓は公開しない。
- release snapshot は measurement version / calendar period ごとに immutable とし、同じ期間を
  再実行した差分や観測途中の値を出さない。raw purge 後に ad hoc な粒度を作らない。
- 生の short-lived row は障害調査用の限定 DB role だけが、承認された手順と期間で扱う。
- report はリポジトリ管理された固定 SQL とし、自由な user-level export を用意しない。
- ログには集計更新件数、cleanup 件数、closed error code だけを出す。
- 外部 BI、spreadsheet、analytics vendor への自動送信は Phase 0 に含めない。

## 14. internal、test、bot、欠測

- client event は Function、AI request は reserve transaction が server-owned
  `measurement_environment = production | preview | test | local` を付与し、client 値を受けない。
  KPI は production だけを使う。
- provider Task 0A は generation / flyer / 親なしの全 reserve 時に server-owned
  `measurement_environment`、`traffic_class = external | internal | automated_test`、personal quota snapshot を
  固定する。E2E / mock Stripe / mock OpenRouter は `automated_test`、internal account exclusion 該当者は
  `internal`、それ以外だけを `external` とする。caller 申告を受けない。
- `personal_quota_disabled = true` は環境や caller にかかわらず必ず
  `personal_quota_disabled_snapshot = true / traffic_class = internal` とし、他の組み合わせを DB で拒否する。
  この request / attempt は外部観測対象、Free active user、coverage 分母、hard-limit KPI、Free / Plus 原価・成功
  分子のすべてから除外する。
- request reserve 時に server-owned `revenue_measurement_version` も固定する。計測未稼働は `none`、旧 NULL
  row は `unknown` として除外し、後日の稼働版から backfill しない。
- request 由来 KPI は `production / external / active manifest version` の積集合だけを使う。
- AI allocation は§10.2 の environment / traffic 優先 mapping を使い、parent 付き local / E2E flyer / quality も
  purpose より先に `development_test`、production internal は `internal_operations` へ閉じる。
- internal accounts は `private` の user ID exclusion 表で server-side 判定する。表は運用 role の
  固定 RPC からだけ管理し、メールを保存せず、event table やログへ user ID を出さない。reserve 後の
  allowlist 変更で既存 request の traffic class を再分類しない。
- Phase 0B migration 前の request や snapshot 不能な NULL row は environment / traffic class を `unknown`
  として全 KPI から除外する。
- User-Agent や IP による bot 個票は保存しない。認証、server quota、strict schema、rate limit
  で濫用を抑え、除外不能な自動化は `unknown automation` として代表性評価に明記する。
- client event の欠測、measurement coverage、ingest failure、suppression 比率、unattributed 比率、
  cost の unreconciled 比率を各観測レポートに必ず載せる。
- 除外前後の任意 user-level export を作らない。

## 15. 信頼境界と脅威対策

| 脅威 | 対策 |
| --- | --- |
| DevTools から event / plan / variant 偽装 | variant は client payload に持たず active version + surface から server が `control_v1` を付与。strict enum、認証、server entitlement |
| 同じ event の再送・多重 webhook | event / Stripe object 一意制約、原子的 upsert |
| CTA 再 mount による表示水増し | consent subject × surface × JST day の canonical exposure |
| selected だけを送る高速操作・悪意ある client | selected RPC が exposure を同一 TX で作り numerator subset を維持 |
| browser ID で表示・選択の対応を偽装 | browser-generated exposure ID を wire に持たず、consent lock 後の canonical tuple だけで解決 |
| ingest と revoke / delete の競合 | consent row lock、generation、通常 revoke と terminal delete の別 state、purge の順序 |
| 任意 URL・自由文の流入 | request schema にフィールド自体を持たない、unknown key reject |
| service_role 漏えい時の広い直接 CRUD | private 表の直接権限 revoke、用途別 RPC |
| SECURITY DEFINER の探索パス乗っ取り | 固定 search_path、schema 修飾、PUBLIC EXECUTE revoke |
| 小さい cohort の再識別 | raw からの週次 distinct、k=10、相補抑制、immutable release |
| account delete 後の仮名行残存 | delete 前 purge、CASCADE、有界 retention |
| account delete と provider send / finalize の競合 | common deletion gate を先頭に CAS / lock、1-pass reconciliation + terminal archive、parent delete trigger は assertion-only |
| Checkout の Customer / Session 外部作成中に delete | gate + unlinking tombstone を原子的に固定、各外部境界で再確認、Session expire、TTL 後 Stripe 再照合 |
| Stripe status を売上と誤認 | positive invoice paid と実控除を使用 |
| 推定モデル単価と実原価の混同 | provider cost を正本、未照合は別分類 |
| 費用の二重控除 | call ごとの単一 purpose、配賦 invariant、日次 reconciliation |
| quota 拒否を reach と誤認 | lock 済み count 遷移からの非識別 aggregate、rejection 別 KPI |
| measurement 失敗で quota core を rollback | 例外隔離、closed failure flag、window invalid 化 |
| hard-limit の surface 推定 | server KPI は `none`、surface funnel は canonical CTA だけ |
| repair が Free attempt 境界を越える | provider Task 0A が success / attempt ordinal snapshot を各 ledger lock 下で固定 |
| local / quota-disabled 親付き call の Plus 誤配賦 | 全 parent kind の immutable environment / traffic snapshot を最優先 mapping で除外 |
| 0-call expense と AI 分類欠落の混同 | closed expense bucket を AI allocation bucket から分離 |
| Auth 直接削除で financial 監査行消失 | user FK なし core と CASCADE 短期 link を最初から分離 |
| unlink 後 webhook が user link を復元 | durable workflow lock、unlinked 時 core-only 記録 |
| workflow 欠損・削除中 account の再課金 | gate + 欠落時 unlinking tombstone を削除開始時に原子的 UPSERT、全 billing 入口で gate → workflow lock |
| provider 送信前後の crash、二重送信、quota deadlock | 独立 provider attempt / quota lock 設計を Phase 0B prerequisite とし、全 state cost matrix で completeness を維持 |
| expense scope 複製による二重計上 | scope を含めない header unique と header 配下 share 合計 1 |
| allocation version 変更による費用複製 | line / month unique、version immutable、signed correction line |
| 欠落 consent への delete と accept 競合 | user-key advisory lock、terminal UPSERT、terminal 上書き禁止 |
| 同一 version の観測窓重複 | date-range exclusion、active partial unique、usage day 一意所属 |
| 暦日丸めによる 35 日超過 | server received_at 基準 expires_at と `<= now()` cleanup |
| retry で集計二重加算 | ingest で長期集計せず、immutable period snapshot を一度だけ materialize |
| kill 中に checkout KPI を捏造 | `checkout_ready` は URL 検証後のみ、0B では率を算出しない |

## 16. レポートと判断ゲート

### 16.1 Phase 0B の固定レポート

- `state = complete` の observation window manifest だけを対象にした観測期間、measurement version、
  production deploy 範囲。active / invalid window は report 対象外。
- Free active user、consenting Free active user、撤回、measurement coverage。
- surface 別 canonical exposure / selected / LP attributed / suppressed。
- 非識別 quota reach daily aggregate 由来の surface=`none` の全体 hard-limit count と、同意 accepted 時だけ
  保存した短期 hard-limit 行→LP attributed を overall by limit kind で報告する。両者を個票 join せず、
  `limit_exceeded_rejection` と short-window 拒否は別の運用件数にし、reach へ加算しない。
- client ingest failure、欠測、unattributed、suppression、internal/test 除外。
- §10.1 の全 state matrix による actual / sent-or-uncertain completeness 母数、公式 billed cost 分子、
  unreconciled 件数 / 比率を同時に表示する。Free 基準、Plus quality / flyer / quota 増分、community share、
  internal benchmark、internal operations、development test、unallocated を別行にし、後 5 区分を Free / Plus
  cost・success 分子へ入れない。AI `unallocated` は data-quality blocker として表示する。
- header の exact allocation version / allocation scope / closed expense bucket 別の shared recurring /
  one-time と share。同じ source line / month を version 間で混在させない。0-call 月の
  `plus_unallocated_activity` は `plus_incremental` channel total に含めて per-success 非算出、
  `whole_service_nonincremental` は call 数に関係なく Plus contribution から除外する。AI `unallocated` と
  同じ行へ入れない。
- OpenRouter 日次照合差異。

### 16.2 Phase 1A へ進まない条件

- 同意文言、保持期間、閲覧 role、削除手順が人間承認されていない。
- client event と operational data が同じ無制限表・権限へ混在する。
- account deletion / revoke / cleanup / 少数セル抑制を検証できない。
- OpenRouter 実原価の取得または日次照合ができず、unreconciled の扱いも決まっていない。
- 独立 provider attempt 設計の Task 0A / 0B、minimal financial guard、全 billing 入口検査、不可分 activation と
  全経路切替が未完了、または全実 call の
  `provider_attempt_id` / attempt state が完全でない。`send_started | ambiguous` の bounded recovery / deletion
  archive、または全 state completeness matrix を実装・検証できない場合も停止する。
- internal / test を server-side で除外できない。
- §8.3 の観測日数、coverage、対象数、欠測、照合、少数セル条件を満たさない。
- 最古 request source が 28 日齢に達するまでに必要な日次・21 日 snapshot を完了できない。30 日 cleanup
  までに回復しなければ当該 measurement version / 観測窓を invalid として最初から再観測する。
- quota core 遷移後の measurement aggregate / consent short-row write failure、または manifest / watermark
  failure で window が invalid になった。
- 販売主体、税務、返金、問い合わせ、pilot 即時再閉鎖条件が未決定。

KPI の合格数値は本書で発明しない。Phase 0B の観測前に人間が別途固定する。

### 16.3 Phase 1B へ進まない条件

- `2026-08-11.v3` の固定コピーが人間承認され、Checkout 帰属対象者から v3 の再同意を取得できていない。
- Session-unique ready fact、exact version / same pilot / 24 時間 LP の短期 Checkout attribution、server-side URL
  validation と durable expire compensation を検証できない。
- 10 年の financial operational retention、month end + 180 日の provisional close、refund / dispute
  認識について税務・会計・法務の専門家確認が完了していない。
- user FK を持たない financial core と CASCADE link の分離、durable `linked | unlinking | unlinked` workflow、
  common deletion gate + workflow tombstone の atomicity、Checkout Customer / Session 各 cut の補償と TTL 後
  Stripe 再照合、Auth 直接削除、後発 correction の一度だけの計上を integration / report test で検証できない。

## 17. 実装 Task の分割案

本書を人間が承認した後、次の順に別 Task として計画する。

0A. **prerequisite: provider attempt / quota core の準備**
   - 独立設計§10.1 を正として、generation、flyer、親なし worker / benchmark / smoke を含む全経路の attempt
     state、bounded reconciliation / `archived_unreconciled`、immutable ordinal / environment / traffic / personal
     quota / revenue measurement version snapshot、closed caller allowlist、単一 send-start 境界、canonical lock
     helper、common account-deletion gate、assertion-only delete triggerを実装し、非送信 fixture で検証する。
   - 0A だけでは production provider / quota caller、旧 mark RPC、account deletion saga を切り替えない。新旧
     dual write と一部 caller の先行 activation を禁止する。
0B. **prerequisite: minimal financial guard と不可分な activation**
   - user ID 主キーの minimal `private.revenue_financial_account_workflows`、closed state、既存 eligible billing
     account の決定論 backfill、workflow 欠落 alert を実装する。pilot / billing customer 初期化、全 billing /
     financial link / Checkout 入口、checkout lock acquire、Session bind、user を解決できる webhook は common
     gate → workflow の順で検査し、active / linked の場合だけ link を作れるようにする。
   - Customer / Session 外部作成の各境界で gate / workflow を再確認し、draining を検出した Session expire、
     Customer mapping、response loss、既存 30 分 checkout lock TTL 後の照合へ必要な durable compensation を
     実装する。削除開始の gate `active → draining` CAS と欠落時を含む workflow `unlinking` tombstone UPSERT を
    同じ transaction に固定する。
   - provider 独立設計§10.2 と同じ activation で、全 provider / quota caller、旧 mark RPC 置換、common gate +
     financial tombstone から始まる deletion saga、assertion-only delete trigger を production へ切り替える。
     0A gate と 0B financial guard の片側だけを有効にしない。
   - Task 0A / 0B の両方が完了するまで Task 1 以降と Phase 0B 観測を開始しない。
1. **契約と同意 UI**
   - strict event/surface/version contract、任意同意、設定の撤回、固定コピー。
2. **DB と権限**
   - generation 付き consent、short-lived row、daily / weekly snapshot、RPC、RLS / grants、pgTAP、
     access matrix。
3. **client funnel ingest**
   - Function、visibility 判定、既存 CTA / LP instrumentation、rate limit、unit / E2E。
4. **server authoritative facts**
   - immutable quota snapshot と hard limit、Stripe invoice / refund / dispute / balance transaction の lifecycle
     fact、Session-unique operational ready fact、v3 consent attribution、会計用 source unique を実装する。
     minimal workflow / backfill、billing 入口の gate 検査、checkout compensation、deletion saga activation は
     prerequisite Task 0B の責務であり、Task 4 で再実装しない。Phase 0B では Checkout を開放しない。
5. **AI actual cost**
   - response usage、generation metadata fallback、§10.1 の全 state matrix、immutable environment / traffic /
     personal quota / ordinal / purpose / execution class / parent kind / exact measurement version からの§10.2 による
     attempt allocation bucket、§10.3 による terminal parent の immutable success allocation bucket の導出・保存、
     日次 reconcile。
6. **cleanup、削除、レポート**
   - Task 0B で有効化済みの deletion saga へ measurement block / purge と retention cleanup を統合し、bounded
     attempt / cost cleanup、checkout / Stripe reconciliation の運用、revoke / account purge、k=10 report、runbook、
     privacy log assertion を完成する。gate / workflow activation や削除順をここで再定義しない。
7. **Phase 0B 観測開始ゲート**
   - 全検証、プライバシー文言、人間承認、期間・代表性・停止条件の記録。

各 Task は既存の Plus 価格、quota、trial、申込停止定数、flyer UI flag を変更しない。

## 18. 検証要件

実装計画には最低限、次を含める。

- contract unit: event 別 discriminated union、unknown event / surface / key、全 event の client-supplied variant と
  legacy browser exposure ID、自由文、URL を拒否する。`eventId` は browser `crypto.randomUUID()` 由来 UUID v4
  だけを許可し、oversized text、非 UUID、非 v4 UUID を Function の strict Zod 境界で DB 前に拒否する。DB / RPC
  が `uuid` 型と v4 invariant を持つこと、Phase 0B は server-derived `control_v1` 以外を保存しないことを検証する。
- Function unit: 未認証、未同意、revoked、Plus、entitlement error、再送、rate limit。
- component unit: canonical exposure、exposed 応答喪失後の即時選択、再 mount、新 event ID の表示・選択、
  同意 off、撤回。browser-generated exposure identifier を生成・保持・送信しない。
- pgTAP: private 表直接不可、`private.revenue_measurement_consents` の authenticated / service_role 直接
  SELECT / CRUD 不可、安全な public read / accept / revoke wrapper RPC 出力、`PUBLIC` / `anon` EXECUTE
  revoke、`authenticated` EXECUTE grant、`auth.uid()` ownership、固定 search_path、unique、atomic upsert。
  既存 RLS inventory は private consent table を public user_id table として誤検出せず、inventory 自体を
  弱めていないことも確認する。
- financial pgTAP: workflow closed state、全 billing / link 入口の gate-first、workflow-second lock、financial links の core_id PK /
  unique、user_id CASCADE / index、unlinked 時 link 拒否、core source unique。pilot membership / 初回 billing
  customer / checkout lock と `linked` 初期化の active gate 下同一 transaction・唯一入口、既存 eligible customer の
  決定論 backfill、deletion pending / unlinked 除外、欠損 alert、Auth 残存 unlinked の Checkout / pilot 再登録
  `account_deletion_in_progress` 拒否を検証する。削除開始時は gate `active → draining` と、workflow 欠落時を含む
  `unlinking` tombstone UPSERT が同じ transaction で片方だけ commit しないことも検証する。
- prerequisite activation inventory: Task 0A 単独では production provider / quota caller、旧 mark RPC、deletion
  saga のいずれも切り替わらない。Task 0B の minimal workflow、backfill、全 billing / Checkout / pilot /
  link 入口検査、checkout compensation が完成した同じ activation でだけ 0A gate、新 provider / quota path、
  financial tombstone、assertion-only trigger、deletion saga が有効になる。0A / 0B の片側 activation、新旧 dual
  write、Task 1 の先行開始を inventory / migration test で拒否する。
- pgTAP: ingest と hard-limit insert 対 revoke / delete の競合、generation、通常 revoke と terminal
  deletion の別 state、terminal 後 accept 拒否、account purge、hard-limit unique / CASCADE、250 行
  bounded cleanup / concurrent cleanup。
- consent race pgTAP / integration: never-consented と revoked-cleaned の各 user で accept 対 account delete を並行
  実行し、同じ 2-key advisory lock、row 欠落時 terminal UPSERT、既存 state の terminal 昇格、random non-null
  subject / generation、accept の terminal 非上書きを検証する。purge 後の Auth delete 失敗でも terminal が残り、
  retry や後続 accept が解除しないことも確認する。
- pgTAP: 3 回目 mark-success の post-transition reach、6 回目の service-role 送信開始 RPC 後に provider / validation が
  失敗する attempt reach、並行境界の一度だけ aggregate 加算、超過 rejection との非混同を検証する。
  aggregate に identifier / timestamp がなく、未同意者個票や request reach 列が作られないこと、同意時だけ
  subject / generation / usage day / kind / actual event time の短期行ができることも確認する。
- quota reach boundary: success / attempt の usage day 跨ぎ、event 時刻の JST 跨ぎでも usage day 計上、同日
  Free→Plus 後の Plus reach 除外、RPC retry / duplicate、inactive / unknown measurement version 除外を検証する。
  measurement aggregate / consent write failure でも quota core 遷移は commit し、安全な failure flag で window
  が invalid になり、retry で aggregate 再加算されないことを検証する。
- retention pgTAP: exposure、LP、hard-limit、checkout attribution、全 event replay guard の
  `received_at + interval '35 days'`、
  35 日ちょうどの `expires_at <= now()` 削除と、その直前・直後の境界、revoke / purge / Auth cascade。
- client dedupe pgTAP / Function unit: consent row lock による exposed / selected / LP の直列化、同一 ingest
  transaction、`(measurement_version, event_id)` 競合、LP eventId 保存、異なる event kind による replay 拒否。
  同じ event ID / kind は `duplicate_event_id`、同じ ID の別 kind は `event_id_kind_conflict`、new event ID で
  canonical 既存なら guard を 1 行だけ `canonical_noop` として保存し、canonical / KPI / event count / raw audit
  count は増やさない。新 canonical だけ `recorded` guard と canonical がともに commit されることを検証する。
  no-op guard も subject / generation / version と 35 日 expiry、revoke / purge cascade、per-user / day cap を持つ。
  canonical tuple がない selected は exposed + selected を同一 transaction で作ること、exposed response loss、
  再 mount、新 event ID、並行 exposed / selected が同じ version 付き tuple へ一意に収束し、canonical variant を
  継承することも検証する。
- version isolation pgTAP / integration: exposure、LP、hard-limit、checkout attribution、event replay guard の全 row
  と canonical unique に exact `measurement_version` があり、同日 v2 / v3 を別 tuple として扱う。CTA → LP、
  hard-limit → LP、LP → Checkout の候補検索が別 version を選ばず、window、materialization、cost、success、
  report の unique / filter が `none | unknown` や別 version を混ぜないことを検証する。
- billing unit / barrier integration: Session bind だけでは非計上、URL 検証後 `checkout_ready`、webhook 再送・
  順不同、unknown price 非計上。checkout lock acquire、Customer 作成前後、Session 作成前後、bind の各 cut と
  account deletion を競合させる。workflow 欠落の Free user でも tombstone が作られ、draining 後の bind は URL を
  返さず Session expire、Customer 作成後は mapping / compensation が収束すること、未 bind lock は既存
  `CHECKOUT_LOCK_TTL_MS` 満了または補償まで削除が進まず、TTL 後の Stripe Customer / Session / Subscription
  再照合で orphan subscription が残らないことを検証する。late Session completion / webhook は core-only で、
  entitlement / link を復元しない。
- Checkout attribution / URL unit: production は parsed URL の protocol exact `https:`、hostname exact
  `checkout.stripe.com`、空 port / username / password を全条件とし、subdomain、userinfo、明示 port、別 protocol
  を拒否する。local / test の exact mock origin allowlist は server-owned environment だけで有効となり、production
  へ持ち込めない。失敗時は URL 非返却・ready fact / attribution なしで、durable Session expire compensation が
  完了しない限り fail closed になる。成功時は Session-unique ready fact が idempotent で、ready transaction の
  gate → workflow → checkout / Session → consent lock、accepted v3 / same generation / exact version / same pilot /
  24 時間 LP だけが 35 日 attribution を作る。v2、未同意、revoke 競合、候補なしは operational count だけに残り、
  attribution failure / invalid window が Checkout core 成功を rollback しないことを検証する。
- cost unit: success / invalid / timeout / fallback / repair、usage 欠落、metadata retry、送信前
  provider attempt ID、generation ID 欠落時の unique、generation 親 / flyer 親 / 親なし call の
  `parent_kind`、immutable environment / traffic / personal quota / success ordinal / attempt ordinal /
  revenue measurement version snapshot。
  parent kind × environment × traffic × purpose の全直積が§10.2 の exactly one allocation bucket へ導出され、
  regular generation の `not_applicable`、欠損 / legacy unknown / 矛盾値が推定されず `unallocated` になること、
  flyer / share / benchmark / smoke / development test の正当な `not_applicable` が closed purpose / execution
  class / parent kind から対応 bucket へ配賦されることを検証する。parent 付き local / E2E flyer / quality は
  `development_test`、production internal / quota disabled は `internal_operations` となり、Free / Plus 分子へ
  入らない。production internal benchmark だけが `internal_benchmark` となる。nullable parent request UUID が非 FK であり、
  request 30 日 cleanup 後も exact version を持つ cost 40 / 90 日保持を阻害しないことを検証する。
- success allocation unit / report: successful eligible parent ごとに§10.3 の優先順で exactly one immutable
  `success_allocation_bucket` を固定する。environment 非 production、production internal benchmark / operations、
  quality、flyer、regular generation の関連 attempt に plus ordinal あり、全 attempt free + success ordinal free、
  attempt 欠損 / version 不一致 / ordinal 矛盾の全 fixture を closed bucket へ導出する。quota-disabled generation は
  ordinal ledger を使わず `internal_operations`、parentless share / benchmark は success 分母外となる。physical
  attempt cost が複数 bucket に跨っても成功は 1 bucket だけで、Free / Plus KPI 分母がこの列と exact version
  だけを数え、`unallocated` を補完しないことを検証する。
- attempt state cost matrix: `reserved | void_unsent` は completeness / cost から除外、`send_started | ambiguous |
  archived_unreconciled` は sent-or-uncertain 母数かつ推定 cost なしの unreconciled、`response_observed` は actual
  call 母数かつ公式 billed amount 確定時だけ cost 分子となる。report、cleanup、deletion drain が同じ matrix を
  使い、unreconciled を 0 cost や欠落 attempt と混同しない。
- provider dependency cross-integration: 独立 provider attempt 設計の全 fixture を前提に、generation、flyer、
  share worker、benchmark、smoke の各実 call が送信前 `provider_attempt_id`、closed state、call purpose、
  execution class、parent kind、immutable ordinal / revenue measurement version snapshot を一度だけ持ち、Task 5 が
  最終 allocation bucket を
  一度だけ保存すること、`void_unsent` が原価から除外され、`send_started | ambiguous |
  archived_unreconciled` が completeness / unreconciled から消失しないことを
  確認する。独立設計の crash / lock / flyer 対 generation / account deletion deadlock suite が pass しない場合、
  または旧 mark RPC 併用が検出された場合は、この measurement suite が pass しても Phase 0B を開始しない。
- expense allocation test: closed scope / bucket、header
  `(source_expense_line_id, recognition_month)` unique、allocation version / scope / signed amount / currency
  immutable、同じ source line / month の cross-scope / cross-version 登録拒否、header 配下 child share 合計 1、
  `plus_incremental` 非 0-call 月 share 合計 1、0-call 月は `plus_unallocated_activity` だけ share 1、
  `whole_service_nonincremental` は call 数に関係なく同名 bucket / share 1 で Plus contribution 除外、両 scope
  共存、AI `unallocated` との schema / report 分離、expense 二重配賦拒否を検証する。invoice split は distinct
  line ID / line amount だけを許可し、line 合計と invoice total の不一致を拒否する。訂正は distinct signed
  reversal / correction line ID と原 line 参照で一度だけ計上し、duplicate correction、reversal 不整合を拒否する。
- expense report test: daily / report が header の exact allocation version を dimension として保持し、同じ line を
  旧 / 新 version へ重複 materialize せず、header amount を一度だけ、child へは share 按分だけを計上する。
- report test: raw からの週次 distinct、k=10、相補抑制、immutable snapshot、subtotal 差分、
  interval / surface 非混在、hard-limit は surface=`none` かつ overall by limit kind だけ、年額按分・JPY 端数。
- privacy log test: user ID、email、URL、referrer、prompt、本文、外部 ID の漏えい拒否。
- E2E: 同意 off では送信なし、on では閉じた event、撤回後停止、Plus 機能差なし。
- consent lifecycle: active consent proof の 35 日超保持、event cohort snapshot の最大 35 日、通常 revoked row の
  35 日 cleanup、row 欠落=未同意、terminal block の Auth delete まで保持、re-accept 時の新 random subject /
  generation、row 削除後 fresh accept、旧 event 非復元を検証する。
- account deletion integration: common gate `active → draining` + workflow 欠落時も `unlinking` tombstone の atomic
  commit → provider one-pass reconciliation / archive を含む drain / `drained` → measurement block / purge →
  checkout lock / Session / Customer reconciliation + financial links 削除 / workflow `unlinked` → Stripe
  subscription cancel → Auth hard delete、の順に完全一致させる。各段階が未完了なら次へ進まないこと、
  `reserved` は未送信 void 後に削除され、`void_unsent` は不要 evidence を削除、`response_observed` は cost evidence
  を残しつつ attempt / cost 双方を detach すること、`send_started | ambiguous` の結果なしでも exactly one pass 後に
  `archived_unreconciled` となり sent quota を返さず user / identity / opaque parent / lookup link を切離すこと、
  retained row の detach assertion 前に gate が drained にならないこと、unlink 対 webhook の lock 競合、cancel
  失敗後の invoice / refund、
  retry / duplicate webhook で core だけ冪等記録し link 非復元を検証する。
  管理経路の Auth 直接削除は provider live state、未完了 gate / workflow、checkout lock / Session /
  compensation のいずれかがあれば assertion-only guard で失敗し、provider drain、workflow unlinked、checkout /
  Stripe reconcile 済みなら user-owned link が cascade して user FK のない core / archived provider evidence と
  source unique が存続することも確認する。
- reconciliation: OpenRouter / Stripe の fixture 正本と日次集計が一致。
- quota report: Free exact tuple `3 / 6 / 4`、日中 plan 変更、internal / test 先行除外、success / attempt
  reach 最初の 1 件、limit exceeded / short-window 別集計が fixture 正本と一致。coverage は同じ 21 日の
  request snapshot 由来 Free active user ID distinct を分母、その集合と CTA / LP active consent user ID
  の積集合 distinct を分子とし、join / count が materialize transaction 内だけで完了することを検証する。
  Plus のみ・生成活動なしを除外して 100% を超えず、materialize 後に user / subject / identity link が
  残らないことも確認する。
- snapshot retention report: 新列前の NULL row を unknown 除外し、reserve 時 environment / traffic class を
  allowlist 変更後も再分類せず、request の `revenue_measurement_version` none / unknown も除外する。
  `personal_quota_disabled = true` が必ず internal となり external 観測へ入らないことを検証する。
  21 日+48 時間、日次 materialize、最古 source 28 日齢の停止、30 日 cleanup の予定どおりの実行、未完了窓
  の invalid 化と最初からの再観測を境界 fixture で検証する。
- observation manifest: version pin なしの `btree_gist` 導入、利用不可 / constraint 失敗時 fail closed、
  immutable / non-null window start・planned end、`window_start <= planned_end`、active 中
  `effective_end IS NULL`、active は planned end・terminal は effective end を使う全 state の generated range
  overlap exclusion、version ごとの active partial unique、active 対 terminal overlap 拒否、planned range 改変拒否、
  active→complete / invalid の同時遷移競合、`window_start <= effective_end <= planned_end`、terminal effective end
  固定、翌日以降からの非重複再観測、
  request / aggregate の usage day による一意 window 所属、closed reason / watermark、identifier 非保持、
  complete window だけの report selection を検証する。
- checkout report: 同一 pilot / accepted v3 consent generation / exact measurement version / 24 時間の分子制約と、
  全 operational ready 件数・unattributed・v2 / 未同意
  の別件数を検証。

## 19. 実装開始前の人間承認事項

本書のレビュー完了後も、次を該当 Phase の前に人間が明示承認する。1 の v2、2〜6、8 の OpenRouter
部分、および 10 は Phase 0B 実装前、1 の v3、7、8 の Stripe / financial 部分および 9 は Phase 1B 前の
blocker とする。

1. 導線計測を別同意・既定 off とすること。Phase 0B 前に§5.2 の v2 固定コピーを承認し、Phase 1B 前に
   Checkout の申込準備日時を含む v3 固定コピーを別途承認して、v2 同意者を含む対象者から再同意を得ること。
2. §12.1 の保持期間、active consent state / accepted_at を同意中保持すること、terminal block を Auth
   delete まで保持すること、revoked row と event cohort snapshot を最大 35 日で削除すること、および
   集計済み数値が撤回・削除後も残ること。
3. k=10 の少数セル抑制と、DB 管理者限定の固定レポート運用。
4. OpenRouter billed cost の公式単位を実装時に再確認し、JPY 換算を保留すること。
5. internal account exclusion の管理責任者と更新手順。
6. §8.3 の連続 21 mature days（各日 48 時間 maturity）、coverage 20%、consenting Free active user
   100、surface 30、欠測・照合上限。
7. Phase 1B pilot の対象、月額 / 年額の扱い、即時再閉鎖条件。
8. Stripe / OpenRouter の operational data に関するプライバシー説明。Stripe / financial については
   app user link 切離しと financial operational record の 10 年保持も含む。
9. §9.3 の税抜日割り認識、refund / dispute lifecycle、month end + 180 日 provisional close、後発
   correction、0-call 月を含む共通費・一時費配賦。10 年 / 180 日の保守的設計判断は専門家確認が
   完了するまで Phase 1B の blocker とする。
10. 実装承認前に、本番 `private.ai_generation_requests` から直近 21 日の eligible Free exact tuple
    request を対象に、distinct user ID 件数だけを返す read-only aggregate を実行し、coverage 20% と
    consenting Free active user 100 の到達可能性を確認する。個別 user / identity / request ID は出力・
    保存・ログ記録せず、aggregate 件数だけを人間へ提示する。到達困難な場合も閾値を下げず、Phase 0B
    の目的を「需要シグナル」から「計測能力の検証」へ縮小するかを人間が判断する。2026-08-11 時点で
    本書作成者は本番データへアクセスしておらず、この実測は未完了である。

## 20. 外部仕様の確認記録

- OpenRouter は完了 response の usage で token と cost を返し、generation ID から metadata を
  後取得できる。実装直前に現行 schema を再確認する。
  - <https://openrouter.ai/docs/cookbook/administration/usage-accounting>
  - <https://openrouter.ai/docs/api/api-reference/generations/get-generation>
- Stripe は subscription status、invoice paid、refund、dispute 等を webhook event として提供
  する。既存 pin `2026-06-24.dahlia` の型と event object を実装直前に再確認する。
  - <https://docs.stripe.com/billing/subscriptions/webhooks>
  - <https://docs.stripe.com/api/events>
- 国税庁は電子取引データの保存義務と保存方法の資料を公開している。financial operational record
  の対象列・保存方法は実装前に現行資料と専門家見解を再確認する。
  - <https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/tokusetsu/01.htm>
- Stripe dispute は作成から response、review、won / lost 等の終端まで lifecycle を持つ。cash
  movement と recognized adjustment の計上点は実装時の event / balance transaction と照合する。
  - <https://docs.stripe.com/disputes/how-disputes-work>

本書の 10 年保持と month end + 180 日 close は、上記資料が直接要求または保証する値ではない。
いずれも後発の税務調査・訂正・dispute を扱うための保守的な設計判断であり、専門家確認で短縮・
延長が必要なら Phase 1B 前に measurement / accounting version を上げて本書を改訂する。

外部仕様は変わり得るため、本書の URL や 2026-08-11 時点の確認だけで実装を進めない。
