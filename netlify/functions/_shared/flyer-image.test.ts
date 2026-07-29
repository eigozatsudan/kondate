import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { FLYER_MAX_RAW_BYTES, FlyerImageError, prepareFlyerImage } from "./flyer-image.js";

describe("flyer-image", () => {
  it("imports sharp successfully in flyer-image module", async () => {
    await expect(import("./flyer-image.js")).resolves.toBeDefined();
    expect(typeof sharp).toBe("function");
  });

  it("rejects over 4 MiB with flyer_invalid_image", async () => {
    const huge = new Uint8Array(FLYER_MAX_RAW_BYTES + 1);
    // JPEG magic
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    await expect(prepareFlyerImage(huge)).rejects.toMatchObject({
      code: "flyer_invalid_image",
    });
  });

  it("rejects non jpeg/png/webp magic with flyer_unsupported_media", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
    await expect(prepareFlyerImage(gif)).rejects.toBeInstanceOf(FlyerImageError);
    await expect(prepareFlyerImage(gif)).rejects.toMatchObject({
      code: "flyer_unsupported_media",
    });
  });

  it("accepts a small valid jpeg and returns data url", async () => {
    const buf = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    const prepared = await prepareFlyerImage(new Uint8Array(buf));
    expect(prepared.mediaType).toBe("image/jpeg");
    expect(prepared.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(prepared.width).toBeGreaterThan(0);
    expect(prepared.height).toBeGreaterThan(0);
  });
});
