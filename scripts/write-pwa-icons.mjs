/**
 * 紙色地にテラコッタの椀シルエットを描いた PWA アイコン 4 枚を書き出す。
 * 既存ロゴが無いため、写真・人物・文字（「こ」含む）は使わず単純な正面シルエットにする。
 * maskable は OS が端を切る前提で、図形全体を中央 80% に収める。
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 現行 :root の紙色。新しい色は足さない。 */
const PAPER = "#faf9f8";
/** 現行トークンのテラコッタ。椀だけに使う。 */
const TERRACOTTA = "#b85033";

/**
 * viewBox 0 0 100 100 の椀正面パス。
 * 口縁をいちばん広く、胴はゆるくすぼめ、高台は短く幅を残す。
 * 脚が細長いと杯やゴブレットに見えるので、茎状の丸脚は使わない。
 */
const BOWL_PATH =
  "M8 34C8 28 26 26 50 26C74 26 92 28 92 34C92 39 91 52 87 66C84 76 72 84 64 85L60 91L40 91L36 85C28 84 16 76 13 66C9 52 8 39 8 34Z";

/**
 * @param {number} size
 * @param {number} artworkScale 1 はキャンバスいっぱい、0.8 は maskable の Safe Zone
 */
function bowlSvg(size, artworkScale) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${PAPER}"/>
  <g transform="translate(50 50) scale(${String(artworkScale)}) translate(-50 -50)">
    <path fill="${TERRACOTTA}" d="${BOWL_PATH}"/>
  </g>
</svg>`;
}

/**
 * @param {string} relativePath
 * @param {number} size
 * @param {number} artworkScale
 */
async function writeIcon(relativePath, size, artworkScale) {
  const target = join(root, relativePath);
  await sharp(Buffer.from(bowlSvg(size, artworkScale)))
    .png()
    .toFile(target);
  return target;
}

export async function writePwaIcons() {
  await mkdir(join(root, "public/icons"), { recursive: true });
  await writeIcon("public/icons/apple-touch-icon.png", 180, 1);
  await writeIcon("public/icons/icon-192.png", 192, 1);
  await writeIcon("public/icons/icon-512.png", 512, 1);
  await writeIcon("public/icons/icon-512-maskable.png", 512, 0.8);
}

const isDirect = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  await writePwaIcons();
}
