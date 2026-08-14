import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

const envBase: NodeJS.ProcessEnv = {
  ADMIN_DATABASE_URL: "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
  ADMIN_ALLOW_INSECURE_LOCAL_DB: "1",
};

describe("loadConfig bind host", () => {
  it("defaults to 127.0.0.1 when ADMIN_BIND_HOST is missing", () => {
    expect(loadConfig(envBase).bindHost).toBe("127.0.0.1");
  });

  it("defaults to 127.0.0.1 when ADMIN_BIND_HOST is empty", () => {
    expect(loadConfig({ ...envBase, ADMIN_BIND_HOST: "" }).bindHost).toBe("127.0.0.1");
  });

  it("defaults to 127.0.0.1 when ADMIN_BIND_HOST is whitespace", () => {
    expect(loadConfig({ ...envBase, ADMIN_BIND_HOST: "  " }).bindHost).toBe("127.0.0.1");
  });

  it("keeps explicit 0.0.0.0 for container listen", () => {
    expect(loadConfig({ ...envBase, ADMIN_BIND_HOST: "0.0.0.0" }).bindHost).toBe("0.0.0.0");
  });
});
