import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSharpLinuxX64InLockfile,
  assertSharpPackageExact,
  verifySharpForNetlify,
} from "./verify-sharp-for-netlify.mjs";

test("assertSharpPackageExact accepts exact pin", () => {
  assert.equal(assertSharpPackageExact({ dependencies: { sharp: "0.35.3" } }), "0.35.3");
});

test("assertSharpPackageExact rejects caret range", () => {
  assert.throws(
    () => assertSharpPackageExact({ dependencies: { sharp: "^0.35.3" } }),
    /sharp_not_exact_pin/,
  );
});

test("assertSharpPackageExact rejects missing", () => {
  assert.throws(() => assertSharpPackageExact({ dependencies: {} }), /sharp_missing/);
});

test("assertSharpLinuxX64InLockfile requires package entry", () => {
  assert.throws(() => assertSharpLinuxX64InLockfile({ packages: {} }), /sharp_linux_x64/);
  assert.equal(
    assertSharpLinuxX64InLockfile(
      {
        packages: {
          "node_modules/@img/sharp-linux-x64": { version: "0.35.3" },
        },
      },
      "0.35.3",
    ),
    true,
  );
});

test("verifySharpForNetlify passes on this workspace", async () => {
  const result = await verifySharpForNetlify();
  assert.equal(result.ok, true);
  assert.match(result.version, /^\d+\.\d+\.\d+$/u);
});
