import { describe, expect, it } from "vitest";

import { detectComplaintMedia } from "@/features/complaints/media";
import { NEXT_STATUSES } from "@/features/complaints/options";
import { targetStates, worstTarget } from "@/features/complaints/targets";
import { complaintSchema, workerSchema } from "@/lib/validation";

/** Complaints and maintenance (ClickUp EP-15). */
describe("targets", () => {
  const base = {
    createdAt: "2026-10-20T00:00:00Z",
    respondBy: "2026-10-20T02:00:00Z",
    resolveBy: "2026-10-21T00:00:00Z",
    firstResponseAt: null,
    resolvedAt: null,
  };
  const at = (iso: string) => Date.parse(iso);

  it("are on track, then due soon in the last fifth, then missed", () => {
    expect(targetStates(base, at("2026-10-20T01:00:00Z")).response).toBe("ok");
    expect(targetStates(base, at("2026-10-20T01:40:00Z")).response).toBe("near");
    expect(targetStates(base, at("2026-10-20T03:00:00Z")).response).toBe("missed");
  });

  it("are met or missed once done, and the worst one wins", () => {
    const answered = { ...base, firstResponseAt: "2026-10-20T01:00:00Z" };
    const states = targetStates(answered, at("2026-10-21T01:00:00Z"));
    expect(states).toEqual({ response: "met", resolution: "missed" });
    expect(worstTarget(states)).toBe("missed");
  });
});

describe("media detection", () => {
  const bytes = (...values: (number | string)[]) =>
    new Uint8Array(
      values.flatMap((value) =>
        typeof value === "string" ? [...value].map((c) => c.charCodeAt(0)) : [value],
      ),
    );

  it("reads the real type from the first bytes", () => {
    expect(detectComplaintMedia(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(detectComplaintMedia(bytes("RIFF", 0, 0, 0, 0, "WEBP"))?.mime).toBe("image/webp");
    expect(detectComplaintMedia(bytes(0, 0, 0, 0x18, "ftypmp42"))).toMatchObject({
      mime: "video/mp4",
      video: true,
    });
    expect(detectComplaintMedia(bytes(0, 0, 0, 0x14, "ftypqt  "))?.mime).toBe("video/quicktime");
    expect(detectComplaintMedia(bytes(0x1a, 0x45, 0xdf, 0xa3))?.mime).toBe("video/webm");
    expect(detectComplaintMedia(bytes("%PDF-1.7"))).toBeNull();
  });
});

describe("forms", () => {
  const id = "0b7d1c2e-6f3a-4d5b-9c8e-1a2b3c4d5e6f";

  it("need a room or an area, and only mark a bed in a room", () => {
    const area = complaintSchema.safeParse({
      location: "area",
      area: "Kitchen",
      room_id: id,
      bed_id: id,
      category_id: id,
      priority: "normal",
      title: "Leak",
      bed_maintenance: "on",
    });
    expect(area.success && area.data).toMatchObject({
      room_id: null,
      bed_id: null,
      bed_maintenance: false,
    });
    const noRoom = complaintSchema.safeParse({
      location: "room",
      category_id: id,
      priority: "high",
      title: "Fan",
    });
    expect(noRoom.success).toBe(false);
  });

  it("take a worker's trades as a list", () => {
    const worker = workerSchema.safeParse({
      kind: "vendor",
      hostel_id: id,
      full_name: "Ravi",
      phone: "+91 98765 43210",
      trades: ["plumber", "plumber"],
    });
    expect(worker.success && worker.data).toMatchObject({
      phone: "9876543210",
      trades: ["plumber"],
    });
    expect(
      workerSchema.safeParse({ kind: "vendor", hostel_id: id, full_name: "R", phone: "9876543210" })
        .success,
    ).toBe(false);
  });

  it("offer the same moves as the database", () => {
    expect(NEXT_STATUSES.closed).toEqual(["reopened"]);
    expect(NEXT_STATUSES.resolved).toContain("reopened");
  });
});
