# アカウント削除サポートランブック

## ユーザー向け

- アプリ内のアカウント削除は **hard delete**（Auth ユーザー削除が DB cascade を駆動する）。
- 世帯未設定（idea モードの献立のみ）でも、同じ単一 Auth ユーザー経路で削除される。
  サポートは「先に家族設定を完了してください」と案内しない。
- **例外（濫用防止）**: 正規化メールから作った復元できない `identity_key` と、その日次利用回数（成功・attempt）は
  Auth 削除後も残る。生メールは DB に保存しない。ユーザー向け文言はアプリ削除確認と矛盾させない。

## 削除順序（delete-account Function）

1. 認証（bearer）。
2. service_role で `release_identity_and_global_for_user_processing(p_user_id)` を呼び、
   `processing` 中の identity / global **reserved** を解放して request を `failed` 化する
  （success_count / sent_count は減らさない）。
3. Auth Admin hard delete（CASCADE で user 所有行削除）。identity 日次表は user_id 無しのため残る。
4. 防御第2経路: `private.ai_generation_requests` の BEFORE DELETE トリガでも reserved を解放する
  （RPC スキップや運用の直削除でも reserved 孤児を防ぐ。二重解放は flags 下ろし後 no-op）。

## サポート応答

1. アレルギー詳細・トークン・生ログの提出を依頼しない。
2. 削除結果は **集計件数** と閉じたステータスでのみ確認する（PII ログは見ない・残さない）。
3. Auth Admin API がエラーを返した場合のみエスカレーションする。
4. 「利用回数が消えない」問い合わせには、不正利用防止の識別子と日次回数のみ保持する旨を説明する
  （メール本文・氏名は保持しない）。

## 禁止

- Auth ユーザー削除の前に、オペレータが所有行を手で DELETE しない
  （どうしても直削除する場合も reserved は DELETE トリガで解放されるが、正規経路は RPC 先行）。
- 削除確認のために氏名・メール・アレルギー・プロンプト・identity_key をログやチケットにコピーしない。
- `QUOTA_IDENTITY_HMAC_KEY` をブラウザやサポート手順へ漏らさない。
