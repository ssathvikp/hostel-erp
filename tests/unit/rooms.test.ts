import { describe, expect, it } from "vitest";

import { floorLabel } from "@/features/rooms/options";
import { bedLabels, planBulkRooms, summariseRange } from "@/features/rooms/plan";
import { bedStatusSchema, roomSchema, roomUpdateSchema, validate } from "@/lib/validation";

const BED = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("bedLabels", () => {
  it("labels beds with the room number and A, B, C... like the database", () => {
    expect(bedLabels("101", 4)).toEqual(["101-A", "101-B", "101-C", "101-D"]);
    expect(bedLabels("G-02", 1)).toEqual(["G-02-A"]);
  });
});

describe("planBulkRooms", () => {
  it("lists every room in the inclusive range and counts their beds", () => {
    expect(planBulkRooms(101, 105, 3)).toEqual({
      roomNumbers: ["101", "102", "103", "104", "105"],
      bedCount: 15,
    });
  });

  it("plans nothing for an inverted range", () => {
    expect(planBulkRooms(110, 101, 2)).toEqual({ roomNumbers: [], bedCount: 0 });
  });
});

describe("summariseRange", () => {
  it("collapses consecutive numbers into ranges", () => {
    expect(summariseRange(["101", "102", "103", "105", "107", "108"])).toBe(
      "101–103, 105, 107–108",
    );
    expect(summariseRange(["7"])).toBe("7");
    expect(summariseRange([])).toBe("");
  });
});

describe("floorLabel", () => {
  it.each([
    [0, "Ground floor"],
    [1, "1st floor"],
    [2, "2nd floor"],
    [3, "3rd floor"],
    [4, "4th floor"],
    [11, "11th floor"],
    [12, "12th floor"],
    [21, "21st floor"],
  ])("names floor %i as %s", (floor, label) => {
    expect(floorLabel(floor)).toBe(label);
  });
});

describe("roomUpdateSchema", () => {
  it("accepts a consistent edit and ignores any room number sent with it", () => {
    const result = validate(roomUpdateSchema, {
      room_number: "999",
      floor: "2",
      sharing_type: "four_plus",
      capacity: "6",
    });
    expect(result).toEqual({
      ok: true,
      data: { floor: 2, sharing_type: "four_plus", capacity: 6 },
    });
  });

  it("rejects a capacity that does not match the sharing type", () => {
    const result = validate(roomUpdateSchema, {
      floor: "1",
      sharing_type: "double",
      capacity: "3",
    });
    expect(result.ok).toBe(false);
  });

  it("normalises room numbers on create the same way the database does", () => {
    const result = validate(roomSchema, {
      room_number: "  g-12a ",
      floor: "0",
      sharing_type: "single",
      capacity: "1",
    });
    expect(result.ok && result.data.room_number).toBe("G-12A");
  });
});

describe("bedStatusSchema", () => {
  it("keeps a reason for a blocked bed", () => {
    expect(
      validate(bedStatusSchema, { bed_id: BED, status: "blocked", status_reason: " Held " }),
    ).toEqual({ ok: true, data: { bed_id: BED, status: "blocked", status_reason: "Held" } });
  });

  it("drops the reason when a bed becomes available", () => {
    expect(
      validate(bedStatusSchema, { bed_id: BED, status: "available", status_reason: "old" }),
    ).toEqual({ ok: true, data: { bed_id: BED, status: "available", status_reason: null } });
  });

  it("never accepts occupied as a manual status", () => {
    expect(validate(bedStatusSchema, { bed_id: BED, status: "occupied" }).ok).toBe(false);
  });
});
