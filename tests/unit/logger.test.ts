import { afterEach, describe, expect, it, vi } from "vitest";

import { describeError, logger, pathOnly, redact, scrub } from "@/lib/logger";

describe("scrub", () => {
  it.each([
    ["call 9876543210 now", "call [phone] now"],
    ["call +91 9876543210", "call [phone]"],
    ["call 09876543210", "call [phone]"],
    ["mail priya.menon@example.co.in", "mail [email]"],
    ["aadhaar 1234 5678 9012", "aadhaar [id-number]"],
    ["aadhaar 123456789012", "aadhaar [id-number]"],
    ["pan ABCDE1234F", "pan [id-number]"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln", "jwt [token]"],
    ["Authorization: Bearer abc.def", "Authorization: Bearer [token]"],
    ["key sb_secret_N7UND0UgjKTVK-Uodkm0Hg", "key [key]"],
    ["key sb_publishable_ACJWlzQHlZjBrEguHvfOxg", "key [key]"],
  ])("removes %s", (input, expected) => {
    expect(scrub(input)).toBe(expected);
  });

  it("leaves ordinary text, ids and amounts alone", () => {
    const text = "Invoice 3f2b9c1e-0000-4000-8000-000000000000 for ₹8,500 on 2026-10-11, room 101";
    expect(scrub(text)).toBe(text);
  });
});

describe("redact", () => {
  it("replaces personal and secret fields whatever their value", () => {
    expect(
      redact({
        requestId: "abc",
        full_name: "Priya Menon",
        phone: "x",
        email: "x",
        password: "x",
        access_token: "x",
        nested: { guardian_name: "x", notes: "x", count: 3 },
      }),
    ).toEqual({
      requestId: "abc",
      full_name: "[redacted]",
      phone: "[redacted]",
      email: "[redacted]",
      password: "[redacted]",
      access_token: "[redacted]",
      nested: { guardian_name: "[redacted]", notes: "[redacted]", count: 3 },
    });
  });

  it("scrubs strings inside arrays and free-form fields", () => {
    expect(redact({ detail: ["reach me on 9876543210"] })).toEqual({
      detail: ["reach me on [phone]"],
    });
  });
});

describe("describeError", () => {
  it("keeps only the code and hint of database errors, never their message or details", () => {
    const error = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "residents_hostel_phone_key"',
      details: "Key (hostel_id, phone)=(…, 9876543210) already exists.",
      hint: null,
    };
    expect(describeError(error)).toEqual({ kind: "database", code: "23505" });
  });

  it("scrubs the message and stack of other errors and keeps the digest", () => {
    const error = Object.assign(new Error("failed for priya@example.com"), { digest: "123" });
    const described = describeError(error);
    expect(described).toMatchObject({
      kind: "Error",
      message: "failed for [email]",
      digest: "123",
    });
    expect(String(described.stack)).not.toContain("priya@example.com");
  });
});

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line with the context, scrubbed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("Failed for 9876543210", { requestId: "r-1", phone: "9876543210" });
    expect(spy).toHaveBeenCalledOnce();
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      level: "error",
      message: "Failed for [phone]",
      requestId: "r-1",
      phone: "[redacted]",
    });
    expect(line.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

it("drops query strings, which can hold search text", () => {
  expect(pathOnly("/residents?q=9876543210")).toBe("/residents");
});
