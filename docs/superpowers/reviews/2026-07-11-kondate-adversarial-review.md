# こんだて日和 MVP 設計・実装プラン敵対的レビュー記録

**実施日:** 2026-07-11
**対象:** MVP設計書1件、ロードマップ1件、実装プラン6件
**状態:** 最終交差レビュー・指摘反映・全体検証完了

## 1. レビュー方法

設計・実装を担当していない3つのサブエージェントが、同一の凍結スナップショットを独立に読み取り専用でレビューした。観点は次のとおり。

- 忙しい家庭利用者、低いITリテラシー、片手スマートフォン操作を前提としたUXと復旧可能性
- 子ども・高齢者・アレルギーを含む食の安全性、AI出力を信用しない決定論的検証
- 認証、テナント分離、外部AIへの情報送信、quota、冪等性、競合、権限境界
- Plan 1からPlan 6まで順番に実装できるか、ファイル所有権、型、import、migration、fixture、コマンドの整合

各指摘は主担当が次の順で再検証した。

1. 指摘箇所と依存先を設計書から実装プランまで追跡する。
2. 想定した失敗経路を型、状態遷移、SQL transaction、UI操作のいずれかで再現できるか確認する。
3. 時点依存の事実は公式資料と照合する。
4. 成立する指摘だけを、所有ファイル・REDテスト・最小実装・検証コマンドが明示された修正へ変換する。
5. 修正後に別観点のサブエージェントと主担当が横断再レビューする。

## 2. 再検証後の統合指摘

重複する生の指摘は、同じ原因と修正境界を持つ項目へ統合した。

| ID | 重大度 | 統合した問題 | 判定 | 反映方針 |
|---|---|---|---|---|
| AR-01 | Blocker | 通常メモでも空配列をtruthy判定し、全生成が医療依頼扱いになる | 採用 | `.length > 0` と通常・空・対象外依頼の固定テスト |
| AR-02 | Blocker | 生成ボタン、router、期限経過食材の確認、`not_started` 再送が接続されていない | 採用 | 既存planner所有ファイルへ一本化し、同じcommandと冪等キーで復旧 |
| AR-03 | Blocker | 未確認アレルギー、対象メンバー、必須食材との矛盾を外部送信前に止めない | 採用 | 全決定論的preflightを外部call reservationより前へ移動 |
| AR-04 | Blocker | AI実行中に家族の安全設定が変わっても古い条件で成功保存できる | 採用 | finalizer transaction内で現在値をlockしfingerprintを再比較 |
| AR-05 | Blocker | 時間、料理役割、主食材、ジャンル、必須・優先食材、在庫条件の検証が不足 | 採用 | `GenerationContext` を受ける一つの決定論的validatorへ統合 |
| AR-06 | Blocker | AIが表示ラベル確認を `confirmed` と自己申告できる | 採用 | server算出のcanonical `pending` だけを保存し、本人操作RPCだけで確認済みへ遷移 |
| AR-07 | Blocker | AIの `safetyTags` 自己申告だけで幼児・高齢者向け安全検査を通過できる | 採用 | 対象料理・メンバー・工程を持つ安全操作と本文の整合を検査し、tagを証明に使わない |
| AR-08 | Blocker | promptへ家族・冷蔵庫の永続UUIDが混入する | 採用 | allowlist型のprompt DTOを新規構築し、最終payload全体のUUID不在を再帰テスト |
| AR-09 | Blocker | アレルゲン別名と走査対象テキストが不足する | 採用 | reviewed aliasとschema内の全text leafをpath付きで検査 |
| AR-10 | High | 標準アレルギー選択、対象メンバー選択、初回後の家族設定変更が実用上欠ける | 採用 | 標準29品目検索UI、対象者チェック、設定画面、変更直後の再検査を追加 |
| AR-11 | High | 結果が技術ID中心で、本人ラベル確認と調理後の在庫更新ができない | 採用 | 人間向けsnapshot/解決表示、明示確認、使い切り・まだある操作を追加 |
| AR-12 | High | 緊急献立が夕食の一部表示だけで、高齢者固有の保守ルールもない | 採用 | 朝・昼・夕の完全なreviewed fixtureと、嚥下食と区別した高齢者ルールを追加 |
| AR-13 | Blocker | 再生成がgeneration service、現在安全状態、lineage保存へ型安全に接続されない | 採用 | 一つのdiscriminated `GenerationCommand` とowner-scoped loader群へ統合 |
| AR-14 | Blocker | 買い物リストreconciliationの応答消失再送がversion検査で先に失敗する | 採用 | command ledger replayをpreconditionより先に処理するtransaction境界へ変更 |
| AR-15 | High | 買い物リスト再同期でlist-level警告が消え、保護済み項目の必要増分も消える | 採用 | canonical警告のtransaction置換と、保護行を残す差分項目を追加 |
| AR-16 | High | 在庫名称照合、数量編集、家にあるため除外、undo、同一献立二重追加が不足 | 採用 | 名称先行照合、reviewed alias、編集sheet、単調保護flag、command復旧を追加 |
| AR-17 | High | 未開始の任意token fragmentを受け入れ、login CSRF/session swappingが可能 | 採用 | PKCEとローカル開始stateを必須化し、未知fragmentを拒否、isolated contextは一回限りcontinuation |
| AR-18 | High | 成功回数だけの利用者枠では、失敗callで全体OpenRouter枠を枯渇できる | 採用 | 利用者別外部call attempt枠、短期rate limit、失敗ledger保持上限を追加 |
| AR-19 | High | 45秒のcall後にrepairするとNetlify同期Functionの上限を超え得る | 採用 | 総処理deadlineを50秒以内、1 callを約20秒、timeout後のrepair禁止に固定 |
| AR-20 | Medium | privileged writerで親子行の `user_id` 不一致をDBが拒否しない | 採用 | `(id,user_id)` uniqueと複合FK、cross-owner pgTAPを追加 |
| AR-21 | Medium | forward-only migration、削除cascade、RLS/grant inventoryの証明が不足 | 採用 | corrective migration、実user削除、table×operation×role matrixを追加 |
| AR-22 | Critical | import、optional property、issue code、UI primitive、E2E fixture、型生成schemaがplan間で不一致 | 採用 | 所有元に正規contractを置き、全参照・fixture・コマンドを同期 |
| AR-23 | Medium | production URL、clean-shell env、Netlify CLI、GitHub Actions pin/permissionsが弱い | 採用 | exact origin検査、固定dev dependency、full SHA、最小権限へ変更 |
| AR-24 | Medium | 実Google OAuth成功を通常CIの決定論的要件にする提案 | 条件付き採用 | state/callback/foreign-sessionは自動化し、実Googleだけ記録付きstaging確認とする |

## 3. 採用しなかった指摘

| ID | 指摘 | 判定理由 |
|---|---|---|
| NR-01 | 認証前に必ずNetlify background functionへ変更する | background functionは即時202となり、同期的な認証・入力エラー契約を維持できない。同期functionの50秒総deadlineで解決する。 |
| NR-02 | 食物アレルギー表示を旧「8+20品目」へ戻す | 2026年4月施行の消費者庁情報では義務9品目・推奨20品目であり、設計の29品目が正しい。 |
| NR-03 | NetlifyのSPA fallbackがFunction routeを奪う | Netlifyのrequest chain上、matching FunctionがSPA fallbackより先に評価されるため再現しない。 |
| NR-04 | OpenRouter structured outputとprovider fallbackの採用自体が危険 | strict schema、対応provider必須、無料model allowlist、server-side keyを組み合わせる方針は成立する。検証不足部分だけを修正する。 |
| NR-05 | hard delete呼び出しのAPI指定がsoft deleteになる | Supabase Admin APIの既存指定はhard deleteで正しい。問題はAPI指定でなくcascadeとreadbackの証明不足だった。 |

## 4. 修正版の交差再レビューで追加採用した指摘

初回統合指摘の反映後、担当文書を入れ替えて全8文書を再読した。そこで判明した実装境界上の問題も、初回と同じ基準で再検証してから反映した。

| ID | 重大度 | 追加で成立した問題 | 判定 | 反映内容 |
|---|---|---|---|---|
| CR-01 | Blocker | 1品再生成が「1品だけ返す」と「完成献立を返す」の二重契約になり、残す料理の安全性と参照整合を保証できない | 採用 | AI出力をlocal ref付きreplacementに限定し、serverが検証済みの残存料理と決定論的に完全献立へ合成 |
| CR-02 | Blocker | normalized safety actionのschemaだけがあり、Plan 3の保存・readback・画面表示に生産者がない | 採用 | generation finalizer、stored loader、human result view model、結合テストへ同じ行契約を接続 |
| CR-03 | Blocker | 買い物リストの応答消失、警告置換、保護行増分、item競合が別々の楽観処理で破綻する | 採用 | replay-first command、canonical pending警告、positive delta、list-version owner RPC、再読込gateへ統合 |
| CR-04 | High | clean CIで秘密値生成、public/private型drift、offline Netlify build、実Google証跡、定期削除の条件が再現できない | 採用 | ephemeral `.env`、両schema型検査、固定action SHA、権威あるdeploy metadata readback、30秒内bounded scheduled cleanupを明記 |
| CR-05 | High | 認証continuationのHTTP path、canonical origin、設定画面CRUD、ローカルGoogle成功経路が抽象的でE2E不能 | 採用 | exact code-config path、`127.0.0.1:5173`、完全設定CRUD、production拒否付きCompose `oauth-mock`へ固定 |
| CR-06 | High | 幼児向け豆・ナッツ規則が広すぎる文字列または抽象名で、安全食品の誤拒否と危険食品の見逃しが両立する | 採用 | hard whole beanとreview済みナッツの具体名matrix、豆腐等のsoft product negative testへ変更 |
| CR-07 | High | 家族削除で過去の対象表示・安全操作がcascade消失し、別タブの安全設定変更も買い物操作へ伝播しない | 採用 | nullable live IDとimmutable snapshot、共有safety revision/event、query reload gateを追加 |
| CR-08 | High | migration名が適用順の字句順と一致せず、clean DBと既存DBでschema結果が分岐し得る | 採用 | 14桁の単調増加timestampへ正規化し、roadmapの唯一の順序表とCreate順を一致 |
| CR-09 | High | React Router 8の公式minimumより古いReact patchをpackage範囲が許容し、clean installのpeer contractを保証できない | 採用 | React/React DOMの下限と全planのbaselineを公式minimum `19.2.7` へ固定 |
| CR-10 | Critical | React Router 8で削除されたroot exportから `RouterProvider` をimportする全snippetが型検査に失敗する | 採用 | `RouterProvider` を `react-router/dom`、route構築・hook・componentを `react-router` に分離し、共通制約へ固定 |
| CR-11 | Critical | 1品再生成で残存aggregateのUUIDを再利用すると、通常finalizerが同じPKを再INSERTして必ず衝突する | 採用 | 表示内容だけを保持し、献立配下の全IDを新規採番して全cross-referenceを一括remap |
| CR-12 | Blocker | 再生成用dependency wrapperがhandler-entry時刻を捨て、認証・予約後に50秒予算を再開始する | 採用 | 全生成handlerが入口時刻を一度だけ取得し、必須timing引数として唯一のfactoryへ渡す |
| CR-13 | High | 親献立の単一FKを`SET NULL`にしてもowner-composite FKが`RESTRICT`のままで、履歴・アカウント削除を阻害する | 採用 | 両FKを明示的にdrop/recreateし、複合FKは`parent_menu_id`だけを`SET NULL` |
| CR-14 | Blocker | 保存済みconfirmationを現在のcatalog・アレルギーに対するprovider証拠として再利用し、stored/generated provenance型も混在する | 採用 | 過去行は表示専用とし、現在contextからcanonical pending集合を再導出する一つのgenerated型へ統一 |
| CR-15 | High | 同名・同単位・曖昧分量の重複を単一`Map`で潰し、warningのexact leafや削除済み家族名も失う | 採用 | multimap/bucket差分、`sourceType+sourceId+sourcePath`照合、live→snapshot→家族Nの表示へ変更 |
| CR-16 | Blocker | 永続pending/recoveryが新規献立専用で、全体・1品再生成は応答消失やtab終了後に同一commandを回復できない | 採用 | 3種の`GenerationCommand`を持つ単一storage schema、endpoint selector、serialized recovery controllerへ統合 |
| CR-17 | Critical | 通常の結果画面と既存買い物リスト操作が現在の家族安全設定を再検査せず、古い表示・操作を許可する | 採用 | 結果・履歴共通menu gateと、全source再検査＋list fingerprintを要求するshopping gateを追加 |
| CR-18 | High | 緊急献立が候補名と時間だけで、材料量・番号手順・段取り・対象者別対応を表示せず調理完了不能 | 採用 | 通常結果相当の完全read-only候補、human warning、朝昼夕E2E、320px/keyboard証明を追加 |
| CR-19 | High | 失敗画面が成功枠だけを示し、外部AI試行が消費された可能性を隠して「回数に含まれない」と誤認させる | 採用 | 独立usage APIで成功・日次試行・短期枠・全体受付を表示し、取得失敗時は試行未消費を断定しない |
| CR-20 | High | 買い物差分が件数だけで全操作を自動承認し、項目編集も数量・単位・売り場を一緒に確認できない | 採用 | 人名・材料・旧新数量・warning付きの操作別checkboxと、数量・表記・単位・売り場編集を追加 |
| CR-21 | High | 調理後在庫が汎用ボタンとAI予定量の自動減算に寄り、削除確認・undo・競合時入力保持がない | 採用 | live行versionを使う「使い切った」「まだある」、確認、再作成undo、任意残量、競合復旧へ固定 |
| CR-22 | Blocker | shoppingのowner-composite FKが参照する2表にexact `(id,user_id)` uniqueがなく、clean migrationが失敗する | 採用 | dependent table作成前に両unique constraintを追加し、pgTAPで順序とキーを証明 |
| CR-23 | High | 冪等性に通常hashだけを保存すると低エントロピーcommandの推測照合が可能で、payload bindingの秘密境界も弱い | 採用 | server-only 32-byte鍵の`generation-command.v1` HMAC、全leaf canonical化、replay-first mismatch拒否へ変更 |
| CR-24 | Blocker | cleanup RPC内の`set_config(statement_timeout)`では実行中の同じstatementを制限できず、30秒上限を超える | 採用 | 20秒defaultの専用LOGIN＋NOLOGIN executor、transaction再確認、25秒client backstop、実DB cancellation/rollback試験へ変更 |
| CR-25 | Blocker | 本番preflightが必要なHMAC鍵を検査せず、以前の部分envコマンドはclean shellで必須値不足になる | 採用 | 完全synthetic env、HMAC形式/sample/VITE検査、CI・runbook・秘密値scanを同じ必須集合へ同期 |
| CR-26 | High | `menu_revalidations.user_id`と参照献立の所有者がDB制約で結ばれず、privileged writerの誤接続を許す | 採用 | `(menu_id,user_id) → menus(id,user_id)` cascade FKとexact pgTAP assertionを追加 |
| CR-27 | Blocker | 安全条件変更後に新しく導出されたラベル警告へ確認可能なIDがなく、旧確認行も現行として操作できる | 採用 | requirement fingerprint付き世代管理、service-only reconciliation、現行行だけの本人確認RPCと競合試験へ変更 |
| CR-28 | Blocker | 買い物安全refreshが作成時の不変警告を全削除し、RPC内部shapeを不完全な公開responseとして返す | 採用 | 不変provenanceとlatest-only current projectionを別表へ分離し、strict内部responseを完全な公開schemaへ合成・再parse |
| CR-29 | Blocker | 通常/全体再生成のAI schemaがDB UUIDを要求し、local-ref materializerと`constraint_conflict` unionの境界も曖昧 | 採用 | local payload＋top-level success/conflict unionを唯一のprovider契約とし、全IDをserver採番して全cross-refを型別解決 |
| CR-30 | High | 履歴再検査が調理後の在庫削除・数量変更や好み変更を過去献立のinvalid条件として扱う | 採用 | 保存本文を現在の家族安全条件へ照合する専用validatorを追加し、pantry/preference driftは非阻害の変更詳細へ分離 |
| CR-31 | Critical | 同一端末eventだけでは別端末で追加されたアレルギーを検知せず、開いた献立・買い物操作が継続する | 採用 | owner-scoped Realtime、focus・visibility・online、最大60秒pollを結果/履歴/買い物gateへ追加し、信号時即時fail closed |
| CR-32 | High | 完全な生成commandを端末へ無期限保存し、当初の端末保存allowlist・共有端末・account switch境界と矛盾する | 採用 | 仕様をexact recovery向けに明示改訂し、30分TTL、user binding、sign-out/switch/delete/terminal消去、期限境界試験を追加 |
| CR-33 | Critical | idempotency HMACがmutableな`draftId`だけを束縛し、再送時に別内容の下書きやforeign sourceをquota後に読める | 採用 | monotonic draft revision、生成click時flush、HMAC束縛、replay-firstかつowner/revisionを同一予約transactionで検査する複合FKへ変更 |
| CR-34 | High | 残時間0でも`markSent`してから即abortし、未送信callを送信済みquotaへ数えたうえfinalize時間も失う | 採用 | 各send前に20秒attempt＋2秒finalize余裕を必須化し、不足時はHTTPなしで全未送信予約を返すdeadline branchを追加 |
| CR-35 | Critical | Supabase server URLが任意HTTPSを許し、service-role keyを第三者hostへ送信でき、browser/server/maintenance projectも混在できる | 採用 | exact managed origin parserと同一project-ref束縛をruntime/preflightへ追加し、lookalike・任意host・A/B/C混在を拒否 |
| CR-36 | High | staging SHAだけをreadbackし、本番が別SHAでもroot/401 smokeだけでcandidateとして完了できる | 採用 | production deploy ID/site metadataを再読取し、HEAD・tag・candidate・`commit_ref`・published deploy・smoke originを同一値へ束縛 |
| CR-37 | High | `menu_revalidations`とshopping mutation replayが無制限に増え、長期利用で運用・privacy負債になる | 採用 | menu再検査をmenu/user単位latest-only、shopping replayを30日保持＋250件bounded maintenanceカテゴリへ変更 |
| CR-38 | High | 削除済み家族の取り分け・安全処理・自由文を再生成promptと新versionへ複製できる | 採用 | 過去表示snapshotは保持しつつ、新candidateはsurviving current targetsだけにfilterする型・provider・永続化試験を追加 |
| CR-39 | Blocker | 最終追記したAPI/import/helper/新規schema fileがTaskのFiles・`git add`・実行snippetに含まれず、planどおりのcommitが欠落する | 採用 | 所有TaskのFiles/import/helper/commit commandを同期し、Create/Modify順・untracked fileを機械検査 |

## 5. 修正後の再レビューゲート

次をすべて満たしてからレビュー完了とする。

- 8文書すべてを修正版として再読し、route、shared type、環境変数、migration順、fixture所有者が一意である。
- 全 `Create:` パスの所有planが重複せず、後続planによる変更は `Modify:` として追跡できる。
- 全TaskがRED、GREEN、検証、commitを持ち、未定義helperや抽象的な「適切に実装する」を残さない。
- AI送信前、AI応答後、DB保存時、履歴表示時、買い物同期時の各安全境界がテストで覆われる。
- 通常生成、再生成、買い物同期の応答消失を、同じcommandと冪等キーで回復できる。
- `git diff --check`、Markdown構造検査、禁止語・古いsymbol・重複所有・相互参照検査が成功する。
- 修正担当と異なるサブエージェントによる再レビューでBlocker/Criticalが残らない。

今回の最終検証では、Plan 1/5/6の担当エージェントが project-ref 束縛、production deploy metadata、bounded retention、shopping provenance/current projection、strict RPC response、Realtime gateを再確認し、Plan 3/4の担当エージェントが local-ref AI payload、PendingGeneration TTL、draft revision、deadline、current-safety validator、削除済みメンバー除外、fresh-ID materializerを再確認した。担当レビュー後に主担当が全8文書を横断検索し、旧generic Supabase schema、旧immutable-refresh契約、旧unbounded cleanup、旧provider-unchanged、旧local-only safety event、旧30分未満のないpending storage、送信前deadline欠落の残存を0件にした。

機械検証の結果は、Markdown fence全件偶数、Plan全体のTask/commit対応 `60/60`、API route表 `15`、spec acceptance `22`、duplicate `Create:` `0`、trailing whitespace `0`、`git diff --check` 成功である。実装コードはまだ作成していないため、npm/DB/E2Eの実行結果を成功とは記録せず、各実装TaskのRED/GREENコマンドを計画内の検証境界として残した。

## 6. 監査上の判断

敵対的レビューは「指摘数を増やす」ためではなく、一般利用者が安全に完了できる経路と、実装者が推測せず順番に作れる契約を確認するために行った。指摘案をそのまま採用せず、再現可能性、現行プラットフォーム制約、MVP境界を満たすものだけを反映対象とした。
