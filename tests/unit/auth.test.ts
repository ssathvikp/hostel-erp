import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/redirect";
import { assertRole, AuthorizationError, type SessionUser } from "@/lib/auth/roles";
import {
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  toFieldErrors,
  validate,
} from "@/lib/validation";
import type { ProfileRole } from "@/types";

describe("safeNextPath", () => {
  it.each([
    ["/rooms", "/rooms"],
    ["/residents?status=active#top", "/residents?status=active#top"],
    ["/dashboard/../rooms", "/rooms"],
  ])("keeps the same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["an absolute URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["an embedded backslash", "/rooms\\..\\..\\evil"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a dot segment before //", "/.//evil.example"],
    ["a parent segment before //", "/..//evil.example"],
    ["a nested parent segment before //", "/a/..//evil.example"],
    ["an encoded dot segment", "/%2e//evil.example"],
    ["a relative path", "rooms"],
    ["a control character", "/rooms\n/evil"],
    ["an empty value", ""],
    ["a non-string", 42],
    ["a missing value", null],
  ])("falls back to the dashboard for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });

  it("uses a custom fallback when given one", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });
});

describe("assertRole", () => {
  const user = (role: ProfileRole): SessionUser => ({
    id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    fullName: "Test User",
    role,
    hostelId: role === "staff" ? "00000000-0000-4000-8000-000000000002" : null,
  });

  // Two representative actions with different permission sets.
  const editHostelSettings = ["owner"] as const;
  const recordPayment = ["owner", "staff"] as const;

  function reasonFor(fn: () => unknown) {
    try {
      fn();
    } catch (error) {
      return error instanceof AuthorizationError ? error.reason : "unexpected";
    }
    return "allowed";
  }

  it("allows an owner to do both", () => {
    expect(reasonFor(() => assertRole(user("owner"), editHostelSettings))).toBe("allowed");
    expect(reasonFor(() => assertRole(user("owner"), recordPayment))).toBe("allowed");
  });

  it("allows staff to record payments but not edit hostel settings", () => {
    expect(reasonFor(() => assertRole(user("staff"), recordPayment))).toBe("allowed");
    expect(reasonFor(() => assertRole(user("staff"), editHostelSettings))).toBe("forbidden");
  });

  it("rejects a signed-out caller for every action", () => {
    expect(reasonFor(() => assertRole(null, editHostelSettings))).toBe("unauthenticated");
    expect(reasonFor(() => assertRole(null, recordPayment))).toBe("unauthenticated");
  });

  it("does not give a platform admin hostel permissions implicitly", () => {
    expect(reasonFor(() => assertRole(user("platform_admin"), recordPayment))).toBe("forbidden");
  });

  it("returns the user so actions can use it", () => {
    const owner = user("owner");
    expect(assertRole(owner, editHostelSettings)).toBe(owner);
  });
});

describe("authentication schemas", () => {
  const signup = {
    full_name: " Asha Rao ",
    email: " Asha@Example.COM ",
    password: "hostel2026",
    accept_terms: "on",
  };

  it("accepts a valid signup and normalises name and email", () => {
    expect(signupSchema.parse(signup)).toEqual({
      full_name: "Asha Rao",
      email: "asha@example.com",
      password: "hostel2026",
      accept_terms: "on",
    });
  });

  it("needs the terms accepted (ClickUp EP-14 T11)", () => {
    const result = validate(signupSchema, { ...signup, accept_terms: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.accept_terms).toEqual(["Agree to the terms to create an account"]);
  });

  it.each([
    ["too short", "abc123", "Use at least 8 characters"],
    ["letters only", "hostelerp", "Use both letters and numbers"],
    ["digits only", "12345678", "Use both letters and numbers"],
    ["over the bcrypt limit", `a1${"x".repeat(71)}`, "Use at most 72 characters"],
  ])("rejects a password that is %s", (_label, password, message) => {
    const result = validate(signupSchema, { ...signup, password });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.password).toEqual([message]);
  });

  it("asks for a missing email rather than calling it invalid", () => {
    const result = validate(signupSchema, { ...signup, email: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.email).toEqual(["Email is required"]);
  });

  it("does not apply strength rules at sign-in", () => {
    expect(loginSchema.safeParse({ email: "a@example.com", password: "old" }).success).toBe(true);
    const empty = loginSchema.safeParse({ email: "a@example.com", password: "" });
    expect(empty.success).toBe(false);
  });

  it("requires the confirmation to match the new password", () => {
    const parsed = resetPasswordSchema.safeParse({
      password: "hostel2026",
      confirm_password: "hostel2027",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(toFieldErrors(parsed.error)).toEqual({ confirm_password: ["Passwords do not match"] });
    }
  });
});
