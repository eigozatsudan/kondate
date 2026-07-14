# Compose identity衝突修正レポート

## 原因

checkoutの絶対pathからPOSIX `cksum` のCRCとbyte数だけを採用していたため、同じ長さの異なるpathが同一Compose project名になる可能性がありました。提示された次の2 pathは、どちらも `2604191656 32` になり、旧実装の衝突を再現しました。

- `/tmp/kondate-review-yfz0s9w6lom1`
- `/tmp/kondate-review-rnqm2dyk6ltt`

## 修正

- helper自身でrepository rootを物理pathへcanonicalizeしました。
- canonical絶対pathのSHA-256からlowercase hex先頭32桁を採用し、`kondate-<32 hex>` 形式にしました。
- `sha256sum` の欠落、実行失敗、不正な出力ではproject名を返さず停止します。
- `.env` のidentity検証、local secret生成、運用文書を新形式へ揃えました。
- 既知のCRC衝突pair、同一pathの安定性、symlink aliasのcanonical一致、形式制約、依存欠落、不正出力を回帰テストへ追加しました。

## 検証

- `sh tests/tooling/compose-project-identity.test.sh`
- `node tests/tooling/project-config.test.mjs`
- `sh -n scripts/compose-project-name.sh scripts/ensure-compose-project-env.sh tests/tooling/compose-project-identity.test.sh`
- `npm exec prettier -- --check scripts/generate-local-secrets.mjs tests/tooling/project-config.test.mjs tests/tooling/compose.test.mjs docs/local-development.md`

いずれもPASSしました。`tests/tooling/local-development-scripts.test.mjs` はTask 4との同時編集を避ける指示に従い、このcommitでは変更していません。
