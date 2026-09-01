# 公開レシピ SEO / AdSense 段階実証設計 — 一次レビュー

- 日付: 2026-08-20
- 対象: `docs/superpowers/specs/2026-08-20-public-recipe-seo-adsense-pilot-design.md`
- 実施者: 読み取り専用 Reviewer
- 判定: **REVISE — Critical 2 件、Important 5 件**

## 1. Verdict

別 origin、公開専用 snapshot、既存共有同意の不流用、本人 preview と運営審査、広告導入の段階 gate
という基本方針は妥当である。ただし、実装 Plan 作成前に次の境界を閉じる必要がある。

- 公開 Site に配置する `service_role` credential の侵害範囲
- revoke / account delete / publish の直列化
- 同意 version 更新時の既公開ページ
- 承認対象 payload の不変性と publish 冪等性
- 410 と CDN 停止の応答契約
- operator / worker 専用 role の実際の認証・呼出方式

## 2. Critical

### C-1: 公開・広告実行面にアプリ全権の `service_role` credential を置く設計

根拠:

- Spec: 35–36、99–100、287–305 行
- `supabase/migrations/20260731170000_service_role_public_table_grants.sql`: 1–43 行
- `netlify/functions/_shared/supabase-admin.ts`: 9–21 行

公開 HTML Function が `service_role` 限定 read RPC を呼ぶ契約だが、現行 `service_role` は menus、
profiles、household、privacy、shopping 等に強い権限を持つ。RPC が read-only でも credential 自体は
read-only ではない。

成立条件:

1. 公開 Site の Function bundle、環境変数、依存関係、Netlify Site 管理権限のいずれかが侵害される。
2. 取得された key で認証アプリ側の Data API、service-role RPC、Auth Admin を呼ぶ。
3. 公開面だけの侵害が認証アプリ全体へ波及する。

第三者広告 JavaScript が server env を直接読めるという指摘ではなく、公開入力を常時受ける Site に
同一 project の全権 credential を置く blast-radius の問題である。

必要な修正:

- renderer credential を `service_role` と分離する。
- 公開 DTO の限定 RPC だけを実行できる dedicated role / 短命 token、公開専用 gateway、または公開専用
  project / DB projection を比較して固定する。
- public table CRUD、Auth Admin、既存 service-role RPC が失敗することを pgTAP / integration で固定する。
- public Site と auth Site の環境変数、deploy token、Netlify team role も分ける。

### C-2: account delete と publish が同じ削除 authority をロックしない

根拠:

- Spec: 121、293–301、368–370、643–657 行
- `netlify/functions/delete-account.ts`: 128–146、163–186、503–554 行
- `supabase/migrations/20260812200000_account_delete_lock_and_feedback_idempotency.sql`: 7–69 行
- `supabase/migrations/20260818130000_publish_share_consent_for_update.sql`: 53–69、133–161 行

Spec は delete-account の lock 取得後に全件 withdraw するとするが、candidate request / approve / publish
が deletion lock または durable tombstone を確認する契約がない。publish の「同一 transaction で再確認」
だけでは revoke と線形化できず、現行共有が採用済みの `FOR UPDATE` も未指定である。

成立例:

1. T1 が account-delete lock を取得する。
2. T1 が既存 publication を withdraw する。
3. T2 が deletion lock を見ず、残存する Auth user と consent で publication を作る。
4. T1 が Auth user を削除し、origin の contributor FK が `SET NULL` になる。
5. T2 の publication が published のまま相関を失う。

必要な修正:

- account deletion 開始時に単調な `deleting` tombstone / gate を DB transaction で確定する。
- request、本人承認、運営承認、publish、revoke、account-delete withdrawal が同じ per-user gate を固定順で
  lock する。
- publish は candidate と consent row を `FOR UPDATE` し、current version / generation / non-revoked /
  non-deleting を lock 下で確認する。
- account delete は gate 確定、publication 閉鎖、Auth delete の順にする。
- transaction cut を双方向に競合させる DB test を追加する。

## 3. Important

### I-1: consent version 更新時に旧 version の既公開ページを閉じる規則がない

根拠: Spec 116–123、184–195、224–250、316–327 行。

exact current version を有効条件にする一方、version bump 時の read-close、cleanup、re-consent が未定義で、
publication / origin に承認時 consent version / generation も固定されていない。

修正案:

- version bump を authority transition とする。
- 旧 version publication の即時 read-close gate と bounded cleanup を定義する。
- publication authorization に version / generation を結び付ける。
- version bump、re-accept、旧 candidate replay、旧 publication read を DB test に加える。

### I-2: 本人・運営の承認対象と publication payload の同一性、状態遷移、冪等性が不変条件でない

根拠: Spec 197–250、283–285、348–370 行。

candidate には preview payload があるが、本人と運営が承認した canonical hash / schema version、承認時刻、
承認主体がない。origin の candidate FK / unique、許可遷移表、各遷移の required fields も未定義である。

修正案:

- immutable payload revision を作り、本人・運営承認を同じ canonical hash と schema version に束縛する。
- publish は candidate を `FOR UPDATE` し、両承認 hash と current hash の一致を確認する。
- origin の candidate に FK / unique を置き、一 candidate 一 publication を保証する。
- allowed transition matrix、terminal 状態、nullability / check constraint を定義する。
- retry は既存 publication を返す idempotent success とする。

### I-3: read RPC で unknown 404 と withdrawn 410 を判別できない

根拠: Spec 299–300、389–397、632–641 行。

`get public page by slug` が published row だけを返すと、unknown と withdrawn はどちらも rowless になる。

修正案:

- DTO を `published`、`withdrawn`、`not_found` の閉じた union にする。
- withdrawn は payload、reason、origin、内部時刻を返さない。
- GET / HEAD、404 / 410 / 5xx の body、cache、広告、`X-Robots-Tag` を exact contract にする。

### I-4: 「サイト自身は即時停止」と CDN stale 許容の関係が未確定

根拠: Spec 42、493–496、632–663、737–748 行。

DB read-close 後も HTML は purge と最大 stale window に依存する。検索 cache / 第三者転載の残差とは別に、
自サイト CDN の停止 authority が必要である。

修正案:

- withdraw 成功を DB commit、edge purge readback、最大 TTL のどこに置くか固定する。
- account delete は自サイト/CDNで本文が返らないことを確認するか、user由来HTMLを `no-store` / 常時
  authority revalidation にする。
- purge failure、古い edge、同時 request を production rehearsal に加える。

### I-5: operator / worker role の認証主体と呼出経路が未定義

根拠:

- Spec 297–305、434–440 行
- `supabase/migrations/20260811180000_ops_readonly_role.sql`: 1–24、47–50 行
- `netlify/functions/_shared/supabase-admin.ts`: 9–21 行

現行 ops role は `NOLOGIN`、readonly、`postgres` からの `SET ROLE` 用である。新 operator / worker role を
誰がどの credential で、PostgREST、直接 DB、管理 console のどこから呼ぶかが未定義である。

修正案:

- operator / worker ごとに authN、role 取得、token TTL、失効、MFA、credential 保管、実行面を固定する。
- operator identity は client input でなく検証済み主体から audit へ記録する。
- service-role 汎用 write、operator なりすまし、worker RPC の人間実行が失敗する test を加える。

## 4. Minor

### M-1: public Site の `Referrer-Policy` 値が固定されていない

Spec 172–178、498–507 行は header 名だけを指定している。auth origin への CTA は少なくとも cross-origin
で path / query を送らない policy とし、`rel="noreferrer"` も検討する。

### M-2: `finalized` / `未削除` の現行 DB predicate が存在しない

Spec 294、330–336、589–592 行に対し、`supabase/migrations/20260711001100_menu_core.sql` 1–37 行の
`public.menus` には finalized status / deleted_at がない。Implementation Plan 前に exact predicate を現行
contract に合わせて固定する必要がある。

## 5. 誤検知の可能性

- C-1: 未記載の公開専用 project / restricted credential が既決なら解消するが、現Specは `service_role` と明記する。
- C-2: 未記載の共通 deletion gate が全RPCに既定なら解消し得るが、現Specと現行削除 lockから確認できない。
- I-2: 実装Planで payload 差替え禁止と一意 publication を固定する予定でも、設計 authority に不変条件がないため
  現時点では未解消である。
- AdSense / CMP / CSP の最新外部要件は核心指摘の根拠にしていない。Phase 3 直前に公式資料と実 console で
  再確認する方針は妥当である。

## 6. 良い点

- 認証 origin と広告実行 origin、および storage / SW / postMessage / CORS の分離。
- 緊急共有同意の不流用と backfill 禁止。
- raw menu でなく versioned allowlist snapshot を使う公開境界。
- 本人 preview、本人承認、運営承認、publish transaction の多段 gate。
- 200 / 404 / 410、canonical、初回 HTML、noindex、sitemap 除外の SEO 契約。
- AdSense を Phase 3 へ隔離し、manual slot と広告失敗時の本文可用性を求める方針。
- private table direct grant 禁止、固定 `search_path`、schema-qualified name、明示 GRANT / REVOKE、pgTAP inventory。

読み取り専用レビューのみ実施し、ファイル変更・テスト・外部書き込みは行っていない。
