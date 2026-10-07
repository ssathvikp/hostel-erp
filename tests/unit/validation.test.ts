import { describe, expect, it } from "vitest";

import {
  ageOn,
  allocationSchema,
  bulkRoomSchema,
  feeStructureSchema,
  hostelAddressSchema,
  hostelBasicsSchema,
  hostelSchema,
  indianMobile,
  paymentSchema,
  residentSchema,
  roomSchema,
  todayIst,
  toFieldErrors,
  validate,
  validateFormData,
  vacateSchema,
} from "@/lib/validation";

const UUID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const UUID_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** `YYYY-MM-DD` shifted by whole years from today (IST). */
function yearsAgo(years: number): string {
  const [y, m, d] = todayIst().split("-");
  return `${Number(y) - years}-${m}-${d}`;
}

function errorsOf(result: ReturnType<typeof validate>) {
  expect(result.ok).toBe(false);
  return result.ok ? {} : result.fieldErrors;
}

describe("indianMobile", () => {
  it.each(["9876543210", "+91 98765 43210", "098765-43210", "919876543210"])(
    "normalises %s to 10 digits",
    (input) => {
      expect(indianMobile.parse(input)).toBe("9876543210");
    },
  );

  it.each(["12345", "5876543210", "98765432101", "abcdefghij"])("rejects %s", (input) => {
    expect(indianMobile.safeParse(input).success).toBe(false);
  });
});

describe("hostel schemas", () => {
  const basics = {
    name: "  Sunrise PG ",
    type: "boys",
    phone: "9876543210",
    owner_name: "Owner",
  };
  const address = {
    address: "12 MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    alt_phone: "",
    email: "",
    floors: "3",
  };

  it("accepts valid onboarding steps and normalises values", () => {
    expect(hostelBasicsSchema.parse(basics).name).toBe("Sunrise PG");
    const parsed = hostelAddressSchema.parse(address);
    expect(parsed.floors).toBe(3);
    expect(parsed.alt_phone).toBeNull();
    expect(parsed.email).toBeNull();
    expect(hostelSchema.safeParse({ ...basics, ...address }).success).toBe(true);
  });

  it("rejects an unknown hostel type and a bad PIN code", () => {
    expect(errorsOf(validate(hostelBasicsSchema, { ...basics, type: "mixed" }))).toHaveProperty(
      "type",
    );
    expect(
      errorsOf(validate(hostelAddressSchema, { ...address, pincode: "012345" })),
    ).toHaveProperty("pincode");
  });
});

describe("room schemas", () => {
  const room = {
    room_number: " 101a ",
    floor: "1",
    sharing_type: "double",
    capacity: "2",
  };

  it("accepts a valid room, normalising the room number", () => {
    const parsed = roomSchema.parse(room);
    expect(parsed.room_number).toBe("101A");
  });

  it("rejects a capacity that does not match the sharing type", () => {
    expect(errorsOf(validate(roomSchema, { ...room, capacity: "3" }))).toEqual({
      capacity: ["Capacity does not match the sharing type"],
    });
  });

  it("accepts a bulk range and rejects a reversed or oversized one", () => {
    const bulk = { ...room, from_number: "101", to_number: "110" };
    expect(bulkRoomSchema.safeParse(bulk).success).toBe(true);
    expect(errorsOf(validate(bulkRoomSchema, { ...bulk, to_number: "100" }))).toHaveProperty(
      "to_number",
    );
    expect(errorsOf(validate(bulkRoomSchema, { ...bulk, to_number: "250" }))).toHaveProperty(
      "to_number",
    );
  });
});

describe("residentSchema", () => {
  const resident = {
    full_name: "Asha Rao",
    phone: "+91 91234 56789",
    alt_phone: "",
    email: " Asha@Example.com ",
    gender: "female",
    dob: yearsAgo(20),
    id_proof_type: "aadhaar",
    id_proof_number: "1234 5678 9012",
    guardian_name: "",
    guardian_phone: "",
    permanent_address: "Mysuru",
    joining_date: todayIst(),
    notes: "",
  };

  it("accepts a valid resident and normalises identifiers", () => {
    const parsed = residentSchema.parse(resident);
    expect(parsed.phone).toBe("9123456789");
    expect(parsed.email).toBe("asha@example.com");
    expect(parsed.id_proof_number).toBe("123456789012");
    expect(parsed.guardian_name).toBeNull();
  });

  it("rejects an implausible age", () => {
    expect(errorsOf(validate(residentSchema, { ...resident, dob: yearsAgo(5) }))).toHaveProperty(
      "dob",
    );
  });

  it("reports every missing required field", () => {
    const errors = errorsOf(validate(residentSchema, {}));
    for (const field of ["full_name", "phone", "gender", "dob", "permanent_address"]) {
      expect(errors).toHaveProperty(field);
    }
  });
});

describe("allocation schemas", () => {
  it("accepts a valid allocation without a rent override", () => {
    const parsed = allocationSchema.parse({
      resident_id: UUID_A,
      bed_id: UUID_B,
      start_date: "2026-10-01",
      rent_override: "",
    });
    expect(parsed.rent_override).toBeNull();
  });

  it("rejects a malformed bed id", () => {
    expect(
      errorsOf(
        validate(allocationSchema, {
          resident_id: UUID_A,
          bed_id: "bed-1",
          start_date: "2026-10-01",
        }),
      ),
    ).toHaveProperty("bed_id");
  });

  it("validates vacate input", () => {
    const vacate = {
      allocation_id: UUID_A,
      end_date: "2026-10-31",
      vacate_reason: "moved_out",
    };
    expect(vacateSchema.safeParse(vacate).success).toBe(true);
    expect(errorsOf(validate(vacateSchema, { ...vacate, vacate_reason: "bored" }))).toHaveProperty(
      "vacate_reason",
    );
  });
});

describe("fee schemas", () => {
  it("accepts a fee structure and converts rupees to paise", () => {
    const parsed = feeStructureSchema.parse({
      sharing_type: "triple",
      monthly_amount: "5000",
      effective_from: "2026-10-01",
      effective_to: "",
    });
    expect(parsed.monthly_amount).toBe(500000);
    expect(parsed.effective_to).toBeNull();
  });

  it("rejects an amount with more than 2 decimal places", () => {
    expect(
      errorsOf(
        validate(feeStructureSchema, {
          sharing_type: "double",
          monthly_amount: "100.555",
          effective_from: "2026-10-01",
        }),
      ),
    ).toHaveProperty("monthly_amount");
  });

  it("rejects an effective range that ends before it starts", () => {
    expect(
      errorsOf(
        validate(feeStructureSchema, {
          sharing_type: "triple",
          monthly_amount: "5000",
          effective_from: "2026-10-01",
          effective_to: "2026-09-30",
        }),
      ),
    ).toHaveProperty("effective_to");
  });

  const payment = {
    invoice_id: UUID_A,
    amount: "2500",
    paid_at: todayIst(),
    mode: "upi",
    reference: "UTR123",
  };

  it("accepts a valid payment", () => {
    expect(paymentSchema.parse(payment).amount).toBe(250000);
  });

  it("rejects zero amounts and future payment dates", () => {
    expect(errorsOf(validate(paymentSchema, { ...payment, amount: "0" }))).toHaveProperty("amount");
    expect(
      errorsOf(
        validate(paymentSchema, {
          ...payment,
          paid_at: `${Number(todayIst().slice(0, 4)) + 1}-01-01`,
        }),
      ),
    ).toHaveProperty("paid_at");
  });
});

describe("result helpers", () => {
  it("groups issues by dotted field path", () => {
    const parsed = hostelBasicsSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = toFieldErrors(parsed.error);
      expect(Object.keys(errors).sort()).toEqual(["name", "owner_name", "phone", "type"]);
    }
  });

  it("validates FormData into an ActionResult", () => {
    const form = new FormData();
    form.set("resident_id", UUID_A);
    form.set("bed_id", UUID_B);
    form.set("start_date", "2026-10-01");
    expect(validateFormData(allocationSchema, form)).toEqual({
      ok: true,
      data: {
        resident_id: UUID_A,
        bed_id: UUID_B,
        start_date: "2026-10-01",
        rent_override: null,
      },
    });
  });

  it("computes age in whole years", () => {
    expect(ageOn("2000-10-07", "2026-10-06")).toBe(25);
    expect(ageOn("2000-10-06", "2026-10-06")).toBe(26);
  });
});
