import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_TEMPLATE,
  fillTemplate,
  receiptMessage,
  unknownPlaceholders,
  whatsAppLink,
} from "@/features/notifications/message";

const values = { name: "Ravi", hostel: "Sunrise PG", amount: "₹7,500", due_date: "5 Oct 2026" };

describe("reminder messages", () => {
  it("fills every known placeholder in the default text", () => {
    expect(fillTemplate(DEFAULT_REMINDER_TEMPLATE, values)).toBe(
      "Hello Ravi, this is a reminder from Sunrise PG. Rent of ₹7,500 is pending (due 5 Oct 2026). Please pay at the earliest. Thank you.",
    );
  });

  it("leaves unknown placeholders as typed and reports them", () => {
    expect(fillTemplate("Hi {name}, pay {amout}", values)).toBe("Hi Ravi, pay {amout}");
    expect(unknownPlaceholders("Hi {name}, pay {amout} {amout} {room}")).toEqual(["amout", "room"]);
    expect(unknownPlaceholders(DEFAULT_REMINDER_TEMPLATE)).toEqual([]);
  });

  it("repeats a placeholder wherever it appears", () => {
    expect(fillTemplate("{name}, {name}!", values)).toBe("Ravi, Ravi!");
  });

  it("writes a receipt with or without a balance left", () => {
    const base = {
      name: "Ravi",
      hostel: "Sunrise PG",
      amount: "₹5,000",
      month: "October 2026",
      date: "12 Oct 2026",
    };
    expect(receiptMessage({ ...base, balance: "₹2,500" })).toContain("Balance still due: ₹2,500.");
    expect(receiptMessage({ ...base, balance: null })).toContain(
      "Nothing more is due for this month.",
    );
  });
});

describe("WhatsApp links", () => {
  it("adds India's country code and encodes the message", () => {
    expect(whatsAppLink("9876543210", "Rent ₹7,500 & more")).toBe(
      "https://wa.me/919876543210?text=Rent%20%E2%82%B97%2C500%20%26%20more",
    );
  });

  it("gives no link without a valid mobile number", () => {
    for (const phone of [null, undefined, "", "12345", "0123456789"]) {
      expect(whatsAppLink(phone, "x")).toBeNull();
    }
  });

  it("uses the last 10 digits of a number typed with a prefix", () => {
    expect(whatsAppLink("+91 98765-43210", "x")).toBe("https://wa.me/919876543210?text=x");
  });
});
