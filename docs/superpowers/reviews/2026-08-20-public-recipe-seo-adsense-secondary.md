# 公開レシピ SEO / AdSense 段階実証 — 二次検証

- 日付: 2026-08-20
- 対象Spec: `docs/superpowers/specs/2026-08-20-public-recipe-seo-adsense-pilot-design.md`
- 入力: 同日付の一次レビュー、敵対的レビュー
- 実施者: 両レビューと別スレッドの読み取り専用 Reviewer
- 判定: **REVISE — Critical 3 系統、Important 8 系統を統合して修正**

## 1. 総合 Verdict

主要懸念は概ね再現したが、重複が多い。Critical は次の3根本原因へ統合できる。

1. 公開 Site に main `service_role` を置く blast radius
2. 本人・運営承認と immutable revision / canonical hash の未結合
3. revoke・account delete・publish を直列化する durable fence の欠落

Important は consent version、404 / 410 と cache、operator auth、same-site、Unicode、広告適格性、
rollback、現行 menu predicate である。さらに Phase 1 seed content の作成経路矛盾を新規確認した。

## 2. 再確認した事実

- 現行server clientはmain `SUPABASE_SERVICE_ROLE_KEY`を使う。
  `netlify/functions/_shared/supabase-admin.ts`: 9–20 行。
- `service_role`はmenus、世帯、privacy、shopping等のpublic表に`ALL`を持つ。
  `supabase/migrations/20260731170000_service_role_public_table_grants.sql`: 14–43 行。
- Supabaseの`sb_secret_*`も`service_role`としてRLSをbypassする全権keyであり、keyの個別rotationは権限scopeを
  狭めない。公開readはpublishable keyの`anon`、限定DB LOGIN role、専用projection等を比較する必要がある。
- 現行account delete lockはTTL付きDELETE間lockであり、公開処理のdurable fenceではない。
  `supabase/migrations/20260812200000_account_delete_lock_and_feedback_idempotency.sql`: 7–75 行。
- 現行共有publishはconsent rowを`FOR UPDATE`する。このpatternは再利用できる。
  `supabase/migrations/20260818130000_publish_share_consent_for_update.sql`: 133–161 行。
- Auth sessionは現在localStorageであり、same-site findingは現在のsession theftでなくdomain選択と将来回帰の問題。
- 既存denylistはNFKC、Cf除去、空白・区切り除去、分割field照合を持つが、承認・保存・hash・renderが同じ
  canonical bytesを使う契約ではない。
- `menus`に`finalized` / `deleted_at`はなく、`is_selected`は版の採用状態である。
- Netlify Function responseは既定ではCDN cacheされず、cacheをopt-inした場合にstale/purge問題が成立する。
- Googleの現行AdSense strict CSP例はnonceに加え`'unsafe-inline'`、`'unsafe-eval'`、`'strict-dynamic'`、
  `https:`、`http:`を含む。Specの公式strict CSPとReport-Onlyからの検証方針は整合する。

公式根拠:

- <https://supabase.com/docs/guides/getting-started/api-keys>
- <https://supabase.com/docs/guides/database/postgres/roles>
- <https://docs.netlify.com/build/caching/caching-overview/>
- <https://support.google.com/adsense/answer/16283098>

## 3. 元指摘の二次判定

`P-*`は一次、`A-*`は敵対的レビューを表す。

| 元ID | 判定 | 最終severity | 統合判断 / Spec修正 |
| --- | --- | --- | --- |
| P-C-1 | Confirmed | Critical | main全権keyのblast radius。rendererは限定read credential / gatewayへ変更 |
| A-I-01 | Duplicate | Critical | P-C-1へ統合。`sb_secret_*`も権限scopeは全権 |
| P-C-2 | Confirmed | Critical | TTL delete lockでは不足。durable user fenceが必要 |
| A-C-02 | Duplicate | Critical | P-C-2のrevoke/publish競合へ統合 |
| A-C-03 | Duplicate | Critical | P-C-2のaccount-delete競合へ統合 |
| P-I-1 | Confirmed | Important | consent version/generationをpublication authorityへ結合し、bumpでread-close |
| P-I-2 | Confirmed | **Criticalへ昇格** | immutable revision、両承認hash、1 candidate = 1 publicationが必要 |
| A-C-01 | Duplicate | Critical | P-I-2へ統合 |
| P-I-3 | Confirmed | Important | read DTOを`published \| withdrawn \| not_found`へ固定 |
| P-I-4 | Confirmed | Important | pilotは`no-store`またはstatus-first authority、purge/readbackを固定 |
| A-I-03 | Duplicate | Important | P-I-4へ統合 |
| P-I-5 | Confirmed | Important | operator / workerのauthN、MFA、TTL、失効、audit主体を固定 |
| A-I-07 | Duplicate | Important | P-I-5へOrigin/CSRF/replay条件を統合 |
| P-M-1 | Confirmed | Minor | Referrer-Policyの値とCTA `noreferrer`を固定 |
| P-M-2 | Needs human decision | Important | `finalized`を現行DB上のexact predicateへ置換 |
| A-I-02 | Needs human decision | Important | 別registrable domain優先。同一siteならhost-only Cookie等を固定 |
| A-I-04 | Confirmed（範囲縮小） | Important | 既存検出対策はあるがcanonical bytesの工程間一致がない |
| A-I-05 | **False positive** | — | WAFだけでなくclosed input、bounded response、timeout、Phase 0上限をSpecが既要求 |
| A-I-06 | Confirmed | Important | revision-bound / default-denyな広告適格性が必要 |
| A-I-08 | Confirmed | Important | schema / RPC / rendererのdeploy・rollback安全性が未定義 |
| A-M-01 | Confirmed | Minor | 非許可queryの応答、cache key、広告有無を固定 |
| A-M-02 | Accepted residual | Minor | exact CSPはPhase 3で公式templateへ固定。公式より厳しくして広告を壊さない |
| A-M-03 | Confirmed | Minor | report / audit / withdrawal metadataのretentionをPhase 0へ追加 |

補足:

- 一次P-I-5の「既存ops roleはNOLOGINのみ」は表現が不正確だが、既存roleがreadonlyで公開審査write主体に
  使えないという根本指摘は成立する。
- Netlify Functionが既定非cacheであるため、cache findingは「現在ただちにstaleになる」でなく、Specが許す
  opt-in cacheの契約不足として成立する。

## 4. 新規指摘

### N-I-01: Phase 1 seed content を作る権威経路がない

判定: **Confirmed / Important**

Phase 1 は運営者seedを公開するが、publish RPCはuser approval、operator approval、current consentをすべて
要求する。table CRUDもrevokeするため、実装者が偽user、汎用service-role write、直接DB編集へ逸脱し得る。

修正:

- `source_kind = operator_seed | user_contribution`を閉じた型にする。
- seed専用RPCに権利根拠、immutable revision、operator checklist / identityを要求する。
- seedだけuser consent非適用とし、直接table writeは許さない。

### N-I-02: 元献立の個別削除と公開の関係が未決定

判定: **Needs human decision / Important**

現行`delete_menu_group`はhard deleteで、candidate/originはsource menu delete時に`SET NULL`となる。履歴削除で
公開もwithdrawするか、公開copyは残すかを人間が決め、いずれもdelete/publish競合testを持つ必要がある。

### N-I-03: 全公開 kill switch の authority が未定義

判定: **Confirmed / Important**

全公開停止を結論とPhase 1条件に含めるが、global state、read RPCでの優先順位、cache無効化、復旧条件がない。
global killはcleanupより先にread-closeし、ad killとは独立させる。

## 5. Implementation Plan前のmust-fix

1. renderer credentialをmain service-roleから分離する。
2. immutable revision / canonical approval contractとpublish冪等性を固定する。
3. 公開可否の共通durable user fence、lock順、削除失敗時の補償を固定する。
4. consent version transitionと旧publicationの即時read-closeを固定する。
5. 公開read/HTTP/cache union、status別header、global kill優先順位を固定する。
6. operator / worker / seedの認証・実行面を決める。
7. registrable domainとsame-site Cookie方針を人間が決める。
8. Unicode/public payload canonicalizationを固定する。
9. 広告適格性をrevision-boundかつdefault-denyにする。
10. deploy/rollback互換、現行menu predicate、source menu削除時の公開方針を固定する。

読み取り専用レビューのみ実施し、ファイル変更・テスト・外部書き込みは行っていない。
