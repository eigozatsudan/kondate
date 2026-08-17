import { describe, expect, it } from "vitest";
import {
  PWA_INSTALL_TIP_DISMISSED_KEY,
  readInstallTipDismissed,
  writeInstallTipDismissed,
} from "./install-tip-storage";

describe("readInstallTipDismissed", () => {
  it("is false when the key is missing", () => {
    expect(readInstallTipDismissed({ getItem: () => null })).toBe(false);
  });

  it('is false for "0"', () => {
    expect(readInstallTipDismissed({ getItem: () => "0" })).toBe(false);
  });

  it('is true only for exact "1"', () => {
    expect(readInstallTipDismissed({ getItem: () => "1" })).toBe(true);
  });

  it("L1: is false when getItem throws", () => {
    expect(
      readInstallTipDismissed({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBe(false);
  });
});

describe("writeInstallTipDismissed", () => {
  it("writes 1 and returns true", () => {
    const written: Array<[string, string]> = [];
    expect(
      writeInstallTipDismissed({
        setItem: (key, value) => {
          written.push([key, value]);
        },
      }),
    ).toBe(true);
    expect(written).toEqual([[PWA_INSTALL_TIP_DISMISSED_KEY, "1"]]);
  });

  it("returns false when setItem throws", () => {
    expect(
      writeInstallTipDismissed({
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).toBe(false);
  });
});
