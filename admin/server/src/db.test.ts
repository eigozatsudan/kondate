import { describe, it, expect } from "vitest";
import { assertDatabaseUrl, buildPoolSslOptions } from "./db.js";

describe("assertDatabaseUrl", () => {
  it("rejects transaction pooler port 6543", () => {
    expect(() =>
      assertDatabaseUrl("postgresql://kondate_ops_readonly:x@host:6543/postgres?sslmode=require", {
        allowInsecureLocalDb: false,
      }),
    ).toThrow(/6543/);
  });

  it("rejects postgres superuser name", () => {
    expect(() =>
      assertDatabaseUrl("postgresql://postgres:x@host:5432/postgres?sslmode=require", {
        allowInsecureLocalDb: false,
      }),
    ).toThrow(/kondate_ops_readonly/);
  });

  it("accepts session pooler with exact role.ref username", () => {
    const ref = "abcdefghij1234567890"; // 20 chars
    const u = assertDatabaseUrl(
      `postgresql://kondate_ops_readonly.${ref}:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
      { allowInsecureLocalDb: false },
    );
    expect(u.port).toBe("5432");
  });

  it("rejects username prefix abuse", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://kondate_ops_readonly_evil:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow(/kondate_ops_readonly/);
  });

  it("rejects role.ref with non-20-char project ref", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://kondate_ops_readonly.short:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow(/kondate_ops_readonly/);
  });

  it("accepts direct host with bare role", () => {
    const ref = "abcdefghij1234567890";
    const u = assertDatabaseUrl(
      `postgresql://kondate_ops_readonly:x@db.${ref}.supabase.co:5432/postgres?sslmode=require`,
      { allowInsecureLocalDb: false },
    );
    expect(u.hostname).toBe(`db.${ref}.supabase.co`);
  });

  it("accepts local insecure when flagged", () => {
    const u = assertDatabaseUrl(
      "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
      { allowInsecureLocalDb: true },
    );
    expect(u.hostname).toBe("127.0.0.1");
  });

  it("rejects local without insecure flag", () => {
    expect(() =>
      assertDatabaseUrl(
        "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
        { allowInsecureLocalDb: false },
      ),
    ).toThrow();
  });
});

describe("buildPoolSslOptions", () => {
  it("sets rejectUnauthorized false for production pooler TLS (sslmode=require)", () => {
    const ref = "abcdefghij1234567890";
    const opts = buildPoolSslOptions(
      `postgresql://kondate_ops_readonly.${ref}:x@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
      false,
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: false });
    expect(opts.connectionString).not.toMatch(/sslmode=/);
  });

  it("sets rejectUnauthorized true when sslmode is verify-full", () => {
    const ref = "abcdefghij1234567890";
    const opts = buildPoolSslOptions(
      `postgresql://kondate_ops_readonly:x@db.${ref}.supabase.co:5432/postgres?sslmode=verify-full`,
      false,
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
    expect(opts.connectionString).not.toMatch(/sslmode=/);
  });

  it("sets rejectUnauthorized true when sslmode is verify-ca", () => {
    const ref = "abcdefghij1234567890";
    const opts = buildPoolSslOptions(
      `postgresql://kondate_ops_readonly:x@db.${ref}.supabase.co:5432/postgres?sslmode=verify-ca`,
      false,
    );
    expect(opts.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("leaves ssl off for local disable", () => {
    const opts = buildPoolSslOptions(
      "postgresql://kondate_ops_readonly:x@127.0.0.1:5432/postgres?sslmode=disable",
      true,
    );
    expect(opts.ssl).toBeUndefined();
  });
});
