import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  closedHttpErrorDetails,
  handleError,
  HttpError,
  invalidRequest,
  parseJson,
  parseJsonRequest,
  requireOrigin,
} from "./http.js";

describe("continuation HTTP boundary", () => {
  it("requires a JSON content type and canonical origin", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).resolves.toEqual({ value: "ok" });
    expect(requireOrigin(request, "https://app.test")).toBe(true);
    expect(requireOrigin(request, "https://other.test")).toBe(false);
  });

  it("C8: accepts application/json with charset parameters", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        origin: "https://app.test",
      },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).resolves.toEqual({ value: "ok" });
  });

  it("rejects non-JSON content type for parseJsonRequest", async () => {
    const request = new Request("https://functions.test", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://app.test" },
      body: JSON.stringify({ value: "ok" }),
    });
    await expect(parseJsonRequest(request)).rejects.toThrow("invalid_request");
  });

  it.each([true, false])(
    "rejects underdeclared or missing Content-Length before finishing the stream (SC-R2, declared=%s)",
    async (declared) => {
      const chunkSize = 2_048;
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = new Uint8Array(chunkSize).fill(0x61);
          pulled += chunk.byteLength;
          if (pulled > 50_000) {
            controller.error(new Error("stream was read past the parseJsonRequest limit"));
            return;
          }
          controller.enqueue(chunk);
        },
      });
      const headers = new Headers({ "content-type": "application/json" });
      if (declared) headers.set("content-length", "1");
      const promise = parseJsonRequest(
        new Request("https://functions.test", {
          method: "POST",
          headers,
          body,
          duplex: "half",
        } as RequestInit),
      );
      await expect(promise).rejects.toThrow("invalid_request");
      // 8KiB 排他上限 + 1 チャンク。request.text() 全文 read なら 50KiB で stream error になる。
      expect(pulled).toBeLessThanOrEqual(chunkSize * 5);
    },
  );

  it("returns only a closed error for invalid requests", async () => {
    const response = invalidRequest();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "invalid_request", message: "リクエストを確認してください" },
    });
  });
});

describe("generic JSON boundary", () => {
  it.each([true, false])(
    "rejects a 65,537 byte UTF-8 body with declared length=%s",
    async (declared) => {
      const body = `"${"あ".repeat(21_845)}"`;
      const headers = new Headers({ "content-type": "application/json" });
      if (declared) headers.set("content-length", "65537");
      const promise = parseJson(
        new Request("https://functions.test", { method: "POST", headers, body }),
        z.string(),
      );
      await expect(promise).rejects.toMatchObject({
        status: 413,
        code: "request_too_large",
      } satisfies Partial<HttpError>);
    },
  );

  it("rejects an underdeclared Content-Length before finishing the stream (SC5)", async () => {
    const chunkSize = 16_384;
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(chunkSize).fill(0x61);
        pulled += chunk.byteLength;
        if (pulled > 200_000) {
          controller.error(new Error("stream was read past the parseJson limit"));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    const promise = parseJson(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "1" },
        body,
        duplex: "half",
      } as RequestInit),
      z.unknown(),
    );
    await expect(promise).rejects.toMatchObject({
      status: 413,
      code: "request_too_large",
    } satisfies Partial<HttpError>);
    expect(pulled).toBeLessThanOrEqual(chunkSize * 5);
  });
});

describe("parseJson content-type and field error closing", () => {
  it("rejects non-JSON content type", async () => {
    const promise = parseJson(
      new Request("https://functions.test", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ok: true }),
      }),
      z.object({ ok: z.boolean() }),
    );
    await expect(promise).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
    } satisfies Partial<HttpError>);
  });

  it("accepts application/json with charset and +json", async () => {
    for (const contentType of ["application/json; charset=utf-8", "application/vnd.api+json"]) {
      const value = await parseJson(
        new Request("https://functions.test", {
          method: "POST",
          headers: { "content-type": contentType },
          body: JSON.stringify("ok"),
        }),
        z.string(),
      );
      expect(value).toBe("ok");
    }
  });

  it("maps fieldErrors messages to generic invalid without embedding input", async () => {
    await expect(
      parseJson(
        new Request("https://functions.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(3) }),
        }),
        z.object({
          name: z.string().min(10, "名前は10文字以上: 入力値をそのまま出さない"),
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_request",
      details: { fields: { name: ["invalid"] } },
    });
  });
});

describe("S8 closedHttpErrorDetails / handleError", () => {
  it("keeps only fields(invalid) and release_failed true; drops free-text keys", () => {
    expect(
      closedHttpErrorDetails({
        fields: { name: ["入力「太郎」は不可: canary@example.com"] },
        release_failed: true,
        raw: "<user body>",
        message: "内部 stack trace",
        allergy: ["卵"],
      }),
    ).toEqual({
      fields: { name: ["invalid"] },
      release_failed: true,
    });
  });

  it("handleError does not echo free-text details on the wire", async () => {
    const response = handleError(
      new HttpError(400, "invalid_request", "入力内容を確認してください", {
        raw: "secret-body canary@example.com",
        fields: { meal: ["unexpected free text 太郎"] },
        release_failed: true,
      }),
    );
    const body = (await response.json()) as {
      ok: false;
      error: { code: string; details?: Record<string, unknown> };
    };
    expect(body.error.details).toEqual({
      fields: { meal: ["invalid"] },
      release_failed: true,
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain("canary@example.com");
    expect(text).not.toContain("太郎");
    expect(text).not.toContain("secret-body");
  });

  it("closes free-text code/message and keeps existing Japanese messages", async () => {
    const leaked = handleError(
      new HttpError(502, "openrouter said: canary@example.com", "stack prompt 太郎"),
    );
    const leakedBody = (await leaked.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(leakedBody.error.code).toBe("request_failed");
    expect(leakedBody.error.message).toBe("処理を完了できませんでした");
    const leakedText = JSON.stringify(leakedBody);
    expect(leakedText).not.toContain("canary@example.com");
    expect(leakedText).not.toContain("太郎");
    expect(leakedText).not.toContain("stack prompt");

    const kept = handleError(new HttpError(400, "invalid_request", "入力内容を確認してください"));
    const keptBody = (await kept.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(keptBody.error.code).toBe("invalid_request");
    expect(keptBody.error.message).toBe("入力内容を確認してください");

    const product = handleError(
      new HttpError(
        400,
        "flyer_unsupported_media",
        "対応している画像形式は JPEG / PNG / WebP です。",
      ),
    );
    const productBody = (await product.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(productBody.error.code).toBe("flyer_unsupported_media");
    expect(productBody.error.message).toBe("対応している画像形式は JPEG / PNG / WebP です。");

    const allergyCopy = handleError(
      new HttpError(
        422,
        "allergy_unconfirmed",
        "アレルギー確認が必要な項目があります。確認してからもう一度お試しください。",
      ),
    );
    const allergyBody = (await allergyCopy.json()) as {
      ok: false;
      error: { message: string };
    };
    expect(allergyBody.error.message).toBe(
      "アレルギー確認が必要な項目があります。確認してからもう一度お試しください。",
    );
  });

  it("closes Japanese name-and-allergy free-text (SC4)", async () => {
    const response = handleError(
      new HttpError(400, "invalid_request", "山田太郎さんの小麦アレルギーを確認してください"),
    );
    const body = (await response.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBe("処理を完了できませんでした");
    const text = JSON.stringify(body);
    expect(text).not.toContain("山田");
    expect(text).not.toContain("太郎");
    expect(text).not.toContain("小麦");
    expect(text).not.toContain("アレルギーを確認してください");
  });

  it("closes name+allergy without honorific, 君, and phone numbers (SC2)", async () => {
    const nameAllergy = handleError(
      new HttpError(400, "invalid_request", "山田太郎の小麦アレルギーを確認してください"),
    );
    const nameAllergyBody = (await nameAllergy.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(nameAllergyBody.error.code).toBe("invalid_request");
    expect(nameAllergyBody.error.message).toBe("処理を完了できませんでした");
    const nameAllergyText = JSON.stringify(nameAllergyBody);
    expect(nameAllergyText).not.toContain("山田");
    expect(nameAllergyText).not.toContain("太郎");
    expect(nameAllergyText).not.toContain("小麦");
    expect(nameAllergyText).not.toContain("アレルギーを確認してください");

    const customAllergy = handleError(
      new HttpError(400, "invalid_request", "そば粉アレルギーを確認してください"),
    );
    const customAllergyBody = (await customAllergy.json()) as {
      ok: false;
      error: { message: string };
    };
    expect(customAllergyBody.error.message).toBe("処理を完了できませんでした");
    expect(JSON.stringify(customAllergyBody)).not.toContain("そば粉");

    const kun = handleError(
      new HttpError(400, "invalid_request", "山田君の連絡先を確認してください"),
    );
    const kunBody = (await kun.json()) as { ok: false; error: { message: string } };
    expect(kunBody.error.message).toBe("処理を完了できませんでした");
    const kunText = JSON.stringify(kunBody);
    expect(kunText).not.toContain("山田");
    expect(kunText).not.toContain("山田君");

    const phone = handleError(
      new HttpError(400, "invalid_request", "090-1234-5678へ連絡してください"),
    );
    const phoneBody = (await phone.json()) as { ok: false; error: { message: string } };
    expect(phoneBody.error.message).toBe("処理を完了できませんでした");
    const phoneText = JSON.stringify(phoneBody);
    expect(phoneText).not.toContain("090");
    expect(phoneText).not.toContain("1234");
    expect(phoneText).not.toContain("5678");

    const compactPhone = handleError(
      new HttpError(400, "invalid_request", "連絡先は09012345678です"),
    );
    const compactPhoneBody = (await compactPhone.json()) as { error: { message: string } };
    expect(compactPhoneBody.error.message).toBe("処理を完了できませんでした");
    expect(JSON.stringify(compactPhoneBody)).not.toContain("09012345678");
  });

  it("keeps closed allergy and quota copy that is not free-text (SC2)", async () => {
    const allergenMissing = handleError(
      new HttpError(
        422,
        "allergen_missing",
        "アレルギー情報の登録が必要です。家族の設定を確認してください。",
      ),
    );
    const allergenMissingBody = (await allergenMissing.json()) as { error: { message: string } };
    expect(allergenMissingBody.error.message).toBe(
      "アレルギー情報の登録が必要です。家族の設定を確認してください。",
    );

    const quota = handleError(
      new HttpError(
        429,
        "user_daily_limit",
        "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
      ),
    );
    const quotaBody = (await quota.json()) as { error: { code: string; message: string } };
    expect(quotaBody.error.code).toBe("user_daily_limit");
    expect(quotaBody.error.message).toBe(
      "本日の作成上限に達しています。明日0:00（日本時間）以降にお試しください。",
    );

    const flyerWeek = handleError(
      new HttpError(403, "flyer_requires_plus", "チラシ写真から 1 週間の献立は Plus の機能です。"),
    );
    const flyerWeekBody = (await flyerWeek.json()) as { error: { message: string } };
    expect(flyerWeekBody.error.message).toBe("チラシ写真から 1 週間の献立は Plus の機能です。");

    const allergyFood = handleError(
      new HttpError(422, "allergy_conflict", "アレルギー食材が、使いたい食材に含まれています"),
    );
    const allergyFoodBody = (await allergyFood.json()) as { error: { message: string } };
    expect(allergyFoodBody.error.message).toBe("アレルギー食材が、使いたい食材に含まれています");

    const pantryConflict = handleError(
      new HttpError(
        422,
        "allergen_pantry_conflict",
        "選択した在庫食材とアレルギー条件が競合しています。",
      ),
    );
    const pantryConflictBody = (await pantryConflict.json()) as { error: { message: string } };
    expect(pantryConflictBody.error.message).toBe(
      "選択した在庫食材とアレルギー条件が競合しています。",
    );
  });

  it("closes quoted-honorific evaluation copy and item-prefixed allergy phrase (SC-R1)", async () => {
    const quoted = handleError(
      new HttpError(
        400,
        "invalid_request",
        "「花子」さんの登録アレルギー「小麦」が「小麦粉」に残っています",
      ),
    );
    const quotedBody = (await quoted.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(quotedBody.error.code).toBe("invalid_request");
    expect(quotedBody.error.message).toBe("処理を完了できませんでした");
    const quotedText = JSON.stringify(quotedBody);
    expect(quotedText).not.toContain("花子");
    expect(quotedText).not.toContain("小麦");
    expect(quotedText).not.toContain("小麦粉");
    expect(quotedText).not.toContain("登録アレルギー");

    const prefixed = handleError(
      new HttpError(400, "invalid_request", "小麦アレルギー食材を除いてください"),
    );
    const prefixedBody = (await prefixed.json()) as {
      ok: false;
      error: { message: string };
    };
    expect(prefixedBody.error.message).toBe("処理を完了できませんでした");
    const prefixedText = JSON.stringify(prefixedBody);
    expect(prefixedText).not.toContain("小麦");
    expect(prefixedText).not.toContain("アレルギー食材を除いてください");
  });

  it("closes particle-separated and choon-suffixed allergy phrases (SC-R4)", async () => {
    const particle = handleError(
      new HttpError(400, "invalid_request", "小麦のアレルギー食材を除いてください"),
    );
    const particleBody = (await particle.json()) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(particleBody.error.code).toBe("invalid_request");
    expect(particleBody.error.message).toBe("処理を完了できませんでした");
    const particleText = JSON.stringify(particleBody);
    expect(particleText).not.toContain("小麦");
    expect(particleText).not.toContain("アレルギー食材を除いてください");

    const choon = handleError(
      new HttpError(400, "invalid_request", "カレーアレルギー食材を除いてください"),
    );
    const choonBody = (await choon.json()) as {
      ok: false;
      error: { message: string };
    };
    expect(choonBody.error.message).toBe("処理を完了できませんでした");
    const choonText = JSON.stringify(choonBody);
    expect(choonText).not.toContain("カレー");
    expect(choonText).not.toContain("アレルギー食材を除いてください");

    const quotedItem = handleError(
      new HttpError(400, "invalid_request", "「小麦」アレルギー食材を除いてください"),
    );
    const quotedItemBody = (await quotedItem.json()) as { error: { message: string } };
    expect(quotedItemBody.error.message).toBe("処理を完了できませんでした");
    const quotedItemText = JSON.stringify(quotedItemBody);
    expect(quotedItemText).not.toContain("小麦");
    expect(quotedItemText).not.toContain("アレルギー食材を除いてください");

    const punctuated = handleError(
      new HttpError(400, "invalid_request", "小麦、アレルギー食材を除いてください"),
    );
    const punctuatedBody = (await punctuated.json()) as { error: { message: string } };
    expect(punctuatedBody.error.message).toBe("処理を完了できませんでした");
    const punctuatedText = JSON.stringify(punctuatedBody);
    expect(punctuatedText).not.toContain("小麦");
    expect(punctuatedText).not.toContain("アレルギー食材を除いてください");
  });

  it("omits details entirely when only unknown keys were provided", async () => {
    const response = handleError(
      new HttpError(500, "request_failed", "処理を完了できませんでした", {
        stack: "Error: boom",
        prompt: "sensitive",
      }),
    );
    const body = (await response.json()) as {
      ok: false;
      error: { details?: unknown };
    };
    expect(body.error.details).toBeUndefined();
  });
});
