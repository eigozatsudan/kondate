/**
 * チラシ画像パイプライン（Task7）。
 * magic bytes / raw 4MiB / sharp decode / max 2048²。
 * ファイル名・バイト内容はログしない。
 */
import sharp from "sharp";

export const FLYER_MAX_RAW_BYTES = 4 * 1024 * 1024;
export const FLYER_MAX_EDGE = 2048;

export type FlyerImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export type FlyerImageErrorCode = "flyer_invalid_image" | "flyer_unsupported_media";

export class FlyerImageError extends Error {
  constructor(readonly code: FlyerImageErrorCode) {
    super(code);
    this.name = "FlyerImageError";
  }
}

export type PreparedFlyerImage = {
  mediaType: FlyerImageMediaType;
  /** OpenRouter data URL 用（data:image/...;base64,...） */
  dataUrl: string;
  width: number;
  height: number;
};

function detectMediaType(bytes: Uint8Array): FlyerImageMediaType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * multipart から得た raw バイトを検証し、必要なら 2048 辺に縮小して data URL を返す。
 * 呼び出し側はリクエスト終了で buffer を破棄すること（非永続）。
 */
export async function prepareFlyerImage(raw: Uint8Array): Promise<PreparedFlyerImage> {
  if (raw.byteLength === 0 || raw.byteLength > FLYER_MAX_RAW_BYTES) {
    throw new FlyerImageError("flyer_invalid_image");
  }

  const mediaType = detectMediaType(raw);
  if (mediaType === null) {
    throw new FlyerImageError("flyer_unsupported_media");
  }

  try {
    const pipeline = sharp(Buffer.from(raw), {
      failOn: "error",
      limitInputPixels: FLYER_MAX_EDGE * FLYER_MAX_EDGE * 4,
    }).rotate();

    const meta = await pipeline.metadata();
    const width = typeof meta.width === "number" ? meta.width : 0;
    const height = typeof meta.height === "number" ? meta.height : 0;
    if (width < 1 || height < 1) {
      throw new FlyerImageError("flyer_invalid_image");
    }

    let output = pipeline;
    if (width > FLYER_MAX_EDGE || height > FLYER_MAX_EDGE) {
      output = pipeline.resize({
        width: FLYER_MAX_EDGE,
        height: FLYER_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // 形式を保ったまま buffer 化（polyglot を sharp 経由で正規化）
    const encoded =
      mediaType === "image/png"
        ? await output.png().toBuffer({ resolveWithObject: true })
        : mediaType === "image/webp"
          ? await output.webp().toBuffer({ resolveWithObject: true })
          : await output.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });

    const outW = encoded.info.width;
    const outH = encoded.info.height;
    if (outW < 1 || outH < 1 || outW > FLYER_MAX_EDGE || outH > FLYER_MAX_EDGE) {
      throw new FlyerImageError("flyer_invalid_image");
    }

    const b64 = encoded.data.toString("base64");
    return {
      mediaType,
      dataUrl: `data:${mediaType};base64,${b64}`,
      width: outW,
      height: outH,
    };
  } catch (error: unknown) {
    if (error instanceof FlyerImageError) throw error;
    throw new FlyerImageError("flyer_invalid_image");
  }
}
