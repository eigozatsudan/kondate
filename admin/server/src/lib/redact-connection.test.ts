/**
 * A7 / A9: health と startup ログが同じ丸めを使うこと。
 * パスワード・project-ref・pooler リージョンを stdout / 公開 JSON に残さない。
 */
import { describe, it, expect } from "vitest";
import {
  formatAdminListenLog,
  redactHealthConnectionHost,
  redactHealthSessionUser,
} from "./redact-connection.js";

const PROJECT_REF = "abcdefghij1234567890";

describe("redactHealthConnectionHost", () => {
  it("A7/A9: redacts managed direct host project-ref", () => {
    expect(redactHealthConnectionHost(`db.${PROJECT_REF}.supabase.co:5432`)).toBe(
      "db.***.supabase.co:5432",
    );
  });

  it("A9: redacts session pooler region label", () => {
    expect(redactHealthConnectionHost("aws-0-ap-northeast-1.pooler.supabase.com:5432")).toBe(
      "***.pooler.supabase.com:5432",
    );
  });

  it("leaves loopback host as-is", () => {
    expect(redactHealthConnectionHost("127.0.0.1:5432")).toBe("127.0.0.1:5432");
  });
});

describe("redactHealthSessionUser", () => {
  it("A7: redacts role.ref project-ref", () => {
    expect(redactHealthSessionUser(`kondate_ops_readonly.${PROJECT_REF}`)).toBe(
      "kondate_ops_readonly.***",
    );
  });

  it("leaves bare ops role as-is", () => {
    expect(redactHealthSessionUser("kondate_ops_readonly")).toBe("kondate_ops_readonly");
  });

  it("passes through null", () => {
    expect(redactHealthSessionUser(null)).toBeNull();
  });
});

describe("formatAdminListenLog", () => {
  it("A7: startup line uses the same redaction as health", () => {
    const password = "super-secret-pass";
    const line = formatAdminListenLog({
      bindHost: "127.0.0.1",
      port: 5193,
      databaseUrl: `postgresql://kondate_ops_readonly.${PROJECT_REF}:${password}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
      sessionUser: `kondate_ops_readonly.${PROJECT_REF}`,
    });
    expect(line).toBe(
      "[admin] listening on 127.0.0.1:5193 (db host=db.***.supabase.co:5432, session_user=kondate_ops_readonly.***)",
    );
    expect(line).not.toContain(PROJECT_REF);
    expect(line).not.toContain(password);
  });

  it("A7/A9: startup line redacts pooler region and never prints password", () => {
    const password = "super-secret-pass";
    const line = formatAdminListenLog({
      bindHost: "0.0.0.0",
      port: 5193,
      databaseUrl: `postgresql://kondate_ops_readonly.${PROJECT_REF}:${password}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
      sessionUser: `kondate_ops_readonly.${PROJECT_REF}`,
    });
    expect(line).toBe(
      "[admin] listening on 0.0.0.0:5193 (db host=***.pooler.supabase.com:5432, session_user=kondate_ops_readonly.***)",
    );
    expect(line).not.toContain(PROJECT_REF);
    expect(line).not.toContain("ap-northeast-1");
    expect(line).not.toContain("aws-0");
    expect(line).not.toContain(password);
  });
});
