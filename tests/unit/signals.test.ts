import { describe, expect, it } from "vitest";

import type { AdminHostel } from "@/features/admin/queries";
import { attentionList, hostelSignals } from "@/features/admin/signals";
import { completedSteps, isActivated, type SetupFacts } from "@/lib/hostels/activation";

const TODAY = "2026-10-20";

const SET_UP: SetupFacts = {
  beds: 40,
  ratesSet: true,
  allocationsEver: 30,
  invoiced: true,
  paymentRecorded: true,
};

const NOTHING: SetupFacts = {
  beds: 0,
  ratesSet: false,
  allocationsEver: 0,
  invoiced: false,
  paymentRecorded: false,
};

function hostel(overrides: Partial<AdminHostel> = {}): AdminHostel {
  return {
    id: "h1",
    name: "Sunrise PG",
    city: "Hyderabad",
    status: "active",
    plan: "paid",
    trialEndsAt: null,
    suspensionReason: null,
    createdAt: "2026-09-01T10:00:00Z",
    ownerName: "Asha",
    ownerEmail: "asha@example.com",
    staff: 1,
    rooms: 20,
    beds: 40,
    occupiedBeds: 30,
    residents: 30,
    invoicesThisMonth: 30,
    collectedThisMonth: 0,
    lastActivityAt: "2026-10-19T10:00:00Z",
    setup: SET_UP,
    ownerHostels: 1,
    referredByName: null,
    referrals: 0,
    payingReferrals: 0,
    ...overrides,
  };
}

const kinds = (overrides: Partial<AdminHostel>) =>
  hostelSignals(hostel(overrides), TODAY).map((signal) => signal.kind);

describe("activation", () => {
  it("counts a hostel as set up once it has beds, people in them and a billed month", () => {
    expect(isActivated(SET_UP)).toBe(true);
    expect(isActivated({ ...SET_UP, paymentRecorded: false })).toBe(true);
    expect(isActivated({ ...SET_UP, invoiced: false })).toBe(false);
    expect(completedSteps(NOTHING)).toEqual({
      rooms: false,
      rates: false,
      residents: false,
      invoices: false,
      payments: false,
    });
  });
});

describe("hostelSignals", () => {
  it("flags nothing for a busy, paying, set-up hostel", () => {
    expect(kinds({})).toEqual([]);
  });

  it("flags an unfinished set-up after a week, and asks for a call after three", () => {
    expect(kinds({ setup: NOTHING, createdAt: "2026-10-17T00:00:00Z" })).toEqual([]);
    const week = hostelSignals(
      hostel({ setup: NOTHING, createdAt: "2026-10-12T00:00:00Z" }),
      TODAY,
    );
    expect(week[0]).toMatchObject({ kind: "setup_stalled" });
    expect(week[0].message).toBe("8 days since sign-up. Next step: add rooms and beds.");
    const late = hostelSignals(
      hostel({ setup: { ...NOTHING, beds: 10 }, createdAt: "2026-09-25T00:00:00Z" }),
      TODAY,
    );
    expect(late[0].message).toContain("call the owner");
    expect(late[0].message).toContain("set rent for each sharing type");
  });

  it("flags trials about to end, and trials that ended without a plan", () => {
    expect(kinds({ plan: "trial", trialEndsAt: "2026-10-25" })).toEqual(["trial_ending"]);
    expect(kinds({ plan: "trial", trialEndsAt: "2026-11-25" })).toEqual([]);
    const lapsed = hostelSignals(hostel({ plan: "trial", trialEndsAt: "2026-10-15" }), TODAY);
    expect(lapsed[0]).toMatchObject({
      kind: "trial_lapsed",
      message: "Trial ended 5 days ago without a plan.",
    });
  });

  it("flags a hostel with nothing recorded for two weeks", () => {
    expect(kinds({ lastActivityAt: "2026-10-01T00:00:00Z" })).toEqual(["quiet"]);
    expect(kinds({ lastActivityAt: "2026-10-10T00:00:00Z" })).toEqual([]);
  });

  it("suggests a bigger plan for chains and large hostels not yet paying", () => {
    expect(kinds({ plan: "free", ownerHostels: 3 })).toEqual(["upsell"]);
    expect(kinds({ plan: "trial", trialEndsAt: "2026-12-31", beds: 120 })).toEqual(["upsell"]);
    expect(kinds({ plan: "paid", ownerHostels: 3 })).toEqual([]);
  });

  it("ignores drafts and suspended hostels", () => {
    expect(kinds({ status: "draft", setup: NOTHING })).toEqual([]);
    expect(kinds({ status: "suspended", lastActivityAt: null })).toEqual([]);
  });
});

describe("attentionList", () => {
  it("puts lapsed and ending trials first", () => {
    const list = attentionList(
      [
        hostel({ id: "a", lastActivityAt: "2026-09-01T00:00:00Z" }),
        hostel({ id: "b", plan: "trial", trialEndsAt: "2026-10-10" }),
      ],
      TODAY,
    );
    expect(list.map((signal) => [signal.hostelId, signal.kind])).toEqual([
      ["b", "trial_lapsed"],
      ["a", "quiet"],
    ]);
  });
});
