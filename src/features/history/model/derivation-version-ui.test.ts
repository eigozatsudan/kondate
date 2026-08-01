import { describe, expect, it } from "vitest";
import { derivationVersionUiState } from "./derivation-version-ui";

describe("derivationVersionUiState", () => {
  it("treats pending as unknown (not single)", () => {
    expect(derivationVersionUiState({ isSuccess: false, isError: false, data: undefined })).toEqual(
      {
        multiVersion: false,
        confirmedSingle: false,
        versionsReady: false,
        versionsFailed: false,
      },
    );
  });

  it("treats error as unknown (not single)", () => {
    expect(derivationVersionUiState({ isSuccess: false, isError: true, data: undefined })).toEqual({
      multiVersion: false,
      confirmedSingle: false,
      versionsReady: false,
      versionsFailed: true,
    });
  });

  it("confirms single when success with 0 or 1 row", () => {
    expect(derivationVersionUiState({ isSuccess: true, isError: false, data: [] })).toMatchObject({
      multiVersion: false,
      confirmedSingle: true,
      versionsReady: true,
    });
    expect(derivationVersionUiState({ isSuccess: true, isError: false, data: [{}] })).toMatchObject(
      { multiVersion: false, confirmedSingle: true },
    );
  });

  it("confirms multi when success with 2+ rows", () => {
    expect(
      derivationVersionUiState({ isSuccess: true, isError: false, data: [{}, {}] }),
    ).toMatchObject({ multiVersion: true, confirmedSingle: false, versionsReady: true });
  });
});
