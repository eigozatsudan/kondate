# 公開レシピ SEO / AdSense 段階実証 — 指摘裁定

- 日付: 2026-08-20
- 裁定者: 親エージェント
- 対象: 一次レビュー、敵対的レビュー、二次検証
- 最終判定: **確定指摘をSpecへ反映済み。人間承認blockerを残してImplementation Plan作成は禁止**

## 1. 裁定方法

各指摘を現行migration / Function / contract、レビュー間の独立再現、Supabase / Netlify / Googleの公式資料へ
再照合した。同一原因は重複統合し、攻撃の成立条件がSpecですでに閉じている項目は偽陽性、外部状態なしに
exact値を固定できない項目は受け入れ残差または人間判断へ分けた。

主要な再現根拠:

- `netlify/functions/_shared/supabase-admin.ts`はmain service-role keyを使う。
- `supabase/migrations/20260731170000_service_role_public_table_grants.sql`は`service_role`へ多くのpublic表の
  `ALL`を与える。
- `supabase/migrations/20260812200000_account_delete_lock_and_feedback_idempotency.sql`はDELETE間のTTL lockであり、
  公開処理のdurable fenceではない。
- `supabase/migrations/20260818130000_publish_share_consent_for_update.sql`は既存共有publishでconsent rowの
  `FOR UPDATE`が必要だったことを示す。
- `supabase/migrations/20260711001100_menu_core.sql`に`finalized` / `deleted_at`はない。
- Supabaseのsecret keyは`service_role` / `BYPASSRLS`相当であり、keyを別発行しても権限scopeは狭まらない。
  <https://supabase.com/docs/guides/getting-started/api-keys>
- GoogleのAdSense strict CSP例はnonceに加え`unsafe-inline` / `unsafe-eval`を含む。
  <https://support.google.com/adsense/answer/16283098>

## 2. 確定・統合した指摘

| 統合ID | 元ID | 最終severity | 裁定 | Spec反映 |
| --- | --- | --- | --- | --- |
| F-01 | P-C-1 / A-I-01 | Critical | main service-roleをpublic Siteへ置くblast radiusは成立 | §1、§4.2、§5.2、§6.10でpublishable/anon限定readへ変更 |
| F-02 | P-I-2 / A-C-01 | Critical | 承認後payload差替え・二重publishが成立 | §4.4、§6.4–6.6、§7.4–7.5でimmutable revision/hash/uniqueを固定 |
| F-03 | P-C-2 / A-C-02 / A-C-03 | Critical | revoke/delete/publish raceとAuth削除後orphanが成立 | §6.2、§7、§13でdurable authority fenceと共通lock順を固定 |
| F-04 | P-I-1 | Important | consent version bump後の旧本文配信が成立 | §4.3、§6.10、§13.2で即時read-closeを固定 |
| F-05 | P-I-3 | Important | published-only RPCでは404/410を区別不能 | §8.2でclosed read unionとGET/HEAD契約を固定 |
| F-06 | P-I-4 / A-I-03 | Important | opt-in cacheを許すとwithdraw後stale配信が成立 | §1、§8.2、§10.3、§13でpilot no-storeへ変更 |
| F-07 | P-I-5 / A-I-07 | Important | operator / workerの検証主体とreplay境界が不足 | §5.2、§6.10、§9.1でAAL2/allowlist/hash-bound requestを固定 |
| F-08 | A-I-02 | Important | 別originだけではsame-site Cookieを分離しない | §4.1、Phase 0 blockerへ別domain優先/host-only条件を追加 |
| F-09 | A-I-04 | Important | 既存denylistはあるが工程間canonical bytes不一致は成立 | §4.2、§6.5、§15でversioned canonicalizationを固定 |
| F-10 | A-I-06 | Important | 広告subsetがdefault-deny / revision-boundでない | §4.5、§6.8、§10.2でeligibility recordを追加 |
| F-11 | A-I-08 | Important | DB/RPC/renderer rollbackでwithdrawn復活余地 | §12 deploy/rollback不変条件と§15 testを追加 |
| F-12 | P-M-2 | Important | `finalized`は現行DB predicateでない | §7.2で保存済みかつ`is_selected=true`案へ置換し人間blocker化 |
| F-13 | N-I-01 | Important | operator seedがuser consent必須publishを通れない | §6.4、§6.10、§7.6でseed専用権威経路を追加 |
| F-14 | N-I-02 | Important | source menu hard deleteとpublic copyの関係が曖昧 | §7.2でv1は先にpublic withdraw、失敗時delete拒否へ固定 |
| F-15 | N-I-03 | Important | 全公開killのDB authorityと復旧が未定義 | §6.1、§8.2、§13.4でpublic/ad killを分離 |
| F-16 | P-M-1 / A-M-01 / A-M-03 | Minor | referrer、query変種、metadata retentionが不足 | §5.1、§8.2、§9.3、Phase 0 blockerへ反映 |

一次P-I-5の「既存ops roleはNOLOGINのみ」という補助説明は不正確だが、既存roleがreadonlyで公開審査writeの
検証済み主体にならない根本指摘は独立に再現したため、finding全体は確定とした。

## 3. 偽陽性・重複・受け入れ残差

| 項目 | 裁定 | 理由 |
| --- | --- | --- |
| A-I-05「WAF依存だけ」 | **False positive** | Specはclosed input、bounded response、timeout時fail-closed、Phase 0のreport/candidate/sitemap上限・retentionを既要求 |
| JSON-LD injection | **False positive** | v1はRecipe / ItemList JSON-LDを出さず、将来script JSONのcontext escapeも要求済み |
| 通常HTML XSS | **False positive** | arbitrary HTML / Markdown HTML / user URL / `dangerouslySetInnerHTML`を禁止しcontext別escapeを要求済み |
| slug列挙 | **False positive** | sitemap公開を意図し、slugをauthorizationに使わないため列挙自体は脆弱性でない |
| Service Workerのauth origin takeover | **False positive** | SWはorigin scopeであり、別exact origin不変条件で成立しない |
| 公開広告scriptからauth localStorage読取 | **False positive** | Web Storageはorigin分離される。同一origin誤deployはnegative deploy test対象 |
| report件数による自動検閲 | **False positive** | reportだけで自動withdrawしない。DoS対策は別途既存boundを維持 |
| private tableのanon grant | **False positive** | table direct grantは禁止済み。確定F-01はcredential全体のblast radiusという別問題 |
| A-M-02の`unsafe-inline/eval`禁止案 | **False positive部分** | Google公式AdSense strict CSPが両directiveを含むため、禁止するとad flowを壊し得る |
| exact AdSense/CMP CSP | **Accepted residual** | Phase 3時点の公式templateと実console設定なしにexact domain/directiveを固定しない。Report-Onlyから検証 |
| 検索cache・第三者転載の即時消去 | **Accepted residual** | 自サイトはno-store/read-closeするが第三者copyの完全削除は保証不能。事前説明とrunbookで扱う |
| platform access log | **Accepted residual** | application DB外の保持はNetlify設定・契約に依存し、analyticsへ複製しない |

## 4. 人間判断として残すもの

次は偽陽性ではないが、repositoryだけでは値を決められないためSpecのblockerに残した。

1. exact public originと別registrable domainの採否。
2. v1公開requestを`is_selected=true`だけへ限定するproduct判断。
3. authority tombstone、audit、report等の保持期間・法的根拠・legal hold。
4. 公開同意、利用許諾、外部送信、privacy、rights noticeの法務文言。
5. operator / moderation owner、KPI、費用上限、AdSense / CMPの外部状態。

## 5. 修正後判定

3件のCriticalと確定Important / MinorはSpecへ反映した。現時点のSpecは安全なImplementation Planの前提を
定義できているが、§16の人間blockerが未承認であるため、実装、production publish、AdSense申請・配信を
開始してはならない。

## 6. 修正後確認の追補

別の読み取り専用Reviewerが安定snapshotでF-01〜F-16のclosureを再確認した。Criticalは0件、Importantが
次の2件残り、いずれも再現後にSpecへ追加修正した。

1. F-04 / F-11: current consent versionのDB正本がなく、旧read RPCへのrollbackで旧version本文が復活し得た。
   - §6.1 runtime stateへ`current_public_recipe_consent_version`を追加した。
   - accept / request / approve / publish / 全read RPCが同じrowを参照し、version / config generationを原子的に
     進め、旧RPCでもread-closeする契約とtestを追加した。
2. F-03: menu deleteだけ「authorityを最初にlock」と書かれ、共通lock順と矛盾していた。
   - §7.2を`runtime → authority → consent → candidate/revision → publication → source menu`へ統一した。
   - §13.3のaccount-delete専用RPCも同じ共通順を使うと明記した。

non-blocking hardeningとして、read function ownerにはprivate schemaの`USAGE`だけを与えて`CREATE`を拒否し、
pilotのno-store headerへ`Netlify-CDN-Cache-Control`も追加した。上記追補後、該当語句とlock順を親が再読し、
裁定上の未解決Critical / Importantが残っていないことを確認した。人間blockerは引き続き未承認である。
