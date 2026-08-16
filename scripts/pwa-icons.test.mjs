import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** PNG シグネチャ先頭 4 バイト（\x89PNG）。 */
const PNG_SIGNATURE = Buffer.from("\x89PNG", "latin1");

/**
 * コミット済みアイコンが実 PNG であり、IHDR の幅高が用途どおりかを固定する。
 * 生成手段（sharp 等）は問わず、成果物のピクセル寸法だけを見る。
 * @param {Buffer} bytes
 */
function readPngIhdrSize(bytes) {
  assert.ok(bytes.byteLength >= 24, "png_too_short");
  assert.deepEqual(bytes.subarray(0, 4), PNG_SIGNATURE);
  assert.equal(bytes.subarray(12, 16).toString("latin1"), "IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

const icons = [
  { relativePath: "public/icons/apple-touch-icon.png", width: 180, height: 180 },
  { relativePath: "public/icons/icon-192.png", width: 192, height: 192 },
  { relativePath: "public/icons/icon-512.png", width: 512, height: 512 },
  { relativePath: "public/icons/icon-512-maskable.png", width: 512, height: 512 },
];

for (const icon of icons) {
  test(`${icon.relativePath} is a ${icon.width}×${icon.height} PNG`, async () => {
    const bytes = await readFile(join(root, icon.relativePath));
    const size = readPngIhdrSize(bytes);
    assert.equal(size.width, icon.width);
    assert.equal(size.height, icon.height);
  });
}
