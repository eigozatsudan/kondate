# アカウント削除サポートランブック

## ユーザー向け

- アプリ内のアカウント削除は **hard delete**（Auth ユーザー削除が DB cascade を駆動する）。
- 世帯未設定（idea モードの献立のみ）でも、同じ単一 Auth ユーザー経路で削除される。
  サポートは「先に家族設定を完了してください」と案内しない。
- **例外（濫用防止）**: 正規化メールから作った復元できない `identity_key` と、その日次利用回数（成功・attempt）は
  Auth 削除後も残る。生メールは DB に保存しない。ユーザー向け文言はアプリ削除確認と矛盾させない。
- **例外（共有・方針 B）**: 匿名一般化済みの緊急候補本文（`private.shared_emergency_recipes`）は
  削除後も他ユーザー向けに残り得る。誰が作ったかの対応づけ（origin）は外す。
  アプリの privacy 説明・削除確認 copy と矛盾させない。
- **有料プラン**: 解約（Stripe cancel）が成功してから Auth を削除する。解約できない場合は
  アカウント削除を中止し、請求が続く可能性がある旨を UI で返す。

## 削除順序（delete-account Function）

1. 認証（bearer）+ 確認フレーズ「削除する」。
2. service_role で `release_identity_and_global_for_user_processing(p_user_id)` を呼び、
   `processing` 中の identity / global / quality **reserved** を解放して request を `failed` 化する
  （success_count / sent_count は減らさない）。
3. 未完了 flyer request があれば flyer reserved を helper 経由で best-effort 解放する
  （失敗しても Auth 削除は止めない。stale cleanup が第二経路）。
4. **billing cancel（fail-closed）**:
   - `get_billing_customer_by_user` → `stripe_customer_id` が無ければスキップして Auth 削除へ
   - customer があるのに Stripe クライアントが無い / customer 解決失敗 / list 失敗 → **Auth 削除しない**
     （`billing_cancel_failed` 503）
   - **先に** `stripe.checkout.sessions.list({ customer, status: "open" })` で未完了 Checkout を辿り
     各 `checkout.sessions.expire`（手元 URL 完了で孤児 subscription が立つのを防ぐ）
   - expire の list / expire 失敗も **Auth 削除しない**（`billing_cancel_failed` 503）。
     1 件 expire 失敗しても残りを試行し、最後に throw
   - Stripe Customer は税務・請求記録のため残す。消すのは open Session と live sub だけ
   - 続けて `stripe.subscriptions.list({ customer, status: "all" })` で **customer 単位の全 sub** を取得
     （DB の `billing_subscriptions` 1 行だけを cancel 対象にしない）
   - live/non-terminal（`canceled` / `incomplete_expired` 以外）を各 `subscriptions.cancel`
   - 1 件失敗しても残りを試行し、SafeLog `billing_cancel_failed`（opaque sub/customer id のみ）
   - **いずれか 1 件でも expire / cancel 失敗したら Auth 削除しない**（請求 orphan を優先して防ぐ）
5. Auth Admin hard delete（CASCADE で user 所有行・billing_customers/subscriptions 削除）。
   identity 日次表と `billing_trial_history`（identity_key）は user_id 無しのため残る。
6. 防御第2経路: `private.ai_generation_requests` の BEFORE DELETE トリガでも reserved を解放する
  （RPC スキップや運用の直削除でも reserved 孤児を防ぐ。二重解放は flags 下ろし後 no-op）。

### 共有（方針 B）— pool 残存と origin unlink

Auth 削除時の共有関連の期待結果（設計 §11.2 / マイグレーション FK）:

| オブジェクト | 削除後 | 備考 |
| --- | --- | --- |
| `public.user_share_consents` | **CASCADE 削除** | 本人同意行は残さない |
| `private.share_generalization_jobs.contributor_user_id` | **ON DELETE SET NULL** | 列名は `user_id` ではない（account-deletion の user_id CASCADE ガード対象外） |
| `private.shared_emergency_recipe_origins.contributor_user_id` | **ON DELETE SET NULL** | origin **unlink**。`source_menu_id` もメニュー削除時に SET NULL 可 |
| `private.shared_emergency_recipes`（pool 本文） | **残す** | 匿名 payload。`status`（active/disabled）は変更しない |
| `private.share_user_daily_usage` / `share_app_daily_usage` | 日次台帳として残る | 濫用・上限用。PII なし |

- オペレータが Auth 削除の前に pool 行を手で消す必要はない（消すと他ユーザーの緊急候補が欠落する）。
- 運用 kill switch は pool の `status = disabled`（エンドユーザー向け個別取り下げ UI は無い）。
- ユーザー向け privacy-copy: 「匿名一般化済みの緊急候補本文は削除後も残ることがある／誰が作ったかの対応づけは残さない」。

## サポート応答

1. アレルギー詳細・トークン・生ログの提出を依頼しない。
2. 削除結果は **集計件数** と閉じたステータスでのみ確認する（PII ログは見ない・残さない）。
3. Auth Admin API がエラーを返した場合のみエスカレーションする。
4. 「利用回数が消えない」問い合わせには、不正利用防止の識別子と日次回数のみ保持する旨を説明する
  （メール本文・氏名は保持しない）。
5. 「削除できない・請求が続く」問い合わせ:
   - UI が `billing_cancel_failed` を返した場合は **Auth は消えていない**（解約未完了で中止）。
   - Stripe Dashboard で customer / live subscription を opaque id のみで確認し、解約後に再試行を案内する。
   - 生メール・氏名をチケットへコピーしない。
6. 「匿名で協力した緊急候補は消えるか」問い合わせ:
   - **方針 B**: 一般化済みの匿名本文は他の方の緊急候補として残り得る。
   - 誰が作ったかの対応づけ（origin の contributor）は Auth 削除で外れる（unlink）。
   - pool 本文・タイトル・手順をチケットへコピーしない。運用で無効化する必要がある場合は
     `status = disabled` のみ（本文の手削除は原則しない）。

## 禁止

- Auth ユーザー削除の前に、オペレータが所有行を手で DELETE しない
  （どうしても直削除する場合も reserved は DELETE トリガで解放されるが、正規経路は RPC 先行）。
- Auth 削除の前・後に、方針 B の pool 本文を「完全消去」目的で手 DELETE しない
  （他ユーザー向け緊急候補の欠落と、privacy copy との矛盾を招く）。
- 削除確認のために氏名・メール・アレルギー・プロンプト・identity_key・menu_payload をログやチケットにコピーしない。
- `QUOTA_IDENTITY_HMAC_KEY` をブラウザやサポート手順へ漏らさない。
