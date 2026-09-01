# 公開レシピ SEO / AdSense 段階実証 — 敵対的レビュー

- 日付: 2026-08-20
- 対象: `docs/superpowers/specs/2026-08-20-public-recipe-seo-adsense-pilot-design.md`
- 実施者: 読み取り専用 Reviewer（敵対的入力・競合・運用ミス担当）
- 判定: **REJECT — Critical 3 件、Important 8 件、Minor 3 件**

## 1. Verdict

JSON-LD を v1 で出さない、slug を秘密扱いしない、公開 table の直接読取を禁じる、410 / noindex /
sitemap 除外、別 origin、自由文なし通報、段階 gate は妥当である。一方、承認と本文の結合、revoke /
delete と publish の直列化、アカウント削除中の durable fence は Implementation Plan 前に閉じる必要がある。

## 2. 主要な攻撃シナリオ

1. worker retry や運用バグで本人 preview 承認後の payload を差し替える。
2. publish が同意確認後、revoke が既存 publication を閉じたあとに新規 publish を commit する。
3. account delete の withdrawal 後に publish し、Auth削除で origin 相関も失う。
4. 公開 Function の RCE / 依存関係侵害 / env 漏えいから main service-role key を奪う。
5. 同一 registrable domain の別 subdomain から parent-domain Cookie / same-site 境界を混線させる。
6. withdraw 後の payload cache、stale-if-error、purge failure で旧本文を返す。
7. bidi 制御、ゼロ幅文字、分割 PII で denylist と人間 review を迂回する。
8. 分散 bot が random slug / report を大量送信し、費用と運用 queue を枯渇させる。
9. Phase 3 の設定ミスで未適格 revision や CMP 判定前にも広告 code を出す。
10. DB / renderer を不整合な版へ rollback し、withdrawn row を旧 renderer が再び 200 にする。

## 3. Critical

### C-01: 本人承認・運営承認が対象本文へ永続的に束縛されない

根拠: Spec 197–218、348–370 行。

candidate に `user_approved_content_hash`、`operator_approved_content_hash`、checklist version、承認対象
revision がない。承認後に payload が変わっても、現在値から再計算した hash で publish できる余地がある。

修正:

- immutable revision に canonical `content_hash` と schema / gate version を持たせる。
- 本人・運営の承認 hash、時刻、検証済み operator identity、checklist version を保存する。
- publish transaction で revision を lock し、current = user approved = operator approved を検査する。
- revision 更新は両承認を失効し、状態別の更新可能列を RPC / trigger で制限する。
- worker / approve / payload 差替えの交錯 test を加える。

### C-02: 全体 revoke と publish が同じ lock で直列化されない

根拠: Spec 121–123、298–301、368–370、643–649 行。

revoke は consent row の `FOR UPDATE` を明記するが、publish は「再確認」だけで同じ lock と順序がない。

修正:

- 公開可能性を変える全 RPC が最初に同一 consent row / publication fence を `FOR UPDATE` する。
- lock 後に generation、revoke、candidate、approval hash を検査し、lock 順序を固定する。
- revoke 先勝ち / publish 先勝ち双方の race test を追加する。

### C-03: account delete lock が公開禁止 fence でなく、publication orphan が可能

根拠:

- Spec 240–250、651–657 行
- `netlify/functions/delete-account.ts`: 115–143 行
- `supabase/migrations/20260812200000_account_delete_lock_and_feedback_idempotency.sql`: 1–75 行

現行 lock は DELETE 同士を直列化する TTL lock で、公開 request / worker / publish は確認しない。origin は
Auth削除時に contributor が `SET NULL` になるため、withdraw 後に取りこぼした publication の相関を失う。

修正:

- TTL lock と別に durable `deleting/deleted` publication fence を置く。
- request / generalization / approve / publish が同じ fence を lock・確認する。
- Auth Admin の成功 / 失敗で fence をTTL自動解除せず、補償 transaction / runbook を固定する。
- origin 相関消去前に withdrawal authority と対象集合の完全性を確認する。
- publish / worker / delete / retry / Auth API failure の交錯 test を加える。

## 4. Important

### I-01: 公開 Function に main `service_role` credential を置く blast radius

根拠: Spec 35–36、105–112、299–305 行、`netlify/functions/_shared/supabase-admin.ts` 9–20 行。

公開 renderer 専用の非 `BYPASSRLS` credential / gateway とし、公開 read RPC 以外を実行できないこと、
credential rotation、Site単位secret分離、main service-role混入拒否を test する。

### I-02: 別 exact origin は Cookie / same-site 境界ではない

根拠: Spec 23–27、98–103 行、`src/shared/lib/supabase.ts` 10–20 行、
`src/features/pwa/register-service-worker.ts` 5–9 行。

別 registrable domain を優先する。同一 site を許す場合は auth Cookie を host-only / `__Host-` に限定し、
`Domain` 禁止、Set-Cookie inventory、credentialed CORS 禁止、Cookie auth 移行時の再レビュー gate を設ける。

### I-03: withdraw tombstone が payload cache より優先する契約がない

根拠: Spec 493–496、632–641、672–674 行。

status / tombstone を payload cache より強い authority とし、user content の stale-if-error を禁止する。
cache key は revision / generation に結び、withdraw で旧 generation を無効化する。status 別 cache header と
purge failure / timeout のE2Eを固定する。

### I-04: Unicode正規化・制御文字の公開契約がない

根拠:

- Spec 252–285、358–365 行
- `supabase/migrations/20260711001100_menu_core.sql`: 94–98、120–127 行
- `shared/contracts/share-denylist.v1.ts`: 6–9、131–134、242–253 行

NFKC 等の canonicalization を projection 前に一度行い、承認・hash・保存・render で同じ canonical bytes を
使う。C0 / C1、bidi override / isolate、不要な Cf、NUL をrejectし、許可文字をfield別に定義する。
email、電話、住所、URL、SNS handle、分割文字、Unicode corpus を contract test に加える。

### I-05: WAF依存だけでは report / random slug の分散DoSをboundedにできない

根拠: Spec 221–222、442–448、665–675 行。

closed bodyとsize上限、publication / reason / time bucket の idempotency、DB件数・保持上限、global
backpressure、statement timeout、404 negative cache、queue overflow時のclosed aggregateを定義する。

### I-06: 広告対象 subset が data model 上 default-deny でない

根拠: Spec 134–140、224–235、606–613 行。

広告適格性を default false の private record とし、publication revision hash、審査version、operator、時刻へ
束縛する。revision変更・withdraw・policy killで失効し、active eligibility がない限り ad / CMP code 自体を
renderer が出さない。

### I-07: operator write 面の authN・再認証・CSRF / replay 境界が未確定

根拠: Spec 296–298、432–440 行、
`docs/superpowers/specs/2026-08-11-local-ops-admin-console-design.md` 17–28 行。

local-only write tool または強固な admin origin、dedicated role、MFA / step-up、Host / Origin / CSRF、
短命 credential、one-time request、hash-bound confirmation、readback、緊急失効を設計 authority にする。

### I-08: rollback がAdSense停止しか定義せず、schema / renderer の逆行安全性がない

根拠: Spec 617–630、677–688 行。

expand / contract migration、最低2版RPC互換、deploy順、未知schemaを旧rendererが fail-closed にする規則、
広告killと公開killの独立、cache purge、rollback readback、withdrawnを復活させないtest/runbookを追加する。

## 5. Minor

### M-01: query変種の応答

非許可 query は広告を出さず clean URL へ redirect または 404 とし、cache key / Search Console test を固定する。

### M-02: CSP の最低 directive set

公式AdSense / CMP挙動と照合した exact default-deny template を version 管理し、nonce 一意性、CSP parser、
Report-Only と enforcement の差分を test する。必要 domain を推測で追加しない。

### M-03: report / audit / withdrawal metadata の保持

tableごとの保持期間、上限、削除job、legal hold例外、閲覧role、aggregate化後のraw削除をPhase 0値へ加える。

## 6. 誤検知候補・成立しない攻撃

- JSON-LD injection: v1 は Recipe / ItemList JSON-LDを出さず、script埋込み時のescapeも明記するため独立findingでない。
- 通常のHTML XSS: arbitrary HTML / Markdown HTML / `dangerouslySetInnerHTML` / user URLを禁じるため設計上対策済み。
- slug列挙: 公開URLであり列挙可能なのは意図どおり。slugを認可に使わないため脆弱性でない。
- Service Workerによるauth origin takeover: 別exact originを維持すればSWはorigin scopedで成立しない。
- localStorage session直接読取: 別originの広告scriptからauth origin localStorageは読めない。
- 検索cache・第三者転載の即時消去不能: 不可避残差として説明済み。自サイトcacheのI-03とは別問題。
- reportによる自動検閲: report件数だけでwithdrawしないため成立しない。DoSは別問題。
- private table grant: Specは直接grantを禁じる。I-01はcredential漏えい時の全体権限である。

読み取り専用レビューのみ実施し、ファイル変更・テスト・外部書き込みは行っていない。
