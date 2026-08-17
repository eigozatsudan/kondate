/** 開発サーバで document navigation を /app.html へ寄せるか判定する。 */
export function rewriteDevDocumentUrl(input: {
  method: string;
  url: string;
  accept?: string | string[] | undefined;
}): string | null;
