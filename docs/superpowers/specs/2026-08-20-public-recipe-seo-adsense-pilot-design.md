# 公開レシピ SEO / AdSense 段階実証設計

- 日付: 2026-08-20
- 状態: **一次・二次・敵対的レビュー反映済み・人間承認待ち**
- 種別: 設計。**本書だけでは実装、公開、計測、AdSense 申請・配信を開始しない**
- 対象: 認証アプリとは別 origin の公開献立面、公開専用データ境界、公開同意、SEO、運用審査、限定 AdSense 実証
- 非対象: 既存認証アプリへの広告、既存緊急共有プールの自動公開、Plus / Stripe、成果報酬リンク、価格・quota・AI allowlist の変更
- 関連:
  - [Google AdSense 導入 — 見送りの判断記録](./2026-08-09-adsense-decision.md)
  - [無料ユーザー収益化 — AdSense 見送り後の比較判断記録](./2026-08-09-free-tier-monetization-decision.md)
  - [匿名緊急共有レシピ設計](./2026-08-01-community-emergency-share-design.md)
  - [分量表記の読みやすさ + 共有同意既定オン設計](./2026-08-08-quantity-display-and-share-default-design.md)
  - [プライバシーを守る収益計測設計](./2026-08-11-privacy-preserving-revenue-measurement-design.md)
  - [無料 LP を最初の HTML で読ませる設計](./2026-08-16-public-landing-html-seo-design.md)
  - [一次レビュー](../reviews/2026-08-20-public-recipe-seo-adsense-primary.md)
  - [敵対的レビュー](../reviews/2026-08-20-public-recipe-seo-adsense-adversarial.md)
  - [二次検証](../reviews/2026-08-20-public-recipe-seo-adsense-secondary.md)
  - [指摘裁定](../reviews/2026-08-20-public-recipe-seo-adsense-adjudication.md)

---

## 1. 結論

公開献立面を段階的に新設し、検索需要を先に検証したあと、条件を満たした公開ページだけで
AdSense を限定実証する。

ただし、認証アプリと広告実行面を同一 origin に置かない。現在の認証アプリは Supabase
session を `window.localStorage` に保持し、`/` scope の Service Worker と厳格 CSP を持つ。
第三者広告 JavaScript を同じ実行 origin に入れると、session storage、CSP、Service Worker、
認証 callback の防御境界を共有してしまう。本設計では、公開面を別 Netlify Site / 別 origin
へ分離する。

| 項目 | 決定 |
| --- | --- |
| 配信 origin | 認証アプリと異なる exact HTTPS origin。別 registrable domain を優先。symbolic 名は `PUBLIC_RECIPE_ORIGIN` |
| 初回検証 | AdSense なし。運営者が権利・品質を確認した専用コンテンツだけで SEO を検証 |
| ユーザー由来公開 | 新規献立だけ。献立単位の明示操作、一般化後 preview、利用者承認、運営審査をすべて通す |
| 既存共有プール | 自動公開・backfill・既存同意の流用を禁止 |
| 公開データ | `private` の immutable 公開専用 revision / snapshot。raw menu / origin / contributor / household を返さない |
| 読取 | 公開 HTML Function が publishable key の `anon` で公開 DTO read RPC だけを呼ぶ。main `service_role` / `sb_secret_*` は公開 Site に置かない |
| SEO | 初回 HTML に本文、固有 title / description / canonical。active のみ sitemap |
| 構造化データ | v1 は Recipe rich result を狙わない。実料理を表す権利確認済み画像が無いため |
| 広告 | SEO と公開運用の gate 通過後、運営審査済み詳細ページの固定位置だけ。Auto ads は pilot で使わない |
| CSP | 公開 origin だけで nonce 型 AdSense CSP。認証アプリの CSP は変更しない |
| 計測 | Search Console、AdSense 正本、非識別 server aggregate。第三者 analytics SDK は入れない |
| 撤回 | 全公開の一括停止と献立単位の取り下げを提供。account delete 前に公開を fail-closed で停止 |
| cache | pilot の本文・一覧・sitemap は `no-store`。status authority を迂回する payload / stale cache を作らない |

本書が人間承認された時点で、`2026-08-09-adsense-decision.md` の「公開面が無い」前提を、
この限定実証の範囲だけ条件付きで supersede する。承認前、および各 Phase の gate 通過前は、
従来の「AdSense を実装しない」を正とする。

## 2. 目的と対象外

### 2.1 目的

1. 認証 session と広告 JavaScript を origin で分離する。
2. 提供者の同意目的を「認証内の緊急候補」と「検索可能な広告付き Web 公開」で分離する。
3. 公開専用 snapshot だけを初回 HTML に載せ、検索エンジンが JavaScript なしでも読めるようにする。
4. 公開前の PII、安全、品質、権利、重複審査と、公開後の通報・停止・削除を運用可能にする。
5. 広告実装前に検索需要と公開運用コストを観測し、収益化の投資判断を行えるようにする。
6. AdSense の売上を client 申告でなく AdSense の確定レポートから評価する。

### 2.2 対象外

- 認証アプリの `/history`、`/shopping`、`/menus/:menuId`、`/plus` への広告
- 認証アプリの CSP、AuthProvider、BrowserSupabaseClient、Service Worker scope の変更
- 現行 `shareConsentVersion` の意味変更、または既存同意者の公開同意扱い
- `private.shared_emergency_recipes` の anon / authenticated / browser への直接公開
- 既掲載緊急共有レシピの一括公開、暗黙の再同意、backfill
- 公開閲覧者ごとの personalization、閲覧履歴、recommendation、コメント、評価
- 公開面から認証アプリへの session 引継ぎ、cross-origin postMessage、共有 Cookie
- 商品広告、affiliate link、スポンサーによる献立内容への介入
- 公開用画像の生成・投稿・Storage 設計と Recipe rich result
- 本書だけでの AdSense アカウント申請、CMP 設定、production domain / DNS 変更

### 2.3 文書 authority

- 実装・contract・migration が現状の事実の正本である。
- 本書は人間承認後に、公開献立 / AdSense 限定実証だけの新しい設計 authority になる。
- 既存の匿名緊急共有、Plus、first-party 収益計測の意味は本書で書き換えない。
- 本書と既存文書の scope が重なる箇所は、実装 Plan 作成前に関連文書へ「限定 supersede」の
  相互リンクを追加する。承認前に古い判断記録を削除・上書きしない。

## 3. 現状とギャップ

| 現状 | 公開実証に必要な差分 |
| --- | --- |
| `private.shared_emergency_recipes` は service-role 限定 RPC から認証内緊急候補へ出す | 公開専用 candidate / snapshot / state machine が必要 |
| 現行共有は自動抽選、一般化後に本人 preview なし | 献立単位 request、一般化後 preview、本人 approve、運営 approve が必要 |
| 共有停止後も既提供分は残る | 公開同意の停止で公開分を withdraw、個別取り下げも必要 |
| `/* -> /app.html` の SPA fallback | 別 Site で `/recipes/:slug` の初回 HTML response が必要 |
| `robots.txt` は `/` 以外を拒否 | 公開 Site 専用 robots / sitemap が必要 |
| 認証アプリは `script-src 'self'` | 公開 Site だけに AdSense nonce CSP が必要 |
| `/privacy` は認証必須、広告・Cookie の記載なし | 認証不要の privacy / external-transmission / terms が必要 |
| 共有 payload に画像なし | v1 は Recipe rich result 非対象。画像を偽造・流用しない |
| 現行 admin 共有 viewer は閲覧専用かつ設計段階 | 公開審査・withdraw 用の限定 write 運用面が別途必要 |

## 4. 不変条件

### 4.1 origin / Auth

1. `PUBLIC_RECIPE_ORIGIN` は認証アプリと scheme / host / port のいずれかが異なる exact HTTPS origin とする。
2. 公開 Site は認証アプリの JavaScript chunk、Supabase browser client、publishable key、Auth storage key、Service Worker を配信・登録しない。
3. 公開 Site と認証アプリの間で Cookie、localStorage、session、postMessage、credentialed CORS を共有しない。
4. 公開 Site から認証アプリへの導線は exact HTTPS URL の通常 navigation だけとする。
5. 認証アプリ側の CSP / callback header / Service Worker / localStorage session は変更しない。
6. `PUBLIC_RECIPE_ORIGIN` は別 registrable domain を優先する。同一 registrable domain の subdomain を
   選ぶ場合、両 Site の Cookie は host-only とし、`Domain` attribute を禁止する。将来 Cookie Auth を
   導入するときは本境界を再レビューし、`__Host-` prefix、Set-Cookie inventory、same-site request、
   credentialed CORS の回帰 test を先に追加する。
7. public Site には auth Site の環境変数、deploy token、main Supabase secret を複製しない。Netlify Site の
   管理権限と deploy credential も分離する。

### 4.2 公開データ

1. raw `menus`、`menu_payload`、household、preference / safety snapshot、pantry、label confirmation、origin、contributor を公開 response に含めない。
2. 公開 snapshot の nested ID は source UUID を使わない。renderer が `dish-1` / `step-1` の局所 anchor を生成する。
3. `source_menu_id`、`contributor_user_id`、candidate / publication 内部 UUID、job / model / failure 情報を HTML、JSON-LD、URL、ログへ出さない。
4. 公開 payload は閉じた versioned schema の allowlist projection とし、raw `ValidatedMenu` をそのまま保存・返却しない。
5. browser へ service role / secret key を出さない。公開 Site の server Function だけが限定 RPC を呼ぶ。
6. public / anon / authenticated に公開 snapshot table の直接 `SELECT` を付与しない。
7. 公開 URL は列挙される前提とする。public slug を認可・秘匿の代用にしない。
8. 公開 Function は main `service_role`、legacy service-role JWT、`sb_secret_*` を保持しない。Supabase の
   publishable key を未認証 `anon` として使い、公開 DTO read RPC 以外の権限を増やさない。
9. read RPC は公開 endpoint から直接呼ばれ得る前提で、1 slug / bounded sitemap page 以外を受けず、
   statement timeout と response bound を DB 側でも持つ。Netlify WAF を唯一の費用境界にしない。
10. 公開文字列は projection 前に versioned canonicalization を行う。canonical JSON bytes を本人 preview、
    PII / 品質 gate、hash、両承認、保存、render の共通正本とし、工程ごとに別の正規化をしない。

### 4.3 同意

1. 現行 AI 説明同意、匿名緊急共有同意、収益計測同意、利用規約同意を公開同意として流用しない。
2. `publicRecipeConsentVersion` を別 contract とし、文言変更・公開目的・第三者送信・残存方針の変更で版を上げる。
3. 公開 request は献立単位の明示操作とする。pre-checked、初回フローへの抱き合わせ、自動抽選を禁止する。
4. 一般化後の公開 preview を本人が確認して approve するまで運営審査へ進めない。
5. 本人 approve 後も、運営 approve と publish transaction 完了までは公開しない。
6. 同意または献立単位承認が失効した candidate は publish しない。各外部 AI call 前と publish transaction 内で再確認する。
7. 公開同意の全体停止は新規処理だけでなく、その本人に対応する全 published snapshot を withdraw する。
8. 既存緊急共有プールは公開同意の有無に関係なく backfill しない。
9. current consent version を上げた瞬間、旧 version の user contribution は read RPC が本文を返さない。
   cleanup や再同意を待って旧本文を配信し続けない。再同意後も旧 candidate / publication を自動復活しない。

### 4.4 内容・安全・権利

1. 一般化 AI 成功だけで公開適格にしない。決定論 gate、本人 preview、運営 checklist の三段を必須にする。
2. 「アレルギーに安全」「幼児に安全」等の保証をしない。個人向け adaptation / eligible age band を公開表示しない。
3. 料理名、材料、数量、手順、時間の相互矛盾、危険手順、PII、権利侵害疑い、近似重複を運営審査対象にする。
4. 利用者には、公開・検索 index・広告掲載・編集 / 一般化・取り下げ・利用許諾を平易に説明する。
5. 通報だけで自動非公開にしない。緊急 kill switch と人間確認を分離する。
6. 広告は安全注意、材料、手順、通報 / 取り下げ導線を覆わない。
7. user contributionの本人・運営承認は同一immutable revisionのcanonical hashに束縛する。operator seedは
   権利intakeと運営承認を同じhashに束縛する。revisionが変わればsource kindごとの全承認を失効し、再preview /
   再reviewなしにpublishしない。

### 4.5 広告・計測

1. AdSense code は Phase 3 gate 通過後の公開詳細ページにだけ載せる。
2. pilot は Auto ads を使わず、review 済み固定 slot だけとする。
3. publisher content が無い、薄い、withdrawn、404 / 410、privacy、terms、report 完了、navigation-only の画面に広告を出さない。
4. 広告クリックを促す文言、誤タップを誘う配置、content より多い広告を禁止する。
5. client analytics SDK、広告とは別の tracking pixel、fingerprinting を追加しない。
6. 公開閲覧と認証 user / contributor / household / billing を結合しない。
7. 売上正本は AdSense report、検索正本は Search Console、費用正本は Netlify / Supabase の請求・利用量とする。
8. 広告適格性は publication revision 単位の default-deny record とする。global phase flag や URL allowlist
   だけで広告を出さず、record が無い、hash / policy version が違う、withdraw / kill 中なら ad / CMP code
   自体を HTML へ出さない。

## 5. 全体アーキテクチャ

```text
[認証アプリ origin]
  所有者が完成献立で「Web 公開候補にする」
       │ authenticated request / exact menu ownership
       ▼
[Supabase]
  durable user authority fence + consent generation
  private candidate + immutable revision + origin
       │ async generalization（既存 helper を再利用可、job は別）
       ▼
  closed public snapshot preview
       │ 本人 approve
       │ 運営 review / approve
       ▼
  publish transaction
       │ publishable key / anon から限定 read RPC
       ▼
[公開レシピ Netlify Site: PUBLIC_RECIPE_ORIGIN]
  Function → escaped first HTML → crawler / visitor
       ├─ privacy / terms / external transmission
       ├─ robots.txt / sitemap.xml
       └─ Phase 3 のみ CMP + AdSense
```

公開 Site は同じ repository で管理してよいが、認証アプリと別 Netlify Site / deploy / origin にする。
production DNS 名、Netlify Site 名、directory / package 構成は Plan 前に人間が確定する。

### 5.1 cross-origin 境界

- 公開 Site は認証アプリ API を proxy しない。
- 認証アプリの `/api/*` と同名 path を公開 Site へ持ち込まない。
- 公開 Site の report API は公開 Site 自身の Function path に閉じる。
- 認証アプリへの「献立を作る」リンクには contributor、publication、検索 query を渡さない。
- 公開 Site から `PUBLIC_RECIPE_ORIGIN` 外へ送る query / referrer を最小化し、広告以外の第三者 asset を使わない。
- 認証アプリへの CTA は query を付けず `rel="noreferrer"` を付ける。public response の
  `Referrer-Policy` は `strict-origin-when-cross-origin` に固定する。

### 5.2 実行主体

| 主体 | credential / authority | 禁止事項 |
| --- | --- | --- |
| public renderer | publishable key の未認証 `anon`。公開 read RPC の `EXECUTE` だけ | main service role、secret key、Auth Admin、table CRUD |
| user flow | Supabase Auth user JWT。本人 RPC が `auth.uid()` と ownership を検査 | operator claim、client指定 user ID |
| generalization / publish worker | public Site と分離した restricted noninteractive DB / worker credential。lifecycle RPCだけ | main table汎用CRUD、operator identityの代理入力 |
| operator | 検証済みAuth主体、AAL2、private operator allowlist、短い再認証 | 共有service-role、client入力のaudit identity、直接table編集 |
| account deletion | auth Siteの既存削除Function + 公開削除専用RPC | public SiteからのAuth Admin操作 |

公開 read RPC は `SECURITY DEFINER` とし、owner は専用 `NOLOGIN` role にする。その owner にも read に必要な
private relation の最小 `SELECT` だけを与え、`postgres` / `service_role` を owner にしない。`PUBLIC` の既定
`EXECUTE` を revoke し、`anon` だけへ明示 grant する。公開情報なので key の秘匿性へ依存せず、RPC 自体を
直接呼ばれても公開 DTO 以外を返さない設計にする。
専用ownerへは`private` schemaの`USAGE`だけを与え、`CREATE`は与えない。

worker の exact 接続方式は、restricted Postgres LOGIN + transaction pooler、または同等にscopeを固定できる
gatewayをPhase 0でspikeして決める。Supabaseの`sb_secret_*`はkeyを分けても`service_role` / `BYPASSRLS`
相当の全権であるため、「別名のsecret key」をleast privilegeの代用にしない。

## 6. データモデル

すべて概念名。実 migration 名と exact SQL は Implementation Plan で固定する。

### 6.1 runtime state — `private.public_recipe_runtime_state`

singleton row として次を持つ。

- `public_read_enabled boolean not null default false`
- `public_publish_enabled boolean not null default false`
- `ads_enabled boolean not null default false`
- `current_public_recipe_consent_version text not null`
- `config_generation bigint not null`
- `updated_at` / 検証済み `updated_by_operator_id`

公開 read は最初に `public_read_enabled` を確認し、false なら publication status に関係なく本文なしの
`disabled` を返す。publish は `public_publish_enabled` が false なら拒否する。広告は public read / publish と
独立した `ads_enabled` に加え、§6.8 の個別適格性がある場合だけ出す。kill は cleanup や purge より先に
この row を commit し、read-close を authority とする。復旧はAAL2 operatorの別操作とreadbackを必要とする。
`current_public_recipe_consent_version`は同意versionの唯一のDB正本とし、accept / request / approve / publish /
全versionのread RPCがhard-codeせず同じrowを参照する。version bumpはruntime rowを`FOR UPDATE`してversionと
`config_generation`を同一transactionで進め、旧RPC / 旧rendererへのrollbackでも旧version本文を閉じ続ける。

### 6.2 user authority fence — `private.public_recipe_user_authorities`

- `id uuid primary key` — 公開しないrandom authority ID
- `user_id uuid unique null references auth.users(id) on delete set null`
- `state`: `active | revoked | deleting | deleted`
- `consent_generation bigint not null`
- `created_at` / `updated_at`

`deleting` / `deleted` は TTL で自動解除しない。Auth user削除後も `id` と terminal state だけを最小の
非公開tombstoneとして残し、publication originはこのauthority IDを参照する。これによりAuth FKがNULLに
なってもread RPCは本文をfail-closedにできる。保持根拠・retention・access roleはPhase 0で人間確認する。

公開可否を変えるwriteは、`runtime state → user authority → consent → candidate/revision → publication` の順で
必要rowをlockする。request、本人承認、運営承認、publish、revoke、元献立削除、account deleteが別の
lock順を発明しない。

### 6.3 公開同意 — `public.user_public_recipe_consents`

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `consent_version text not null`
- `consent_generation bigint not null`
- `accepted_at timestamptz not null`
- `revoked_at timestamptz null`
- `authority_id uuid unique not null references private.public_recipe_user_authorities(id)` — direct response非公開
- 本人用RPCだけが公開用DTO（version / generation / accepted / revoked）を返し、accept / revokeする
- 現行有効条件は exact version、current generation、`revoked_at is null`
- `anon` / `authenticated` のtable direct CRUDはgrantせず、ownershipを確認するRPCに閉じる

公開同意は「candidate を作り得る」全体許可であり、各献立の公開承認を代替しない。

### 6.4 candidate — `private.public_recipe_candidates`

- `id uuid primary key`
- `source_menu_id uuid null references public.menus(id) on delete set null`
- `contributor_user_id uuid null references auth.users(id) on delete set null`
- `consent_generation bigint null` — user contributionだけ必須
- `consent_version text null` — user contributionだけ必須
- `authority_id uuid null references private.public_recipe_user_authorities(id)` — user contributionだけ必須
- `source_kind`: `operator_seed | user_contribution`
- `status`:
  - `requested`
  - `generalizing`
  - `awaiting_user_approval`
  - `awaiting_operator_review`
  - `approved`
  - `rejected`
  - `expired`
  - `failed`
  - `published`
  - `withdrawn`
- `current_revision_id uuid null` — §6.5 の immutable revision
- `user_approved_revision_id uuid null`
- `user_approved_content_hash text null`
- `user_approved_at timestamptz null`
- `operator_approved_revision_id uuid null`
- `operator_approved_content_hash text null`
- `operator_checklist_version text null`
- `operator_approved_at timestamptz null`
- `operator_id uuid null` — client inputでなく検証済み主体から記録
- `seed_rights_revision_id uuid null` / `seed_rights_content_hash text null` — operator seedだけ必須
- `seed_rights_reference text null` — version管理manifestのclosed ID。任意URL / 自由文ではない
- `seed_rights_confirmed_at timestamptz null`
- `seed_intake_operator_id uuid null` — 検証済み主体。operator seedだけ必須
- `failure_code` / `rejection_reason` — closed enum のみ
- `requested_at` / `finished_at` / `expires_at`
- `(source_menu_id, contributor_user_id)` は active candidate が 1 つになる制約
- public / anon / authenticated / service_role の table CRUD を revoke

user contribution は authority、current consent version / generation、source menuを必須とする。operator seedは
これらをNULLにし、代わりにprivateの権利根拠referenceとseed intake auditを必須にする。両者を同じNULL許容の
曖昧な経路へせず、`source_kind`に応じた`CHECK`を持つ。

許可遷移は次だけとし、terminalから戻さない。

```text
requested -> generalizing -> awaiting_user_approval -> awaiting_operator_review -> approved -> published
     |             |                    |                         |             |
     +-----------> failed / expired / rejected / withdrawn <-----+-------------+
```

operator seed は本人承認を適用しない理由をauditし、`generalizing`またはseed intakeから
`awaiting_operator_review`へ進む。statusごとのrequired / forbidden列を`CHECK`とlifecycle RPCで固定する。
同じcandidateのretryは既存revision / publicationを返すidempotent successとし、二重slugを作らない。

pending candidate の保持期間、再試行回数、user / app 日次上限は既存値から流用せず、
Implementation Plan 前に人間が固定する。未決定のまま無制限 enqueue しない。

### 6.5 immutable revision — `private.public_recipe_candidate_revisions`

- `id uuid primary key`
- `candidate_id uuid not null references private.public_recipe_candidates(id)`
- `revision_number integer not null`
- `public_payload jsonb not null`
- `content_schema_version text not null`
- `canonicalization_version text not null`
- `quality_gate_version text not null`
- `content_hash text not null` — versioned canonical JSON bytes の SHA-256
- `created_at timestamptz not null`
- `unique(candidate_id, revision_number)` / `unique(candidate_id, id)`

revision rowはINSERT後immutableとし、UPDATE / DELETEを通常roleへ許可しない。修正・再一般化は新revisionを
作り、candidateの両承認fieldをNULLへ戻す。本人preview、運営画面、publicationへのcopyは同じrevisionを読む。
canonicalizationはNFKC後、field別whitespaceを決定論で畳み、NUL、C0/C1、bidi制御、不要な`\p{Cf}` /
surrogateをrejectする。改行等を許すfieldはallowlistで個別指定する。正規化後に文字数・配列boundを検査する。

### 6.6 publication — `private.public_recipe_publications`

- `id uuid primary key` — 外部非公開
- `public_slug text unique not null` — source / pool ID から導出しない安定 URL token
- `status`: `published | withdrawn`
- `public_payload jsonb not null` — §6.9 の versioned allowlist snapshot
- `source_kind text not null`
- `source_revision_id uuid not null references private.public_recipe_candidate_revisions(id)`
- `content_schema_version` / `canonicalization_version` / `quality_gate_version`
- `consent_version text null` / `consent_generation bigint null` — user contributionだけ必須
- `content_hash text not null` — 近似重複判定とは別の exact dedupe / 改ざん検査
- `published_at timestamptz not null`
- `withdrawn_at timestamptz null`
- `withdrawal_reason` — closed enum のみ
- `created_at` / `updated_at`
- direct table grant なし

published snapshot はその公開版の immutable 正本とする。v1は公開後の本文差替えを行わず、訂正が必要なら
withdrawして新candidate / revisionを両審査する。stable slugを保ったrevision切替は別設計で承認するまで
実装しない。運営がDBのJSONを直接手編集しない。

### 6.7 origin — `private.public_recipe_publication_origins`

- `publication_id uuid primary key references ... on delete cascade`
- `candidate_id uuid not null unique references private.public_recipe_candidates(id)`
- `authority_id uuid null references private.public_recipe_user_authorities(id)`
- `contributor_user_id uuid null references auth.users(id) on delete set null`
- `source_menu_id uuid null references public.menus(id) on delete set null`
- public 非公開
- contributor / source 相関は withdraw と account deletion のためだけに使い、analytics へ出さない

account delete は origin の FK action に任せない。Auth delete より前に contributor の publication を
すべて withdraw する RPC を成功させる。失敗時は Auth delete を開始せず closed error で再試行可能にする。

### 6.8 ad eligibility — `private.public_recipe_ad_eligibilities`

- `publication_id uuid primary key references private.public_recipe_publications(id)`
- `source_revision_id uuid not null references private.public_recipe_candidate_revisions(id)`
- `content_hash text not null`
- `status`: `eligible | disabled`
- `ads_policy_version text not null`
- `ads_checklist_version text not null`
- `approved_at` / 検証済み `approved_by_operator_id`

rowが無い状態をdefault denyとする。publication revision / hash不一致、withdraw、global ad kill、policy version
変更時は不適格であり、rendererはAdSense / CMP scriptを一切emitしない。広告適格性を本文reviewの副作用で
暗黙付与せず、Phase 3で独立したAAL2 operator操作とreadbackを必要とする。

### 6.9 public payload v1

```ts
type PublicRecipePayloadV1 = {
  schemaVersion: "public-recipe-2026-08-20.v1";
  title: string;
  description: string;
  mealType: "breakfast" | "lunch" | "dinner";
  cuisineGenre: string;
  servings: 2;
  totalElapsedMinutes: number;
  dishes: {
    role: string;
    name: string;
    description: string;
    cookingTimeMinutes: number;
    ingredients: { name: string; quantityText: string }[];
    steps: { instruction: string }[];
  }[];
};
```

次を v1 payload に入れない。

- UUID、position の raw 値、pantry selection、store section
- timeline、adaptations、safetyTags、safetyActions、labelConfirmations
- standard allergen ID、eligible age band
- contributor、source、生成条件、自由 memo
- model、prompt、raw AI output、一般化 job 情報
- image、rating、review、nutrition、author person

public schema は Zod と DB / RPC の構造検査を持つ。unknown key を拒否し、文字列長・配列数は
source contract 以下の fixed bound にする。値を HTML へ出すときは text node / attribute / JSON-LD
context ごとに escape する。

### 6.10 RPC / GRANT

最低限、次の責務を別 RPC にする。

| RPC | role | 責務 |
| --- | --- | --- |
| accept / revoke public recipe consent | authenticated | `auth.uid()` 本人だけ。generation 更新と revoke |
| request publication candidate | authenticated | menu ownership、`is_selected`、source graph、consent、重複、quotaを原子的確認 |
| approve my preview | authenticated | candidate ownership、current consent / generation、preview hash を確認 |
| withdraw my publication | authenticated | origin ownership を確認して published → withdrawn |
| intake operator seed | AAL2 operator | 権利reference、closed payload、revision、auditを作る。user consentは非適用 |
| operator approve / reject / withdraw | AAL2 operator | revision hash / checklist / one-time request、state transition |
| set runtime / ad eligibility | AAL2 operator | public/ad kill、revision-bound広告審査、readback |
| publish approved candidate | restricted worker | source kind別承認、consent / fence、revision hash、dedupeを同一transactionで再確認 |
| get public page by slug v1 | anon | `published | withdrawn | not_found | disabled` の公開unionだけ返す |
| list public sitemap rows v1 | anon | runtime enabledかつpublished canonical rowをbounded paginationで返す |
| begin / finish publication account deletion | auth Site delete主体 | durable deleting fence、全件withdraw、deleted terminal化 |

`SECURITY DEFINER` が必要な public RPC は、同じ migration で `PUBLIC` の既定 EXECUTE を revoke し、
必要 role だけへ明示 grant する。固定 `search_path`、schema-qualified name、closed input、所有権確認を
必須とする。private table を Data API の exposed schema に追加しない。

Supabase の Data API default grant 変更に依存せず、migration 自身が table / sequence / function の
GRANT / REVOKE を明示する。RLS と GRANT は別の境界として pgTAP inventory に固定する。

`anon` read RPCのfunction ownerは専用`NOLOGIN` roleとし、公開readに必要なrelationの`SELECT`以外を
与えない。operator RPCは`auth.uid()`、AAL2、active operator allowlistをDB内で確認し、operator IDを引数で
受けない。user/worker/operatorのRPCをmain service-roleの汎用write APIとして共用しない。

read RPCが`published`を返せるpredicateは次のANDに固定する。

1. runtime `public_read_enabled = true`
2. publication `status = published`、payload / schema / hash がvalid
3. `operator_seed`、または次をすべて満たす`user_contribution`
   - origin authorityが存在し`state = active`
   - publicationのconsent generationがauthorityのcurrent generationと一致
   - current consent rowが存在し、exact current version、same generation、`revoked_at is null`
   - publicationに保存したconsent versionもcurrent versionと一致

user contributionのauthority / consent / originが欠損・NULL・不整合なら、publication statusが誤ってpublishedでも
本文を返さずpublic resultを`withdrawn`にする。cleanup待ちの不整合はclosed codeで監視し、public DTOへ理由を
出さない。runtime disabledだけは`disabled`、payload/schema/hash破損やDB errorは5xxへ分ける。

## 7. 同意と公開フロー

### 7.1 公開同意画面

公開同意は初回 AI 同意から分離し、設定または完成献立から能動的に開始する。

必須説明:

- 一般化後の献立が、ログイン不要の Web ページで誰でも閲覧できる
- 検索エンジンに保存・表示され、検索結果の反映には時間差がある
- ページに広告を載せ、運営者が収益を得る可能性がある
- 氏名・メール・家族設定・元の献立 ID は公開しない
- 一般化後 preview を本人が確認し、さらに運営審査を通ったものだけ公開する
- 個別に取り下げられ、全体同意を止めると公開中の本人由来ページも停止する
- CDN / 検索 cache や第三者保存から即時・完全消去を保証できない
- アレルギー等の安全を保証しない
- 公開・表示・収益化に必要な範囲の利用許諾と、権利を侵害する内容を提供しない確認

公開同意 checkbox は既定 off。既存匿名共有 checkbox の既定 on と連動させない。

### 7.2 献立単位 request

1. owner が保存済みmenu詳細から「Web 公開候補にする」を選ぶ。
2. UI は公開範囲と広告利用を再掲する。
3. server RPC がruntime / authority fenceを順にlockし、current consent、owner、source row、
   `is_selected = true`、必要child graphの存在とpublic projection妥当性、重複、quotaを検査する。
4. candidate を `requested` で作成し、非同期 generalization job を enqueue する。
5. request 成功は公開成功を意味しない。公開 URL は返さない。

現行`public.menus`に`finalized` / `deleted_at`はないため、その語をSQL predicateに使わない。v1はrequest時点で
`is_selected = true`の保存済み版だけを候補とする案を正とし、このproduct判断をPhase 0で人間承認する。
非選択版も許可する場合は本書を更新してからPlanを作る。

元献立group削除RPCも`runtime → authority → consent → candidate/revision → publication → source menu`の
順でlockし、対応するpending candidateをterminal、published publicationをwithdrawしてからhard deleteする。
public withdrawalに失敗した場合はmenu deleteもfail-closedにする。v1は「private履歴だけ削除してpublic copyを
残す」分岐を作らない。

### 7.3 generalization

- 既存 `buildShareCanonicalMenu`、2-pass 一般化、graph lock、denylist、安全 gate は再利用してよい。
- 既存緊急共有 job / quota / publish RPC と同じ row を共用しない。
- public payload projection は一般化・gate 後にサーバーが決定論で作る。
- source raw、prompt、raw AI output は新たに永続化しない。
- 各 provider call 前に runtime、authority `active`、current consent / generation / contributor existence を
  再確認する。`deleting | deleted` は外部call前に止める。
- provider call 後に revoke された場合も preview / publish せず terminal skip とする。
- PII denylist は網羅保証ではないため、本人 preview と運営 review を省略しない。

### 7.4 本人 preview / approve

- 認証アプリ内だけで public payload と同じ本文を表示する。
- contributor ID、source ID、内部 public slug は表示しない。
- approve request は candidate ID、revision ID、server-issued canonical content hashを送る。本文自体をclientから
  送り返さない。
- serverは共通lock順でowner、authority、status、current consent generation、current revision / hashを再確認し、
  `user_approved_revision_id/hash/at`を同じtransactionで保存する。
- 本人は修正文を直接入力しない。誤りがあれば reject / 再作成を選ぶ。自由編集の公開経路は別設計。

### 7.5 運営 review / publish

運営 checklist:

1. PII・個人を推測できる固有情報がない
2. 材料と手順、数量と人数、調理時間が大きく矛盾しない
3. 危険、有害、医療・安全保証、広告ポリシー抵触表現がない
4. 近似重複や薄いページではない
5. 著作権・商標・第三者レシピの複製疑いがない
6. title / description が本文を正確に表す
7. 本人 approve と同意 generation が current

operator approve はcandidate ID、revision ID、canonical hash、checklist version、one-time request IDを
hash-bound confirmationで送る。RPCがAAL2、active operator、Origin / replay、current revisionを検査し、検証済み
`auth.uid()`をauditへ保存する。approveは即時公開せず`approved`にする。

workerのpublish transactionはruntime row、user authority（user contributionだけ）、consent（同左）、candidate、
revisionを固定順に`FOR UPDATE`する。user contributionは
`current hash = user approved hash = operator approved hash`、operator seedは
`current hash = rights-intake hash = operator approved hash`を検査する。さらにschema / canonicalization / gate /
checklist version、source kind、origin、dedupeを確認し、publication / origin / candidate更新を原子的に行う。
candidateごとのunique conflictは既存publicationを返すidempotent successにする。

### 7.6 Phase 1 operator seed

Phase 1 seedは架空のuser / consentを作らず、専用intake RPCから`source_kind = operator_seed` candidateと
immutable revisionを作る。version管理されたseed manifest、運営者の権利根拠reference、content review、
operator identity、checklist versionをprivate auditへ残す。本人previewだけを非適用とし、Unicode / PII / safety /
quality gate、operator review、publication idempotency、withdraw、global killはuser contributionと共通にする。
service-role table writeやproduction DBのJSON直接編集をseed登録経路にしない。

## 8. 公開 HTTP / SEO

### 8.1 routes

| Path | 応答 |
| --- | --- |
| `/` | 公開献立面の説明、一覧導線、privacy / terms。薄い navigation-only に広告なし |
| `/recipes` | review 済み published の一覧。pagination は bounded |
| `/recipes/:slug` | 初回 HTML に公開本文。published だけ 200 |
| `/privacy` | 広告、Cookie、第三者送信を含む公開 privacy |
| `/external-transmission` | 送信情報、送信先、双方の利用目的、選択肢 |
| `/terms` | 公開閲覧と投稿・収益化の条件 |
| `/report` | 通報説明。完了画面に広告なし |
| `/robots.txt` | 公開 Site 専用。auth app の robots と共有しない |
| `/sitemap.xml` | published canonical URL だけ |
| `/ads.txt` | domain / AdSense 設定確定後の正規内容。404 や SPA fallback にしない |

### 8.2 status / canonical

- published: 200、self canonical、index 可。
- unknown slug: 404。200 shell / homepage redirect を返さない。
- withdrawn: 410 を正とし、`noindex`、広告なし、本文なし、sitemap から除外。
- global public kill: 503、`Retry-After`、`noindex`、広告なし、本文なし。publicationを410へ書き換えない。
- candidate / rejected / expired: public route 自体を作らない。
- detail routeのquery allowlistは空とする。query付きrequestは広告 / CMP codeなしの308でclean canonical URLへ
  redirectし、queryをDB / analyticsへ保存しない。
- canonical / OGP / sitemap は `PUBLIC_RECIPE_ORIGIN` の exact HTTPS origin から構築する。
- preview / branch deploy は全 HTML を `noindex` とし、production sitemap / AdSense code を出さない。

read RPC v1は次のclosed unionだけを返す。

```ts
type PublicRecipeMetaV1 = {
  canonicalSlug: string;
  publishedDate: string; // YYYY-MM-DD。内部timestamp精度を出さない
  lastModifiedDate: string; // YYYY-MM-DD
};

type PublicRecipeReadResultV1 =
  | { status: "published"; payload: PublicRecipePayloadV1; publicMeta: PublicRecipeMetaV1; adEligible: boolean }
  | { status: "withdrawn" }
  | { status: "not_found" }
  | { status: "disabled" };
```

`withdrawn`はwithdrawal reason、内部時刻、originを返さない。`not_found`とDB/RPC errorを同じ値にせず、
error / timeout / unknown schemaは本文なし503にする。GETとHEADは同じstatus / headerとし、HEADだけbodyを空にする。

pilotではdetail、一覧、sitemapの成功・失敗responseをすべて`Cache-Control: no-store, max-age=0`、
`CDN-Cache-Control: no-store`、`Netlify-CDN-Cache-Control: no-store`とする。Netlify / browser / 中間cacheに
本文やpublished DTOのstale servingを許さず、payload cache / stale-if-error / SW cacheを作らない。これにより
withdraw commit後の次requestはDBのtombstone / authority / current consent / global runtimeを必ず再確認する。
将来cacheを導入する場合は、status-first authority、revision / generation-bound key、purge readback、最大staleを
別設計で承認するまで本制約を緩めない。

### 8.3 初回 HTML

`/recipes/:slug` の最初の response body に次を含める。

- `lang="ja"`、charset、viewport
- 固有 `<title>`、description、canonical、OGP
- 単一 `h1`
- 献立概要、2 人分、合計時間
- 各料理の名前、説明、材料、手順
- 一般的な安全注意、広告表示、通報導線
- privacy / terms / external-transmission への footer link

公開本文は JavaScript fetch 後に初めて出す形にしない。client hydration は必須にせず、広告 / CMP
以外の script を最小化する。

### 8.4 escape / injection 防御

- text / attribute / URL の context ごとに escape する。
- arbitrary HTML、Markdown HTML、`dangerouslySetInnerHTML` を受けない。
- JSON を script へ埋める場合は `<`、`>`、`&`、U+2028、U+2029 を安全表現へ変換する。
- slug を path / file path / SQL fragment に連結しない。closed parser と parameterized RPC を使う。
- `javascript:` / data URL / user-provided link を public payload に持たない。

### 8.5 structured data / image

v1 は Recipe rich result 用 JSON-LD を出さない。Google の Recipe rich result は料理を表す
indexable image と name が必須だが、現行共有 payload に実料理画像は無い。generic image、別料理、
未確認 AI image、同じ placeholder を Recipe image として付けない。

画像の取得、Storage、EXIF 除去、権利、モデレーション、削除、複数 aspect ratio が別設計で承認され、
visible content と一致する場合だけ Recipe / ItemList JSON-LD を追加する。rating、nutrition、author を
存在しないのに捏造しない。

## 9. 公開運用・モデレーション

### 9.1 運営権限

- 公開審査 write は既存 readonly admin へ足さない。認証アプリと分離したoperator path / APIとし、
  Supabase Authの検証済みuser、AAL2、private allowlistの三つをDB RPC内で確認する。
- operator は content review に不要な contributor / source ID を通常 UI で見ない。
- approve / reject / withdraw は operator identity、closed reason、時刻を private audit に残す。
- raw payload、PII、prompt、AI output を運用ログへ出さない。
- production 操作は明示的な人間操作と readback を必要とし、エージェントが自動実行しない。
- write requestはexact Host / Origin、short re-auth window、one-time request ID、candidate / revision / hash bound
  confirmationを必須にする。Cookie credentialを使う場合はCSRF tokenも必要とし、bearer前提でCSRFを省略した
  まま将来Cookieへ移行しない。
- operator / worker credentialはpublic Siteへ置かず、失効・rotation runbookと緊急disableを持つ。

### 9.2 通報

- 公開 detail に「内容を報告」導線を置く。
- v1 report は closed reason enum のみで、自由文・ファイル添付・メールを収集しない。
- Netlify の rate limit / WAF を使い、アプリ DB に IP / User-Agent を保存しない。
- bodyはclosed reasonだけ、厳しいbyte上限、publication / reason / time bucketのidempotencyを持つ。DBの
  raw report件数・保持上限とglobal queue backpressureをPhase 0で固定し、overflowは本文を保存せずclosed codeを
  日次aggregateする。
- report だけで自動 withdraw しない。件数は参考にし、operator が内容を確認する。
- 明白な PII、危険手順、権利侵害は operator kill switch で即時 withdraw できる。

### 9.3 metadata retention

candidate、revision、report、operator audit、withdrawal、user authority tombstoneごとに、保持目的、read role、
raw保持期間、件数上限、削除job、aggregate後のraw削除、legal hold例外をPhase 0の表で固定する。未確定なら
Phase 1のproduction dataを作らない。本文・PIIをaudit / reason free textへ複製しない。

### 9.4 重複・品質

- exact content hash だけでなく、料理名・材料・手順の近似重複 review を行う。
- SEO keyword やページ数を目的に同じ献立を言い換えて増やさない。
- 内容が薄い、説明が不自然、同じ template の反復、検索者に新しい価値がない candidate は reject する。
- scale 前に sample 抽出で published 品質を再監査し、劣化時は新規 publish を停止する。

### 9.5 権利・表示

- 利用者の公開 request 時に、公開・編集 / 一般化・広告収益化に必要な非独占的利用許諾を確認する。
- 第三者レシピの転載や権利侵害を行わない確認を含める。
- contributor 名を出さず、運営審査済みであることだけを事実に即して表示する。
- 「専門家監修」「安全確認済み」「オリジナル」を事実なしに表示しない。
- 権利侵害申告の公開窓口と取り下げ runbook を用意するまで Phase 2 を開始しない。

## 10. AdSense / CSP / privacy

### 10.1 AdSense 開始条件

次がすべて成立した場合だけ Phase 3 を開始する。

1. domain ownership と AdSense site status `Ready` を人間が確認
2. root domain / required location の `ads.txt` が crawler から HTTP 200
3. published content が Google Publisher Policies の unique / relevant / publisher-content 条件を満たす
4. privacy、external transmission、terms、権利窓口が公開済み
5. 対象地域に必要な Google-certified CMP / TCF 設定を人間が確認
6. public origin の CSP proof と実 crawler / browser 検証が成功
7. SEO Phase の需要・品質・運用・費用が人間の事前閾値を満たす

### 10.2 広告配置

- manual ad unit の固定 slot だけを allowlist する。
- 安全注意より前、材料 list 内、手順間、通報 / withdrawal / CTA に隣接する位置へ置かない。
- mobile 320 CSS px で content を押し出さず、予約領域で layout shift を抑える。
- 広告 blocker、配信なし、CMP 拒否でも本文と navigation が完全に利用できる。
- ad script 失敗を app error として表示しない。
- runtime `ads_enabled`とrevision-bound eligibilityの両方がtrueでなければ、空slotだけでなくAdSense / CMP
  script tag自体をresponseへ出さない。revision変更、withdraw、policy version変更でeligibilityを自動失効する。

### 10.3 CSP

AdSense 公式 strict CSP の nonce 方式だけを採用候補とし、変動する配信 domain の手書き
allowlist は採用しない。公開 HTML renderer は request ごとに暗号学的 nonce を生成し、CSP header と
許可 script に同じ値を付ける。全 inline script を nonce 対象にし、nonce をログへ出さない。

AdSense phaseを含むpilotのHTMLは§8.2どおり`no-store`とし、nonceやpublic payloadを共有CDN cacheへ載せない。
HTML Functionはrequestごとにresponseを構築する。

公開 Function は、Netlify の static custom header が適用されると仮定せず、少なくとも次を response
自身で設定する。

- `Content-Type`
- `Content-Security-Policy`
- `Referrer-Policy`
- `X-Content-Type-Options`
- `Permissions-Policy`
- `frame-ancestors` / `object-src` / `base-uri` 相当
- phase / status に応じた `X-Robots-Tag` と cache policy

まず `Content-Security-Policy-Report-Only` で official ad / CMP flow を確認し、認証アプリ origin に
同じ緩和が出ていないことを検証してから enforcement にする。

Googleの2026-08-20時点の公式strict CSP例はnonceだけでなく、AdSenseの`script-src`に
`'unsafe-inline'`、`'unsafe-eval'`、`'strict-dynamic'`、`https:`、`http:`を含む。本設計はこれらを安全と
一般化せず、public SiteのAdSense responseだけへ公式templateどおりscopeする。auth originへコピーしない。
`default-src`、`object-src`、`base-uri`、`frame-ancestors`、`form-action`等の残りはdefault denyから始め、
AdSense / certified CMPの実flowで必要と確認したdirectiveだけをversion管理する。公式templateより推測で
厳しくしてad flowを壊したり、推測domainを恒久allowlistへ足したりしない。

public responseの`Referrer-Policy`は`strict-origin-when-cross-origin`、`X-Content-Type-Options`は`nosniff`、
`frame-ancestors`と`object-src`は`'none'`を初期値とする。CSPのexact phase templateとdiffはPhase 3 Taskで
固定し、parser testと実browser reportでreadbackする。

### 10.4 visitor privacy

- 公開 privacy は Google / AdSense に伴う Cookie、識別子、IP、閲覧情報、第三者送信、利用目的を説明する。
- 日本の外部送信規律について、送信情報、送信先となる事業者名、送信先と運営者双方の利用目的、
  確認・選択方法を平易に表示する。法的適用と文言は人間が専門家確認する。
- EEA / UK / Switzerland 等は Google の現行要件に従い certified CMP を使う。独自 CMP を発明しない。
- CMP 拒否時の広告 mode と tag load 順は AdSense console 設定と runbook で固定する。
- 公開 Site と認証アプリの同意を結合しない。

## 11. 計測と採算

### 11.1 収集するもの

- Search Console の日次 aggregate: impressions、clicks、index / crawl status
- server-side 非識別 aggregate: public 200 / 404 / 410 の日次件数、公開 / withdraw / report 件数
- AdSense 正本: ad request、表示、確定 revenue、policy / crawler status
- Netlify / Supabase 正本: Function、bandwidth、DB / API 利用量と費用
- 運用記録: review 件数、reject / withdraw の closed reason、作業時間の集計

### 11.2 収集しないもの

- IP、User-Agent、referrer、完全 URL、query、Cookie ID の application analytics 保存
- visitor 単位・publication 単位の閲覧履歴
- public visitor と Auth user / contributor の照合
- fingerprint、広告以外の analytics SDK / pixel
- client 申告による revenue / cost / index 正本

platform access log に上記が含まれ得る場合、Netlify の保持・権限・削除設定を Phase 1 前に確認し、
application analytics へ複製しない。

### 11.3 KPI

式だけを固定し、閾値と観測期間は各 Phase 開始前に人間が固定する。

- `index coverage = Search Console で index 済みの適格 URL 数 ÷ 同時点の published sitemap URL 数`
- `organic CTR = Search Console clicks ÷ Search Console impressions`
- `publish acceptance = published candidate 数 ÷ 運営 review 済み candidate 数`
- `withdraw rate = 観測期間内 withdraw 数 ÷ 同期間の published 数`
- `public unit infrastructure cost = 公開面の増分 Netlify + Supabase 費用 ÷ 適格 pageview`
- `AdSense gross per 1,000 pageviews = AdSense 確定 gross ÷ 適格 pageview × 1,000`
- `channel net contribution = AdSense 確定 gross − 公開面増分 infra − moderation − 問い合わせ / 法務 / 一時費の期間配賦`

AdSense pageview と server aggregate の定義差、bot、ad blocker、CMP refusal を注記し、異なる母集団を
同一率に混ぜない。page RPM の外部相場を収益正本にしない。

## 12. Phase と gate

### Phase 0 — authority / domain / 法務前提

実装しない。次を人間が確定する。

- `PUBLIC_RECIPE_ORIGIN`、Netlify Site、DNS、root domain の AdSense 管理可能性
- 別registrable domain、または同一site時のhost-only Cookie contract
- 運営者が権利を持つPhase 1 seed manifest、権利reference、intake owner
- 公開同意、利用許諾、privacy、external transmission、terms、通報窓口
- moderation 担当、対応時間、kill switch 権限
- candidate / report / audit / tombstone retention、件数・quota、各PhaseのKPI閾値・観測期間
- `is_selected = true`をv1公開request条件にするproduct判断
- anon read RPCとrestricted worker credential / poolerのlocal spike、侵害時permission inventory
- AdSense / CMP / ads.txt を変更する人間の owner

一つでも未確定なら Plan を作成せず Phase 1 を開始しない。

### Phase 1 — 広告なし SEO foundation

運営者が権利・品質を確認した専用 seed だけを、別 origin の初回 HTML で公開する。ユーザー由来の
既存緊急共有 pool は使わない。AdSense / CMP / ad code を入れない。

完了条件:

- 200 / 404 / 410、canonical、robots、sitemap、preview noindex が実 HTTP で成立
- 公開 Site に app chunk、Supabase browser key、Auth storage、Service Worker が無い
- 公開Siteにmain service-role / `sb_secret_*` / Auth Admin credentialが無く、anon read RPC以外が拒否される
- privacy / terms / report / kill switch が運用可能
- Search Console で crawl / index を確認
- 規定観測期間の需要、品質、費用、運用負荷を取得

停止条件:

- index されない、低品質 / 重複が支配的、公開停止 SLA を守れない、権利 / 安全問題、費用超過

### Phase 2 — 新規 opt-in 共有公開 pilot（広告なし）

新規の保存済み・選択済みmenuだけに §7 の request → generalize → user preview / approve → operator review →
publish を限定提供する。既存 pool backfill はしない。

完了条件:

- consent / revoke / per-item withdraw / account delete race の DB test が通る
- source menu group deleteがcandidate / publicationを先に閉じ、失敗時にhard deleteしない
- PII / adversarial text / duplicate / unsafe instruction が gate または review で止まる
- published response に origin / user / source / internal ID が無い
- contributor が preview と公開ページの一致を確認でき、取り下げできる
- moderation capacity と reject / withdraw reason を規定期間観測できる

停止条件:

- 無断公開、withdraw 不全、account deletion 後の公開継続、PII / safety 漏れ、運営能力超過

### Phase 3 — AdSense 限定 pilot

Phase 1 / 2 の review 済み published detail の一部だけに manual ad slot を入れる。Auto ads は使わない。

完了条件:

- AdSense Ready、ads.txt、CMP、privacy、CSP enforcement、crawler access が成立
- revision-bound ad eligibilityが無いpage / revisionではad / CMP codeがemitされない
- ad / CMP failure 時も content が利用可能
- policy issue、layout、Core Web Vitals、安全注意の視認性を監視
- 規定観測期間の確定 gross、増分費用、運用負荷が揃う

即時停止条件:

- AdSense policy / regulatory issue、同意不全、第三者 script の認証 origin 混入、CSP 不全、
  安全注意を覆う広告、誤クリック誘導、net contribution の人間閾値割れ

停止は ad code / CMP の公開を public Site だけで無効化し、SEO content は Phase 2 状態へ戻す。
認証アプリへロールバック変更を要求しない。

### Phase 4 — scale / 継続 / 撤退

成熟した SEO / 公開 / AdSense data から、scale、限定継続、広告撤退、公開面撤退を決める。

scale は自動 publish や運営 review 省略を意味しない。省略・sampling・画像・Recipe rich result・
personalization・別広告 network は、それぞれ新しい設計と人間承認を必要とする。

### deploy / rollback 不変条件

- DB / RPC / renderer はexpand → dual-version readback → traffic切替 → contractの順にdeployする。
- read RPCはversion suffixを持ち、旧rendererが使う版を少なくとも次版のproduction readback完了まで残す。
- rendererは未知のDTO / payload schema / statusを503でfail-closedにし、best-effortでpublished扱いしない。
- public killとad killはDB authorityとしてcode rollback後も有効で、旧renderer向けRPCもkillを強制する。
- rollbackはwithdrawn / revoked / deleting / deletedをpublished / activeへ戻さない。rollback後に200 / 410 /
  503、sitemap、ad absence、runtime generationをreadbackする。
- migrationの破壊的downでstatusやtombstoneを落とさない。contract cleanupは観測期間と人間承認後の別Taskにする。

## 13. withdrawal / deletion / cache

### 13.1 通常取り下げ

1. owner またはoperatorがwithdraw RPCを実行し、runtime → authority → candidate → publicationの順でlockする。
2. DB transactionでpublicationを`withdrawn`、candidateをterminal、広告適格性をdisabled、sitemap対象外にする。
3. read RPC は同 transaction commit 後から本文を返さない。
4. public Function は 410 / noindex / 広告なしを返す。
5. pilotはno-storeのためCDN payload purgeを成功条件にしない。設定誤りでcache headerを検出したらglobal public
   killを先に閉じ、purge / readbackが終わるまで復旧しない。
6. 本文・slugをapplication logへ出さず、closed codeと件数だけを記録する。

### 13.2 全体 revoke

- runtime row、user authority、consent rowを固定順で`FOR UPDATE`し、authorityを`revoked`、generationを進め、
  pending / approved candidateをterminal skip、publishedをすべてwithdrawする単一RPCとする。
- 件数上限で一部だけ処理して成功を返さない。bounded batch + continuation が必要なら、revoke state を
  先に terminal にして read RPC が即座に本文を閉じ、その後 cleanup を完了する。
- 新規request / worker / publishはauthority stateとgenerationをlock下で見て拒否する。
- current consent version bumpではread RPCが旧version本文を即時閉じ、その後bounded cleanupでwithdrawする。
  re-consentはgenerationを進めるが旧candidate / publicationを復活させない。

### 13.3 account delete

- 既存`delete-account`のTTL lock取得後、Auth delete / origin `SET NULL`より前に専用RPCでauthorityを
  durable `deleting`へ進め、candidate終端・全publication withdraw・広告失効を同一transactionでcommitする。
- TTL lockはRPC外のdelete同士の直列化として維持できるが、専用RPC内では
  `runtime → authority → consent → candidate/revision → publication`の共通順を変えない。
- request / worker / approve / publishは同じauthority rowをlockし、`deleting | deleted`を拒否する。publish先勝ちなら
  deleteが待ってそのpublicationもwithdrawし、delete先勝ちならpublishが失敗する。
- withdrawal authority commitを確認できなければbilling / Auth deleteを開始しない。以後のbilling / Auth APIが
  失敗しても`deleting`をTTL解除せず、再送は同じ削除処理をresumeする。公開再開は自動補償せず、人間runbookと
  本人意思の再確認を必要とする。
- Auth delete成功後、DB triggerまたは専用finish RPCでauthorityを`deleted`にし、`user_id`がNULLになっても
  authority ID / terminal stateを残す。read RPCはorigin authorityがactiveでなければ本文を返さない。
- delete再送、Auth成功/失敗、worker交錯をidempotency / race testで固定する。

### 13.4 全公開 / 広告 kill

- global public killはruntime rowの`public_read_enabled=false`を最初にcommitする。read RPCはpublicationより先に
  これを評価し、`disabled`を返す。sitemapも空の200で全URL削除を示さず503、全HTMLは503 / noindex /
  no adsとする。robots.txtはstaticな安全設定を維持する。
- ad killは`ads_enabled=false`だけをcommitし、SEO本文を止めない。全公開killは常に広告も止める。
- kill復旧は原因解消、cache / deploy / DTO readback、AAL2 operatorの明示操作、config generation増分を必要とする。

### 13.5 検索 cache の残差

サイト自身、CDN、sitemap からは停止できるが、検索結果 snippet、検索 cache、第三者転載の即時消去は
保証できない。この残差を公開同意と取り下げ UI で事前説明する。法的削除要求では Search Console 等の
追加手順を runbook 化する。

## 14. abuse / availability

- public page は crawl / scrape 可能であり、slug entropy を bot 防御に使わない。
- Function は closed slug parser、method allowlist、body size 0 の GET / HEAD、bounded DB response を持つ。
- HTML / sitemap / report に Netlify rate limit / WAF を適用するが、Googlebot / AdSense crawler を
  IP の自己実装 allowlist で誤遮断しない。
- sitemap と一覧 pagination から巨大 response を返さない。exact 上限は Phase 0 で固定する。
- DB / Function timeout、RPC failure、invalid payload は本文なし 5xx とし、SPA shell / stale user content に
  fallback しない。
- invalid snapshot を renderer が best-effort 部分表示しない。operator alert + fail-closed response とする。
- secrets、payload、slug、query、referrer、UA、IP を application log に出さず closed code と件数だけにする。

## 15. 実装単位と検証

本書承認後、Implementation Plan は少なくとも次の順で Task を分ける。

1. authority 文書整合、public contract、同意 copy、Phase 0 fixed values、credential / domain spike
2. DB runtime / authority fence / consent / candidate / immutable revision / publication / origin / RPC / privilege inventory
3. canonical projection、generalization job、user preview / hash approval / withdraw、menu / account delete統合
4. operator / worker auth、seed intake、moderation、public/ad kill、report、runbook
5. 別 Netlify Site の renderer、headers、404 / 410、robots、sitemap、privacy / terms
6. Search Console SEO pilot と production verification
7. CMP / AdSense / nonce CSP / fixed slots（Phase 3 が人間承認された場合だけ）
8. 集計・採算 report、scale / stop decision

### 15.1 自動検証

- contract unit: unknown key、bounds、raw ID / forbidden field、escape / JSON script injection、NFKC / bidi / C0 /
  C1 / NUL / 分割PII、canonical serializationの決定性
- pgTAP: table / sequence / function privileges、RLS inventory、owner BOLA、state transition、revision immutability、
  hash-bound両承認、idempotent publish、revoke / version bump / menu delete / account delete / global kill races
- Function unit: slug、query 308、GET / HEAD、union status、no-store headers、CSP nonce、no ads status、
  unknown DTO / invalid payload fail-closed
- integration: anon read RPCがpublic DTO unionだけを返し、anon / authenticatedのpublic-recipe table direct accessが
  失敗する。public rendererのanon credentialではAuth Admin、main service-role RPC、write RPCが失敗し、
  public deployにmain secretが無い
- renderer: first HTML 本文、固有 meta / canonical、404 / 410、preview noindex、広告対象 allowlist
- security: public build に app chunk、Supabase browser env、Auth key、SW、source map secret が無い
- E2E: JS無効content、mobile 320px、report、withdraw / revoke / menu delete直後、global kill、CMP accept /
  reject、eligibilityなし、ad script failure、same-site Cookie inventory
- deploy compatibility: RPC v1 / v2のdual support、旧rendererのunknown schema 503、rollback後にwithdrawnが
  復活しないこと

DB / Node / E2E を含む変更は `AGENTS.md` の Docker 検証フローを省略しない。

### 15.2 production / manual verification

- exact public origin の DNS / TLS / headers
- `curl` / browser で 200 / 404 / 410 / ads.txt / robots / sitemap
- Search Console URL Inspection と sitemap submit
- Google Rich Results Test は Recipe markup が無いことを含め確認
- AdSense crawler / site status / policy center / ads.txt status
- CSP Report-Only → enforcement の違反確認
- CMP の地域別 accept / reject / manage options
- withdrawal purge と検索削除 runbook rehearsal
- public origin と auth origin の storage / SW / CSP 分離確認
- response / Function bundle / Netlify env inventoryにmain service-role / `sb_secret_*` / Auth chunkが無いこと
- `Cache-Control` / `CDN-Cache-Control` / `Netlify-CDN-Cache-Control` no-store、runtime generation、
  current consent version、public/ad kill、rollbackのreadback

production AdSense / CMP / Search Console / DNS の write は人間が明示実行し、エージェントが自動変更しない。

## 16. 人間承認が必要な blocker

Implementation Plan 前:

1. exact `PUBLIC_RECIPE_ORIGIN` と別 Netlify Site の所有者
2. 別registrable domain、または同一siteのhost-only Cookie / `Domain`禁止契約
3. Phase 1 seed manifest、intake owner、その権利根拠
4. 公開同意・利用許諾・privacy・外部送信・terms の文言
5. moderation owner、AAL2 operator / worker実行面、対応時間、public / ad kill、権利侵害窓口
6. candidate / report / audit / tombstone / sitemap上限、table別retention、legal hold
7. v1 requestを`is_selected = true`へ限定する判断と、menu deleteでpublicもwithdrawする判断
8. anon read RPC / restricted worker credentialのspike結果とpermission inventory
9. Phase 1 / 2 / 3 の KPI 閾値と観測期間
10. AdSense domain、account owner、ads.txt、CMP 選択
11. public Site の増分費用上限と撤退条件

Phase 3 前:

1. AdSense Ready / policy / ads.txt の readback
2. Google-certified CMP と地域設定
3. nonce CSP proof と広告配置 screenshot / mobile review
4. revision-bound ad eligibility / policy version / operator readback
5. privacy / external transmission の法務確認
6. 成熟した Phase 1 / 2 集計と net contribution 合格条件

## 17. 受け入れ残差

| 残差 | 扱い |
| --- | --- |
| 公開本文は crawler / scraper / archive に複製され得る | 公開同意で説明。完全防止を約束しない |
| PII denylist / AI 一般化は完全でない | 本人 preview + 運営 review + report。自動公開しない |
| 画像がなく Recipe rich result 非適格 | v1 で受容。偽画像を付けない |
| AdSense 審査・広告表示・検索順位・収益は保証されない | Phase gate と実測で判断 |
| no-store / nonce HTML の per-request render は費用・latency を増やす | pilot採算で評価。withdraw authorityをcache費用より優先 |
| withdraw 後も検索 cache / 第三者転載が残り得る | 事前説明 + runbook。サイト自身は即座に本文を閉じる |
| subdomain / domain 単位の AdSense 審査運用は外部状態に依存 | Phase 0 で人間が現行 console / 公式資料を確認 |
| platform access log の保持はアプリ DB だけでは制御できない | Netlify 設定・契約を確認し、analytics へ複製しない |
| anon公開read RPCはSupabase endpointから直接呼ばれ得る | 公開DTOなので秘匿しない。DB側bound / timeout / quotaで費用を制限 |
| account delete後もrandom authority tombstoneをprivateに保持する | 公開復活防止の最小security record。retentionと法的根拠を人間確認 |

## 18. 外部根拠（2026-08-20 確認）

- Google AdSense crawler / login:
  <https://support.google.com/adsense/answer/161351>
- Google Publisher Policies / privacy / low-value content:
  <https://support.google.com/adsense/answer/10502938>
- AdSense UGC を含む publisher 責任:
  <https://support.google.com/adsense/answer/23921>
- AdSense CSP:
  <https://support.google.com/adsense/answer/16283098>
- AdSense certified CMP / TCF:
  <https://support.google.com/adsense/answer/13554020>
- AdSense site management / subdomain:
  <https://support.google.com/adsense/answer/12170421>
- ads.txt crawler:
  <https://support.google.com/adsense/answer/7679060>
- Google Search JavaScript SEO:
  <https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics>
- Google Search Recipe structured data:
  <https://developers.google.com/search/docs/appearance/structured-data/recipe>
- Google Search scaled content abuse:
  <https://developers.google.com/search/docs/essentials/spam-policies>
- 日本の外部送信規律 FAQ:
  <https://www.soumu.go.jp/main_sosiki/joho_tsusin/d_syohi/gaibusoushin_kiritsu_00002.html>
- Netlify Function / Durable Cache:
  <https://docs.netlify.com/build/caching/caching-overview/>
- Netlify redirect rule order:
  <https://docs.netlify.com/manage/routing/redirects/redirect-options/>
- Supabase Data API explicit grants change:
  <https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically>
- Supabase API keys（publishable / secret とRLS境界）:
  <https://supabase.com/docs/guides/getting-started/api-keys>
- Supabase Postgres roles / database connection:
  <https://supabase.com/docs/guides/database/postgres/roles>
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
