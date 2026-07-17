#!/usr/bin/env bash
# pg_prove経由でpgTAPデータベーステストを実行する。引数を渡さなければ
# supabase/tests/database 配下の *.test.sql を全て実行し、引数を渡せば
# それらのファイルだけを対象にする（相対パスは /workspace 基準に正規化する）。
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
if [[ "$#" -eq 0 ]]; then
  set -- /workspace/supabase/tests/database/*.test.sql
else
  # 呼び出し側がホスト相対パス/コンテナ絶対パスどちらで渡しても
  # 動くよう、/workspace プレフィックスの重複を避けつつ正規化する。
  requested=()
  for file in "$@"; do
    requested+=("/workspace/${file#/workspace/}")
  done
  set -- "${requested[@]}"
fi
cd /workspace/supabase/tests/database
pg_prove --failures --dbname "$DATABASE_URL" "$@"
