import { describe, expect, it } from "vitest";

import { fillTemplate, SMS_TEMPLATES, statusUrl, updateVariables } from "@/lib/sms/messages";

describe("SMS templates (E15-T3, T4)", () => {
  it("fills every DLT variable in order", () => {
    expect(fillTemplate("resident_code", ["482913", "Sunrise PG"])).toBe(
      "482913 is your code to report a problem at Sunrise PG. It expires in 10 minutes. Do not share it. - Hostel ERP",
    );
  });

  it("turns the stored status token into the full link", () => {
    const token = "a".repeat(48);
    const variables = updateVariables(
      ["12", "Sunrise PG", "received", token],
      "https://app.example.in/",
    );
    expect(variables).toEqual([
      "12",
      "Sunrise PG",
      "received, we will update you",
      `https://app.example.in/c/${token}`,
    ]);
    expect(fillTemplate("complaint_update", variables)).toBe(
      `Complaint #12 at Sunrise PG: received, we will update you. Track it: https://app.example.in/c/${token} - Hostel ERP`,
    );
  });

  it("keeps each message within two SMS parts at the longest", () => {
    const longest = fillTemplate(
      "complaint_update",
      updateVariables(
        ["99999", "x".repeat(30), "marked fixed, please confirm", "f".repeat(48)],
        "https://hostel-erp.example.com",
      ),
    );
    expect(longest.length).toBeLessThanOrEqual(306);
    expect(statusUrl("https://x.in", "t")).toBe("https://x.in/c/t");
    expect(Object.keys(SMS_TEMPLATES)).toEqual(["resident_code", "complaint_update"]);
  });
});
