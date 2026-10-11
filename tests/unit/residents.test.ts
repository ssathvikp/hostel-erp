import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { NEXT_STATUSES } from "@/features/residents/options";
import { detectIdProofType } from "@/lib/residents/file-type";
import { idProofFingerprint } from "@/lib/residents/id-proof-fingerprint";
import {
  residentSchema,
  residentStatusSchema,
  residentUpdateSchema,
  todayIst,
  validate,
} from "@/lib/validation";

const hmac = (key: string) => (message: string) =>
  createHmac("sha256", key).update(message).digest("hex");

describe("idProofFingerprint", () => {
  it("keeps only the last 4 characters and a 64-character keyed hash", () => {
    const result = idProofFingerprint("aadhaar", "234567890123", hmac("k1"));
    expect(result.id_proof_last4).toBe("0123");
    expect(result.id_proof_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain("234567890123");
  });

  it("is stable for the same number and key, and differs by key and by document", () => {
    const a = idProofFingerprint("pan", "ABCDE1234F", hmac("k1")).id_proof_hash;
    expect(idProofFingerprint("pan", "ABCDE1234F", hmac("k1")).id_proof_hash).toBe(a);
    expect(idProofFingerprint("pan", "ABCDE1234F", hmac("k2")).id_proof_hash).not.toBe(a);
    expect(idProofFingerprint("passport", "ABCDE1234F", hmac("k1")).id_proof_hash).not.toBe(a);
  });
});

describe("detectIdProofType", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it.each([
    ["PDF", bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), "application/pdf"],
    ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg"],
    ["PNG", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png"],
  ])("recognises %s from its contents", (_name, head, mime) => {
    expect(detectIdProofType(head)?.mime).toBe(mime);
  });

  it("rejects anything else, whatever it is called", () => {
    expect(detectIdProofType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull(); // a Windows .exe
    expect(detectIdProofType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
    expect(detectIdProofType(bytes(0x25, 0x50))).toBeNull(); // truncated
  });
});

describe("residentSchema ID formats", () => {
  const base = {
    full_name: "Arjun Reddy",
    phone: "9876543210",
    gender: "male",
    dob: "2003-01-15",
    permanent_address: "Hyderabad",
    joining_date: todayIst(),
  };

  it.each([
    ["aadhaar", "2345 6789 0123", true],
    ["aadhaar", "1234 5678 9012", false],
    ["pan", "abcde1234f", true],
    ["pan", "ABCD12345F", false],
    ["passport", "A1234567", true],
    ["voter_id", "ABC1234567", true],
    ["driving_licence", "KA01 20190001234", true],
  ])("%s %s → valid: %s", (type, number, ok) => {
    const result = validate(residentSchema, {
      ...base,
      id_proof_type: type,
      id_proof_number: number,
    });
    expect(result.ok).toBe(ok);
  });

  it("rejects a joining date before the date of birth", () => {
    const result = validate(residentSchema, {
      ...base,
      id_proof_type: "pan",
      id_proof_number: "ABCDE1234F",
      joining_date: "2000-01-01",
    });
    expect(result.ok ? {} : result.fieldErrors).toHaveProperty("joining_date");
  });
});

describe("residentUpdateSchema", () => {
  it("only carries the editable fields", () => {
    const result = validate(residentUpdateSchema, {
      full_name: "Changed",
      phone: "+91 98765 43210",
      permanent_address: "Pune",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        phone: "9876543210",
        alt_phone: null,
        email: null,
        guardian_name: null,
        guardian_phone: null,
        permanent_address: "Pune",
        notes: null,
      },
    });
  });
});

describe("resident status", () => {
  it("accepts only known statuses", () => {
    const resident_id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(validate(residentStatusSchema, { resident_id, status: "notice" }).ok).toBe(true);
    expect(validate(residentStatusSchema, { resident_id, status: "evicted" }).ok).toBe(false);
  });

  it("never offers vacating an active resident directly", () => {
    expect(NEXT_STATUSES.active).not.toContain("vacated");
  });
});
