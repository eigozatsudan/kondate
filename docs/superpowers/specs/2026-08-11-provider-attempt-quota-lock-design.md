# provider attempt の at-most-once 化と quota lock 順統一

- 日付: 2026-08-11
- 状態: **技術再レビュー待ち・人間承認待ち**
- 対象: OpenRouter 送信境界、provider attempt、generation / flyer quota mutation
- 依存元: [プライバシーを守る収益計測設計](./2026-08-11-privacy-preserving-revenue-measurement-design.md)
- 種別: 独立した堅牢化設計。**本書だけでは migration、送信経路切替、収益計測開始を行わない**

---

## 1. 結論

OpenRouter へ実際に送るすべての physical call は、HTTP 送信前に server-generated UUID
`provider_attempt_id` を発行し、provider attempt state machine を通す。送信開始の DB transaction が
commit した応答を受けた呼出側だけが HTTP を 1 回送信できる。commit 成否が不明な場合は同じ attempt
を再送せず、専用 recovery RPC で authoritative state を読む。`reserved` なら未送信として
`void_unsent`、`send_started` なら `ambiguous` へ収束させる。

generation と flyer は同じ quota ledger を共有するため、両経路の reserve、send、finalize、release、
delete、stale cleanup を durable account-deletion gate から始まる 1 つの canonical lock protocol へ同時に
移行する。generation だけを新順へ
変える段階的 migration は禁止する。share worker、benchmark、smoke、development test は親 request を
持たない軽量 attempt 経路を使い、user / global quota を消費せずに実 call の追跡だけを行う。

本変更は収益計測とは独立して成立する quota / 送信経路の正しさ改善である。収益計測は完成した
`provider_attempt_id` と attempt state を読み取るだけで、送信可否や quota interface を再定義しない。

## 2. 目的と対象外

### 2.1 目的

- 成功、provider failure、timeout、invalid response を含む全実 call を一意に捕捉する。
- send-start RPC の応答喪失時に同じ physical call を二重送信しない。
- generation と flyer が共有する `ai_global_daily_usage` 等の lock 反転を無くす。
- quota reservation、sent count、parent flag、attempt state を同じ transaction 境界で更新する。
- 親を持たない production worker / internal tooling も provider attempt を省略しない。

### 2.2 対象外

- Free `3 / 6 / 4`、Plus `10 / 20 / 8`、global limit その他の現行 quota 値の変更。
- 現行 failure code、retry 時刻、quota rejection、caller-facing result contract の意味変更。
- Plus 価格、trial、entitlement、flyer UI flag の変更。
- provider の自動 retry 回数、model allowlist、timeout の変更。
- 原価配賦、同意、KPI、保持期間の決定。これらは収益計測設計を正とする。

## 3. 現行リスク

generation の `public.mark_ai_global_sent` と flyer の `public.mark_flyer_weekly_sent` は同じ
`ai_global_daily_usage`、`ai_identity_daily_external_attempts`、`ai_user_rate_windows` を変更する。
片方だけで identity attempt と global の順を反転すると、flyer が global day を保持して identity
attempt を待ち、generation が同じ identity attempt を保持して global day を待つ cycle が成立する。
global day は全 user が共有するため、flyer と generation の同時送信は通常 traffic でも競合する。

また、flyer は `private.flyer_weekly_requests`、share worker は job queue を起点とし、generation 親を
前提にした attempt reserve だけでは追跡できない。全 call を捕捉するには、親 kind ごとの quota-aware
reserve と、親なし call 用の quota-free reserve を明示的に分ける必要がある。

## 4. attempt と caller の閉じた分類

### 4.1 parent kind

attempt row は `parent_kind = generation | flyer_weekly | none` を必須とする。

| parent kind | parent | execution class | quota | 許可 call purpose |
| --- | --- | --- | --- | --- |
| `generation` | `private.ai_generation_requests` | `generation_request` | 現行 generation quota を消費 | `menu_primary | menu_repair | dish_primary | dish_repair | quality_primary | quality_repair` |
| `flyer_weekly` | `private.flyer_weekly_requests` | `flyer_weekly_request` | 現行 flyer / attempt / global quota を消費 | `flyer_primary | flyer_repair` |
| `none` | なし | §4.2 の caller ごとに固定 | user / global quota を消費しない | `share_primary | share_repair | benchmark | smoke | development_test` |

`parent_kind = none` のとき parent ID は null とする。その他は `deletion_detached_at IS NULL` の間だけ対応する
parent ID を non-null とし、account deletion の共通 detach 後は state にかかわらず null とする check を置く。
`parent_kind`、`execution_class`、`call_purpose` の組み合わせは上表と§4.2 の closed allowlist 以外を DB
constraint / reserve RPC で拒否する。generation / flyer の traffic class は parent reserve 時の server-owned
immutable snapshot を copy し、attempt caller の申告で上書きしない。
parent ID は各 parent の cleanup を阻害しない opaque UUID とし、長期原価 row から parent table への FK は
張らない。send / finalize 中の整合確認は保持中の parent row を canonical lock 順で取得して行う。

### 4.2 execution class と transport 分類

親なし caller は次の closed classification を reserve 時に server-side で固定する。caller payload から
任意の parent kind、call purpose、execution class、traffic class を受けない。

| caller | execution class | traffic class | call purpose |
| --- | --- | --- | --- |
| `share-generalize-worker` production job | `production_worker` | `external` | `share_primary | share_repair` |
| benchmark | `internal_benchmark` | `internal` | `benchmark` |
| smoke test | `automated_smoke` | `automated_test` | `smoke` |
| local / E2E / development test | `development_test` | `automated_test` | `development_test` |

`parent_kind` / `call_purpose` / `execution_class` の allowlist と上表は provider Task 0A が唯一の authority
として固定する。production worker は user quota、short window、identity quota、global quota のいずれも
消費しない。benchmark / smoke / development test も、実際に外部送信した場合の attempt は作る。
最終原価配賦 bucket の決定・保存は収益計測 Task 5 の責務であり、provider attempt table には持たない。

### 4.3 environment / traffic snapshot

Task 0A は全 `parent_kind` の reserve で、server-owned immutable な次の snapshot を attempt row に固定する。

- `measurement_environment = production | preview | test | local`
- `traffic_class = external | internal | automated_test`
- `personal_quota_disabled_snapshot` boolean
- `revenue_measurement_version`。稼働中の server-owned version、未稼働時は `none`、migration 前 row は
  `unknown` とし、後から active version で backfill しない。

generation / flyer は initial parent reserve でも同じ値を parent row へ固定し、各 attempt が copy する。
親なし call は実行環境と§4.2 の caller allowlist から server が決定し、personal quota を持たないため
`personal_quota_disabled_snapshot = false` とする。どの parent kind でも caller payload から environment、
traffic class、personal quota disabled を受けず、後日の deploy / allowlist / account state から再分類しない。
`personal_quota_disabled_snapshot = true` と `traffic_class <> internal` の組み合わせは DB constraint で拒否する。
measurement version も caller から受けず、parent cleanup 後も attempt / cost lineage に immutable に保持する。

## 5. provider attempt state machine

### 5.1 保存項目

`private.ai_provider_attempts` を固定候補名とし、少なくとも次を持つ。

- unique `provider_attempt_id`、parent kind / opaque parent ID、call purpose、execution class、§4.3 の immutable
  environment / traffic / personal quota / measurement version snapshot。
- `attempt_state = reserved | send_started | response_observed | void_unsent | ambiguous | archived_unreconciled`。
- lease owner、unguessable lease token、lease expiry、各 state の server timestamp。
- deletion reconciliation の durable `deletion_reconcile_attempted_at`、idempotent pass ID、既存 provider timeout
  から導く deadline、closed outcome / reason。
- account deletion detach の server timestamp `deletion_detached_at`。
- generation / flyer の quota day、必要な reservation snapshot。
- `success_ordinal_snapshot = free_ordinal | plus_ordinal | not_applicable` と
  `attempt_ordinal_snapshot = free_ordinal | plus_ordinal | not_applicable`。generation attempt は親で確定済みの
  success ordinal を copy し、当該 attempt の ordinal を同じ row へ保存する。flyer / 親なし attempt と
  quota-disabled generation は両方 `not_applicable` とする。snapshot は作成後 immutable とする。
- OpenRouter generation ID は取得できた場合だけ追加 unique とする。

新規 row に `unknown` は許可しない。migration 前 row や移行失敗で snapshot を確定できない場合は原価配賦を
推定せず fail closed とし、収益計測開始を止める。provider Task 0A は transport / quota-neutral な immutable
snapshot と caller allowlist だけを確定し、最終原価配賦 bucket を定義しない。

### 5.2 ordinal snapshot authority

- `personal_quota_disabled_snapshot = true` の generation は success / attempt ordinal をともに
  `not_applicable` とし、identity success / attempt ordinal ledger を作成も lock もしない。DB check はこの
  snapshot と両 ordinal の組み合わせを固定し、environment / traffic 優先配賦より後で ordinal を推定しない。
- それ以外の generation parent の `success_ordinal_snapshot` は initial parent reserve で identity success daily row を
  lock し、予約加算前の `success_count + reserved_count < 3` なら `free_ordinal`、それ以外なら
  `plus_ordinal` とする。判定、success reservation、parent snapshot 保存を同一 transaction で一度だけ行う。
- generation の各 attempt は attempt reserve で identity attempt daily row を lock し、予約加算前の
  `sent_count + reserved_count < 6` なら `free_ordinal`、それ以外なら `plus_ordinal` とする。判定、attempt
  reservation、attempt row の両 ordinal snapshot 保存を同一 transaction で行う。
- concurrent reserve は同じ ledger row lock 下で直列化し、各予約前 count に対応する ordinal を一意に
  割り当てる。同じ ordinal 境界を複数 attempt が観測する read-before-lock を禁止する。
- `void_unsent` で attempt reservation を返した後の physical retry は、新しい `provider_attempt_id` を reserve
  し、その時点の lock 済み `sent_count + reserved_count` から attempt ordinal を再判定する。void 前 attempt の
  snapshot は書き換えず、新 attempt が返却済み reservation を count に含めない。
- sent 済みまたは `ambiguous` の reservation / count は返却せず、後続 retry の判定へ消費済みとして反映する。
- flyer、親なし call、quota-disabled generation は success / attempt ordinal とも `not_applicable` とする。
  quota-enabled generation の `not_applicable` は DB check で拒否する。Plus の 10 / 20、flyer の週次境界、
  原価 allocation を ordinal 判定へ混ぜない。

### 5.3 許可遷移

通常遷移は次だけとする。

- `reserved → send_started | void_unsent`
- `send_started → response_observed | ambiguous | archived_unreconciled`
- provider 照合で送信済みを確認できた場合だけ `ambiguous → response_observed`
- deletion / bounded stale recovery の 1 回の provider reconciliation pass で evidence を得られなかった場合だけ
  `send_started | ambiguous → archived_unreconciled` とする。

send-start RPC の応答喪失後、authoritative primary の recovery RPC が canonical 順で row を lock して
`reserved` を読めた場合、send-start は commit しておらず HTTP は未送信と確定する。quota-aware parent は同じ
transaction で `void_unsent` にし、attempt / global reservation を一度だけ返却して parent attempt reservation
flag を clear する。parent success reservation は retry 用に維持し、sent / short / hard-limit reach を加算しない。
commit 後だけ新しい attempt ID で retry できる。親なし `reserved` も counter を変更せず `void_unsent` にする。
`reserved` を `ambiguous` として扱うことと保守的 sent 消費は禁止し、`send_started` だけが recovery で
`ambiguous` へ進める。

`void_unsent | response_observed | archived_unreconciled` は operational terminal とする。
`archived_unreconciled` は transport 送信有無が不明なまま閉じる state であり、同じ ID の再送、sent quota の
返却、推定原価の計上を永久に禁止する。`send_started | ambiguous | archived_unreconciled` の sent 消費は
timeout、crash、provider 照合不能、account deletion を理由に返却しない。原価 completeness 上の扱いは収益
計測設計§10.1 の state matrix だけを正とする。

### 5.4 response 観測

response header または body を観測した時点で `response_observed` とする。低レベル parser は output
validation より先に generation ID と usage を抽出し、invalid AI body、repair へ進む response、timeout
境界でも元 attempt を失わない。metadata retry、reconcile、duplicate callback は同じ
`provider_attempt_id` を使い、state、usage、cost を二重加算しない。

## 6. durable account-deletion gate と送信 RPC

### 6.1 durable account-deletion gate

user-owned generation / flyer と billing 経路が共有する先頭 gate として、user ID 主キーの durable
`private.account_deletion_gates` を置き、Auth user への `ON DELETE CASCADE` を張る。closed state は
`active | draining | drained` とし、新規 user の
初期化と既存 user の決定論的 backfill を migration prerequisite にする。gate row 欠損は `active` と推定せず
fail closed とする。親なし call は user-owned ではないため gate class を skip する。

- generation / flyer の全 initial・repair・retry reserve と全 send-start は、同じ transaction の最初に gate
  row を `FOR UPDATE` し、`state = active` の場合だけ新規 reservation / send を許可する。`draining |
  drained` は closed `account_deletion_in_progress` で拒否し、attempt / parent / ledger を変更しない。
- finalize、void、response reconciliation、stale cleanup、専用 drain は gate を最初に lock したうえで
  `active | draining` の既存 state を収束できる。これらは新しい physical call、reservation、HTTP 送信を
  作らない。`drained` で live state が見つかった場合は invariant violation として fail closed にする。
- 通常 account deletion は短い transaction で gate を `active → draining` へ CAS し、同じ transaction で
  financial workflow を欠落時も `unlinking` tombstone として UPSERT してから commit する。片方だけの commit を
  禁止し、billing 側の共通 lock 順と後続 saga は収益計測設計§12.3 を正とする。既に `draining` なら
  idempotent に継続し、`drained` なら provider drain 済みとする。
- 次に専用 drain RPC が gate → 全 provider attempt → 全 parent → rate-window → 各 ledger の canonical 順で
  lock する。未送信 `reserved` は `void_unsent`、親と各 reservation は現行 contract に従って terminalize /
  release する。`send_started | ambiguous` は sent count を返さず、attempt ごとの deletion reconciliation を
  §6.2 の有界手順で実行する。
- `void_unsent | response_observed | archived_unreconciled` だけになり、non-terminal parent、reservation flag、
  reserved count がすべて解消し、§6.2 の detach assertion も通過した場合だけ gate を `drained` へ CAS して
  commit する。
- drain commit 後だけ measurement purge 以降へ進む。unresolved `send_started | ambiguous` を期限なし retry で
  維持せず、§6.2 の 1 pass と final archive RPC で必ず operational terminal へ収束させる。

### 6.2 deletion reconciliation と final archive

account deletion drain は `send_started | ambiguous` の各 attempt について、exactly one の
deletion-triggered provider reconciliation pass を DB transaction 外で行う。

1. claim RPC は gate → attempt の順で lock し、`deletion_reconcile_attempted_at` と一意な pass ID を初回だけ
   durable に保存し、既存 provider request timeout から deadline を固定する。初回 commit 成功応答だけが
   side-effect-free provider lookup を 1 回実行できる。同じ attempt の再 claim、応答喪失、worker crash は
   追加 lookup を許可しない。
2. provider evidence を取得できた場合は通常 response RPC が `response_observed` と usage / billed evidence を
   保存する。timeout、結果なし、claim 後 crash を含め evidence がない場合は、同じ pass ID を使う final archive
   RPC へ進み、追加 provider retry を行わない。claim 後 crash は deadline までだけ待ち、経過後は結果なしとして
   archive する。deadline 前に別 worker が archive して進行中 lookup と競合することを禁止する。
3. final archive RPC は gate → attempt → parent → rate-window → ledger の canonical 順で lock し、attempt を
   `archived_unreconciled` へ terminalize する。sent count は返さず、parent terminal state と全 reservation flag /
   reserved count を現行 release contract に従って一度だけ収束させる。
4. archive 後は user ID、identity key、parent ID、user-owned FK を切り離す。opaque `provider_attempt_id`、parent
   kind、call purpose、execution class、environment / traffic / personal quota snapshot、terminal state、unreconciled reason、
   immutable ordinal / quota classification snapshot、provider evidence の有無、server timestamp だけを最小
   operational cost evidence として残す。prompt、本文、user / identity への lookup key は残さない。

通常 stale cleanup も lease expiry 後の `send_started | ambiguous` を無期限に保持しない。attempt ごとに 1 回だけ
durable claim した provider reconciliation pass を行い、evidence があれば `response_observed`、結果なしまたは
crash なら同じ final archive RPC で `archived_unreconciled` へ収束する。通常 cleanup は既存の bounded batch
上限を維持し、HTTP 中に DB lock を保持しない。

#### account deletion detach matrix

account deletion は全 attempt / cost evidence を次の表で処理する。cost evidence row は対応 attempt の直後に
同じ provider-attempt lock class 内で primary key 昇順に lock し、後の parent / ledger class から戻らない。

| state | account deletion 処理 | 保持 |
| --- | --- | --- |
| `reserved` | authoritative recovery で `void_unsent` にし、attempt / global reservation を返却、parent attempt flag を clear。その後 `void_unsent` 行として処理 | なし |
| `void_unsent` | attempt と不要な cost stub を削除。cost evidence が例外的に存在し監査上必要なら共通 detach を適用 | 原則なし。必要 evidence だけ detached 保持 |
| `response_observed` | attempt / cost evidence 双方の `user_id`、`identity_key`、`parent_id`、user lookup mapping を gate 下で原子的に null / delete | billed / usage evidence を detached 保持 |
| `send_started` | §6.2 の one-pass 後、`response_observed` または `archived_unreconciled` の行として処理 | 遷移先に従う |
| `ambiguous` | §6.2 の one-pass 後、`response_observed` または `archived_unreconciled` の行として処理 | 遷移先に従う |
| `archived_unreconciled` | attempt / cost evidence 双方へ共通 detach を適用 | §6.2 の最小 unreconciled evidence を detached 保持 |

共通 detach は `deletion_detached_at` を一度だけ固定し、opaque parent UUID が非 FK でも必ず null にする。
attempt / cost row の user / identity / parent lookup mapping は片方だけ残さず、gate → attempt / cost evidence →
parent → ledger の transaction で原子的に切り離す。gate を `drained` にする直前に、保持する全 attempt / cost
row が `deletion_detached_at IS NOT NULL`、識別列が null、lookup mapping が不存在であることを assertion し、
1 行でも違反すれば fail closed にする。

### 6.3 parent DELETE / Auth CASCADE の fail-closed 境界

generation / flyer parent の `BEFORE DELETE` trigger から attempt / ledger の release 処理を完全に除去し、
assertion-only trigger へ置換する。この trigger は provider attempt を `FOR UPDATE` せず、quota ledger を
更新せず、逆順 lock を取得しない。

- trigger は `OLD` の reservation flag / terminal state と、可視な committed attempt state を通常の
  `EXISTS` で検査する。live reservation、non-terminal parent、または `reserved | send_started | ambiguous`
  attempt があれば closed `account_deletion_drain_required` を raise し、parent DELETE と Auth CASCADE を
  transaction ごと失敗させる。
- provider live state がないことは direct Auth delete の必要条件とする。common gate / financial workflow /
  checkout の追加条件は収益計測設計§12.3 を正とし、すべての assertion を満たす場合だけ CASCADE を許可する。
  管理経路の direct Auth delete は normal deletion saga の代替ではない。
- send-start / finalize と direct delete が競合した場合、trigger から attempt row を lock しない。未確定の
  並行処理がある場合は parent row lock または gate check により一方が待ち、delete 後の reserve / send は
  `account_deletion_in_progress` または parent 欠落で closed 拒否される。
- assertion failure はより強い CASCADE、trigger 無効化、best-effort release で回避せず、§6.1 の gate CAS と
  drain RPC を完了してから Auth hard delete を再試行する。

### 6.4 generation 親

initial、repair、fallback、retry の各 physical call は、generation 用 service-role attempt reserve RPC
で新しい attempt を作る。RPC は account-deletion gate を最初に lock して `active` を確認し、provider
attempt、generation parent、該当 quota ledger を §7 の順で lock する。identity / global attempt
reservation、parent flag、immutable ordinal snapshot、lease を外部送信前に同一 transaction で固定する。
親の success reservation と success ordinal snapshot は§5.2 の authority に従い、現行 generation reserve
contract の quota semantics を維持する。

generation send-start RPC は account-deletion gate、provider attempt、parent、current
`private.ai_user_rate_windows` を順に lock して gate の `active`、lease / token / `reserved` / parent snapshot
を検査し、その後の該当 ledger を §7 の順で lock する。
short limit 未満の場合だけ short、identity attempt、global sent を同一 transaction で加算し、各 reserved
count と parent attempt reservation flag を clear して `send_started` にする。

### 6.5 flyer parent

flyer の primary、repair、fallback、retry は flyer 用 service-role attempt reserve RPC を使い、
`private.flyer_weekly_requests` を parent とする。RPC は account-deletion gate の `active` を最初に確認する。
`reserve_flyer_weekly` が確保した週次 success / try、identity attempt、global reservation と attempt row /
lease を、§7 の同じ protocol 下で扱い、ordinal snapshot は `not_applicable` に固定する。

flyer send-start RPC は account-deletion gate の `active` を確認した後、current short window、identity
attempt、global、flyer weekly、flyer weekly tries を§7 の順で lock し、現行
`mark_flyer_weekly_sent` と同じ許可・拒否結果を 1 transaction で確定する。
generation 用 send-start を流用して flyer parent や flyer ledger を省略してはならない。

### 6.6 親なし call

親なし call は専用の軽量 service-role RPC 群を使う。

1. `reserve_unparented_provider_attempt` は server-owned caller allowlist から §4.2 の closed classification を
   決め、§4.3 の environment / traffic / personal quota snapshot、attempt row、lease owner / token / expiry を
   作る。parent row、rate window、identity / global /
   quality / flyer ledger を作成・予約・lock しない。
2. `start_unparented_provider_attempt` は attempt row だけを lock して lease / token / `reserved` を検査し、
   `send_started` へ遷移する。初回 commit 成功応答だけ `send_authorized = true` を返す。
3. 同じ ID の再実行は `already_started` とし、送信許可を返さない。response loss は親なし専用 recovery
   RPC で HTTP を送らず authoritative state を lock する。`reserved` なら送信開始未 commit と確定して
   `void_unsent`、`send_started` だけを `ambiguous` へ収束させる。
4. 通常の lease 失効でも HTTP 未送信を明確に証明できる場合だけ、親なし専用 void RPC で `reserved` を
   `void_unsent` とする。quota release は行わない。

親なし RPC も `PUBLIC` / `anon` / `authenticated` から EXECUTE を revoke し、allowlisted service role
caller だけに許可する。任意の call purpose、execution class、environment、traffic class、personal quota
disabled を caller から受けない。

### 6.7 共通 at-most-once 境界

- quota-aware / 親なしを含む全 attempt RPC は service-role 専用 `SECURITY DEFINER`、固定
  `search_path`、完全 schema 修飾とする。`PUBLIC` / `anon` / `authenticated` から EXECUTE を revoke し、
  `service_role` だけへ grant する。attempt table と quota table の直接 CRUD を app caller に許可しない。
- 呼出側は send-start RPC の commit 成功応答後だけ、返された `provider_attempt_id` で HTTP を 1 回送る。
- 初回 `reserved → send_started` を commit した応答だけ `send_authorized = true` を返す。
- response loss または commit 不明時は通常 send-start の再応答を送信根拠にせず、専用 recovery RPC を
  呼ぶ。recovery RPC は HTTP 送信許可を絶対に返さない。
- retry 可能な結果でも physical retry ごとに新しい `provider_attempt_id` を発行する。既送信または
  ambiguous / archived attempt の ID を再利用しない。
- DB transaction 中に OpenRouter HTTP を呼ばず、HTTP 中に row lock を保持しない。

## 7. canonical lock protocol

quota / provider state を変更する全 transaction の lock class 順を次に固定する。

`account deletion gate → provider attempt → parent → rate-window → identity success daily → identity attempt daily → global daily → identity quality daily → identity quality monthly → identity flyer weekly → identity flyer weekly tries`

- 処理に不要な class は skip してよいが、残る class の相対順は変えない。
- account deletion gate は user-owned generation / flyer の全 mutation で先頭に取得する。親なし call は
  user-owned でないためこの class を skip する。
- 同じ class で複数 row を取る場合は、day / month / week、identity key、parent kind、row primary key の
  決定論的昇順で、class 内の対象 row をすべて lock してから次 class へ進む。
- bulk release / drain は対象 user の gate、全 provider attempt、全 parent、全 rate-window、以後の各 ledger
  class の順に進む。
- helper は対象 row set を mutation 前に確定し、途中の ledger から前の class へ戻らない。
- provider attempt を扱わない initial parent reservation も gate は skip せず、gate → parent の順で進む。
  同じ transaction で attempt も作る経路は gate → attempt row → parent の順で作成・lock する。
- generation と flyer parent を同一 bulk operation で扱う場合は parent kind と primary key の順を固定する。
- lock 順統一を理由に現行 quota 値、failure code、retry time、reservation semantics、RPC result の意味を
  変更しない。
- §6.3 の assertion-only `BEFORE DELETE` trigger は mutation helper ではない。attempt / ledger row lock と
  release を行わないため、この順序の例外となる逆順 mutation を作らない。

## 8. 全 quota mutation 経路の移行範囲

### 8.1 generation

次を同じ private lock helper / protocol へ移す。

- `reserve_ai_generation`、`reserve_ai_repair_call` と initial / repair / retry attempt reservation。
- `mark_ai_global_sent` を置換する単一 generation send-start RPC。
- `finalize_ai_generation_success`、`finalize_ai_generation_failure`、
  `finalize_ai_generation_conflict`。
- `private.release_request_quota_reservations`、user processing の bulk release、専用 account deletion drain。
- `cleanup_stale_ai_generations_batch` と maintenance から到達する stale cleanup。
- quality request の daily / monthly reservation、finalize、release。
- parent `BEFORE DELETE` は release を行わない §6.3 の assertion-only trigger へ置換する。

### 8.2 flyer

次を generation と同じ migration で移す。

- `reserve_flyer_weekly` と primary / repair / retry attempt reservation。
- `mark_flyer_weekly_sent` を置換する単一 flyer send-start RPC。
- `finalize_flyer_weekly_success`、`finalize_flyer_weekly_failure`。
- `private.release_flyer_weekly_reservations`、専用 account deletion drain。
- `cleanup_stale_flyer_weekly_batch` と maintenance から到達する stale cleanup。
- `ai_identity_flyer_weekly`、`ai_identity_flyer_weekly_tries` の全 mutation。
- parent `BEFORE DELETE` は release を行わない §6.3 の assertion-only trigger へ置換する。

一部の flyer path だけ旧 lock 順へ残すこと、generation の helper から flyer ledger を後付けで逆順 lock
すること、send-start 後に別 transaction の旧 mark / release RPC を呼ぶことを禁止する。

## 9. short reject、void、ambiguity

### 9.1 quota-aware short reject

send-start が `sent_count >= quota_short_limit` を確認した場合、HTTP と short count 加算を許可しない。
provider / parent / rate-window を保持した後、残る success、attempt、global、quality、flyer ledger を §7 の
順で lock し、attempt を `void_unsent`、parent を現行 `user_short_window_limit` terminal failure、
`retry_at = current_window_start + interval '10 minutes'` とする。同じ transaction で parent が保持する
success、attempt、global、quality、flyer weekly / try reservation を現行 flag / day に従って一度だけ
解放し、全 reservation flag を clear する。

attempt / global を short 判定前に先取りしてから success へ戻る順序は禁止する。generation と flyer の
どちらもこの分岐を共通 helper で処理する。

### 9.2 void

`reserved` の lease が失効し、HTTP 未送信を明確に証明できる場合だけ専用 void RPC を使う。lease owner /
token を検査し、§7 の順で該当 row を lock して attempt / global / flyer try 等の attempt 側 reservation
だけを解放する。親の success reservation を retry 用に維持する現行 contract は変えない。state / token
不一致、`send_started | ambiguous | response_observed | archived_unreconciled` は fail closed で拒否する。
void commit 後だけ、新しい attempt ID と reservation で retry できる。

### 9.3 ambiguity recovery

quota-aware recovery は gate、provider、parent、rate-window、ledger を§7 の順で lock する。元 send-start が
commit 済みで `send_started` なら sent count を再加算せず `ambiguous` にする。authoritative primary で
`reserved` なら§5.3 の未送信確定処理を行い、残る ledger を§7 の順で lock して attempt / global /
flyer try reservation を返却し、parent attempt flag を clear して `void_unsent` にする。short / sent / reach は
加算せず、success reservation は維持する。short limit の現在値を理由に未送信 reservation を消費しない。

親なし recovery は attempt row だけを lock し、`reserved` は `void_unsent`、`send_started` だけを
`ambiguous` にする。いずれも HTTP 送信許可を返さない。

## 10. migration と切替

### 10.1 Task 0A: provider attempt / quota core の準備

1. common durable account-deletion gate、provider attempt table、全 parent kind の immutable environment / traffic /
   personal quota / revenue measurement version snapshot、closed constraints、private canonical lock helper、親 kind
   ごとの reserve / send-start / void / recovery / deletion reconcile / final archive / drain RPC と
   assertion-only delete trigger を実装する。
2. generation と flyer の全 quota mutation path、親なし share / benchmark / smoke / development test caller を
   新 helper / RPC へ移行可能な状態にし、focused / concurrency test を通す。
3. 0A では production の provider / quota caller と account deletion saga をまだ切り替えない。新旧 dual write や
   一部 caller だけの先行 activation は行わず、0A schema / helper は非送信 fixture で検証する。

### 10.2 Task 0B: financial guard と不可分な activation

1. 収益計測設計§17 Task 0B の minimal financial workflow / backfill、全 billing / link / Checkout / pilot 入口の
   common gate → workflow 検査、checkout compensation を先に完成させる。
2. その同じ activation で generation / flyer / 親なし caller、canonical quota protocol、common gate + financial
   tombstone から始まる account deletion saga、assertion-only delete trigger を production へ切り替える。
   0A gate と 0B financial guard の片方だけを有効にしない。
3. 全 caller が新 send-start の commit 成功応答後だけ送信することを確認し、
   `public.mark_ai_global_sent` と `public.mark_flyer_weekly_sent` の app caller / EXECUTE をゼロにして廃止する。
   新旧 RPC を dual write / fallback として併用しない。
4. 0A / 0B の focused unit / pgTAP / barrier / concurrency integration がすべて pass した後だけ、収益計測の
   Task 1 以降と Phase 0B 観測を開始する。

既存 caller-facing failure code、retry、status response を変更する必要がある場合は本書の実装に混ぜず、
別の interface 変更として人間承認を得る。

## 11. 検証要件

### 11.1 state / at-most-once

- generation、flyer、share primary / repair、benchmark、smoke、development test の全外部 call が送信前
  attempt ID を持ち、1 physical call = 1 attempt になる。
- 初回 send-start commit 成功だけが `send_authorized`、同 ID 再実行は `already_started` で counter
  非加算・HTTP 非許可になる。
- commit 前、commit 後 response loss、process crash、lease expiry の各境界で、通常 retry が同じ ID を
  送信しない。authoritative primary で `reserved` を lock した recovery は必ず `void_unsent`、`send_started`
  だけが `ambiguous` へ収束する。
- response header / invalid body / provider failure / timeout / repair / metadata retry でも attempt と usage /
  cost が失われず、duplicate callback が二重加算されない。
- 親なし caller は attempt state を完全に通り、quota ledger の row / counter を変更しない。
- `send_started | ambiguous` の deletion / stale reconciliation は durable marker により attempt ごとに 1 pass
  だけ authorize される。evidence ありは `response_observed`、timeout、結果なし、claim 後 crash は追加 retry
  なしで `archived_unreconciled` へ terminalize し、同 ID の再送・sent quota 返却・推定原価計上がない。
- §6.2 の全 state detach matrix に従い、削除対象の retained attempt / cost evidence には user / identity / opaque
  parent UUID / lookup mapping が残らない。全 attempt が terminal かつ detach assertion 通過時だけ
  account-deletion gate を `drained` にできる。

### 11.2 quota boundary

- Free `3 / 6 / 4`、Plus `10 / 20 / 8`、現行 global limit、failure code、retry time、result contract が
  migration 前後で一致する。
- generation / flyer の short 1〜4 件目は該当 sent count を同一 transaction で加算し、4→5 件目は
  short 非加算、HTTP 非許可、`void_unsent`、全 reservation 解放、parent flag clear、
  `user_short_window_limit` terminal、次窓 retry になる。
- 並行する 4 件目 / 5 件目でも送信許可は 1 件だけで、reserved / sent / short count が負数または二重
  適用にならない。
- success / failure / conflict finalize、void、account delete、stale cleanup の retry が idempotent で、
  sent reservation を返却しない。
- generation parent の success ordinal は success reservation 加算前の count、各 attempt ordinal は attempt
  reservation 加算前の count から ledger lock 下で一意に決まり、snapshot が後から変わらない。並行 reserve
  が同じ境界前 count を観測しない。
- `void_unsent` で返却した reservation は新しい attempt の ordinal 判定から除外され、新 attempt は現在値から
  再判定する。旧 attempt の snapshot は不変である。sent / ambiguous は返却されず、後続判定に含まれる。
- flyer / 親なし call の両 ordinal は常に `not_applicable` である。欠損、legacy unknown、矛盾 snapshot は
  推定せず closed failure とし、収益計測開始を止める。
- generation / flyer / 親なしの全 parent kind で environment / traffic / personal quota snapshot が reserve
  後 immutable であり、caller spoof を拒否する。`personal_quota_disabled_snapshot = true` は必ず
  `traffic_class = internal` となる。
- quota-disabled generation は両 ordinal が `not_applicable` で identity ordinal ledger を作成 / lock せず、
  quota-enabled generation の `not_applicable` は DB check で拒否される。
- 全 attempt の `revenue_measurement_version` が reserve 後 immutable で、未稼働 `none`、migration 前
  `unknown`、active version を混在させず、parent 30 日 cleanup 後も cost lineage に残る。

### 11.3 canonical lock / deadlock integration

有限 `lock_timeout` と barrier を使い、少なくとも次を実際の concurrent transaction で競合させる。

- 同じ global day を共有する flyer send-start 対 generation send-start。identity が同じ場合と異なる場合。
- generation / flyer の initial reservation 対 repair reservation、success / failure finalize。
- short reject 対 account deletion drain、short reject 対 generation stale cleanup、short reject 対 flyer stale
  cleanup。
- `release_request_quota_reservations` 対 generation finalize、`release_flyer_weekly_reservations` 対 flyer
  finalize。
- quality request、flyer request、regular generation が同じ identity / usage day を使う場合。
- generation と flyer をともに含む bulk account delete / maintenance cleanup。
- generation / flyer send-start 対、gate を先に `draining` へする通常 account deletion。send-start が先なら
  既存 attempt は drain / reconcile で収束し、draining が先なら新送信は closed 拒否される。
- generation / flyer send-start 対 direct Auth delete。live state があれば assertion-only trigger が
  `account_deletion_drain_required` で delete を拒否する。live state がなく、収益計測設計§12.3 の common gate /
  financial / checkout assertion も満たす場合だけ CASCADE が完了する。
- initial / repair / retry reserve 対 gate の `active → draining` CAS。CAS commit 後の新規 reservation は
  `account_deletion_in_progress` となり、parent / ledger を変更しない。
- 専用 drain 対 generation / flyer finalize、reconciliation、stale cleanup。全経路が gate から始まり、
  deadlock せず同じ terminal state へ idempotent に収束する。
- deletion reconciliation claim / response finalize / final archive の各 crash 境界。1 pass marker が二重 provider
  lookup を許可せず、`send_started | ambiguous` が結果なしでも `archived_unreconciled` へ収束する。
- `send_started` の期限を待たずに始める deletion one-pass と、lease expiry 後の通常 bounded stale recovery。
  いずれも final archive が gate → attempt → parent → ledger の相対順を守る。
- account deletion detach matrix の全 state。reserved / void は所定削除、response / archived は attempt / cost
  双方を同じ transaction で detach、send / ambiguous は one-pass 後の遷移先処理となり、非 FK parent UUID も
  null になる。detach 片落ち fixture では gate `drained` CAS が fail closed になる。

すべてが deadlock / lock timeout なく所定 outcome で完了し、終了後に success / attempt / global /
quality daily / quality monthly / flyer weekly / flyer weekly tries の `reserved_count >= 0`、reserved / sent
合計、parent flags、short count、terminal state が fixture 正本と一致することを確認する。release / sent の
二重適用、class 順の逆戻り、同 class の非決定論 lock がないことを instrumentation でも確認する。

### 11.4 経路 inventory

- repository-wide inventory で OpenRouter sender の全 caller を列挙し、generation、flyer、share、benchmark、
  smoke、development test のいずれも reserve / send-start を迂回しない。
- `mark_ai_global_sent` / `mark_flyer_weekly_sent` の app caller、EXECUTE grant、fallback branch がゼロである。
- cleanup、account deletion drain、maintenance から到達する全 quota mutation が gate を先頭とする canonical
  helper を通り、旧 helper が逆順 lock を追加しない。
- generation / flyer parent の `BEFORE DELETE` trigger は assertion-only であり、attempt の `FOR UPDATE`、
  ledger mutation、reservation release を含まない。live state ありの direct Auth delete は closed failure、
  live state なしに加えて revenue 側の common gate / financial / checkout assertion をすべて満たす場合だけ
  CASCADE 成功となる。
- migration / pgTAP failure 時は新送信経路と収益計測開始を fail closed にする。
- parent kind × environment × traffic class × call purpose の許可直積、production internal、quota disabled、
  preview / test / local を網羅し、snapshot 不整合や caller 指定値を closed 拒否する。
- Task 0A 単独では production caller / deletion saga が切り替わらず、Task 0B の financial workflow / checkout
  guard と同時 activation した場合だけ新 provider / quota / deletion path が有効になる。0A / 0B の片側 activation
  と新旧 RPC dual write を inventory test で拒否する。

## 12. 人間承認 blocker

- 本書の独立 Task 化、generation / flyer の同時切替、旧 mark RPC 廃止を承認する。
- quota / safety-critical core の migration、rollback、監視手順を承認する。
- 親なし production worker が user / global quota を消費せず、provider 側では
  `production_worker / external / share_primary | share_repair` として追跡される classification を承認する。
  `community_share` への最終配賦は収益計測 Task 5 の authority として別途承認する。
- §11 の focused / concurrency 検証がすべて pass するまで production 切替と Phase 0B を開始しない。
