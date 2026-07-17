#!/usr/bin/env bash
# 稼働中のPostgres Meta（Supabaseのスキーマ内省サービス）からTypeScript型定義を
# 取得し、src/shared/types/database.generated.ts を上書き生成する。
# 取得結果はTypeScriptとしてパースし、期待するJson/Database型が
# エクスポートされていることまで確認してから書き込む。
set -euo pipefail
types_url="${PG_META_TYPES_URL:-http://meta:8080/generators/typescript?included_schemas=public,private&detect_one_to_one_relationships=true}"
destination="src/shared/types/database.generated.ts"
destination_dir="$(dirname "$destination")"
tmp_file="$(mktemp "$destination_dir/.database.generated.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT
# 稼働中の公式Metaサービスを使い、CLIによる入れ子のコンテナ起動を避ける。
PG_META_TYPES_URL="$types_url" node --input-type=module -e '
  import ts from "typescript";

  const response = await fetch(process.env.PG_META_TYPES_URL);
  if (!response.ok) {
    throw new Error(`Postgres Meta type generation failed: ${response.status}`);
  }
  const types = await response.text();
  // 単なる文字列としてではなく実際にTypeScriptとしてパースし、
  // 破損・空・エラーレスポンスをそのまま書き込まないようにする。
  const source = ts.createSourceFile(
    "database.generated.ts",
    types,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const exportedAliases = new Set(
    source.statements
      .filter(
        (statement) =>
          ts.isTypeAliasDeclaration(statement) &&
          statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      )
      .map((statement) => statement.name.text),
  );
  // 呼び出し側が依存する契約（Json/Database型のエクスポート）が
  // 揃っているかを最低限確認する。
  if (
    source.parseDiagnostics.length !== 0 ||
    !exportedAliases.has("Json") ||
    !exportedAliases.has("Database")
  ) {
    throw new Error("Postgres Meta returned an invalid TypeScript contract");
  }
  process.stdout.write(types);
' > "$tmp_file"
chmod 0644 "$tmp_file"
# 一時ファイルへ書き切ってから mv でアトミックに差し替える。
mv "$tmp_file" "$destination"
trap - EXIT
echo "Generated $destination"
