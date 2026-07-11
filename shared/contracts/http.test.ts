import { expectTypeOf, it } from "vitest";
import type { ApiFailure, ApiResponse, ApiSuccess } from "./http.js";

it("keeps the discriminated API envelope", () => {
  expectTypeOf<ApiSuccess<{ id: string }>>().toExtend<{
    ok: true;
    data: { id: string };
  }>();
  expectTypeOf<ApiFailure>().toExtend<{
    ok: false;
    error: { code: string; message: string; details?: Record<string, unknown> };
  }>();
  expectTypeOf<ApiResponse<number>>().toEqualTypeOf<ApiSuccess<number> | ApiFailure>();
});
