# 課金 reconcile ランブック

`BILLING_ENABLED=false` 中も Webhook は鍵があれば投影を続ける（A3）。  
kill 期間が長い・イベント欠落が疑われる・再有効化前の差分確認では本手順を使う。

**Webhook 本番経路は `process_billing_stripe_event` のみ。**  
本 runbook の手動投影だけが `upsert_billing_subscription_from_stripe` を使ってよい。

## 前提

- service_role 相当の運用アクセス（Supabase SQL / Functions 管理者）
- Stripe Dashboard（test / live を誤らない）
- 対象 customer は `private.billing_customers` にマッピング済み

## 手順

1. **kill のまま**（`BILLING_ENABLED=false`）で作業する。Checkout/Portal は閉じたまま。
2. Stripe で対象 customer の subscriptions を list（status=all）。
3. 各 live / 終端 sub について、投影 payload を組み立て `upsert_billing_subscription_from_stripe` を実行する。
   - payload キーは `process_billing_stripe_event` と同じ subscription 投影キー
   - `user_id` は `get_billing_customer_by_stripe_id` で解決
4. `get_billing_entitlement_for_user` で差分を確認する（`plus_entitled` / `status` / period）。
5. メトリクス: unmapped 件数・stale 多発・dual-sub cancel ログを確認。
6. 差分が許容範囲になったら **最後に** `BILLING_ENABLED=true` を戻す。

## 禁止

- Webhook 経路から `upsert_billing_subscription_from_stripe` を呼ばない
- email / 氏名 / receipt をログに残さない
- kill 中に Checkout だけ先に開ける運用をしない

## Customer Portal Dashboard チェックリスト（P0）

解約・支払い方法・領収書は Stripe Customer Portal に委譲する。Deploy 前に Dashboard で確認:

- [ ] 既定言語 **ja**
- [ ] 解約は **期間末**（`cancel_at_period_end`）。即時解約のみにしない
- [ ] retention offer / 解約アンケートの **ダークパターンは off**
- [ ] 月↔年切替は **初期オフ**（Q2 まで）

## サポート導線（ユーザー向け）

- 設定の entitlement が Free のまま・「反映まで数十秒」を案内
- 5 分後も Free なら「お支払い状況を確認できません」+ サポート
- カード番号やメール本文の提出を依頼しない
