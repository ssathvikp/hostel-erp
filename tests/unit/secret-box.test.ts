import { describe, expect, it } from "vitest";

import { open, seal } from "@/lib/crypto/secret-box";

const KEY = "0f".repeat(32);
const OTHER = "a1".repeat(32);

describe("secret box", () => {
  it("round-trips a secret and never repeats a ciphertext", () => {
    const a = seal("rzp_secret_123", KEY);
    const b = seal("rzp_secret_123", KEY);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("rzp_secret_123");
    expect(open(a, KEY)).toBe("rzp_secret_123");
  });

  it("refuses the wrong key or a tampered value", () => {
    const sealed = seal("whsec", KEY);
    expect(() => open(sealed, OTHER)).toThrow();
    const [v, iv, tag, body] = sealed.split(".");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    expect(() => open([v, iv, tag, flipped.toString("base64url")].join("."), KEY)).toThrow();
    expect(() => open("not sealed", KEY)).toThrow("Not a sealed secret");
  });

  it("insists on a 256-bit key", () => {
    expect(() => seal("x", "abc")).toThrow("64 hexadecimal characters");
  });
});
