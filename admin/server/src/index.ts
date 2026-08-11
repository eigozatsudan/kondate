/**
 * admin サーバ入口。Task 8 で起動検証・静的配信・listen を完成させる。
 * Task 3 時点ではパッケージ骨格として export のみ。
 */
export function placeholderBootstrap(): string {
  return "admin-server-placeholder";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line no-console
  console.log(placeholderBootstrap());
}
