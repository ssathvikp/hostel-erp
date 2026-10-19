/**
 * How far a hostel has got with setting up (plan E15-T2). The same steps
 * drive the owner's checklist and the admin's "needs a call" list, so both
 * agree on what "set up" means.
 */
export interface SetupFacts {
  beds: number;
  ratesSet: boolean;
  allocationsEver: number;
  invoiced: boolean;
  paymentRecorded: boolean;
}

export const SETUP_STEPS = ["rooms", "rates", "residents", "invoices", "payments"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const SETUP_STEP_LABELS: Record<SetupStep, string> = {
  rooms: "Add rooms and beds",
  rates: "Set rent for each sharing type",
  residents: "Add residents and give them beds",
  invoices: "Generate the month's invoices",
  payments: "Record a payment",
};

export const SETUP_STEP_LINKS: Record<SetupStep, string> = {
  rooms: "/rooms/new",
  rates: "/settings/fees",
  residents: "/residents/new",
  invoices: "/fees",
  payments: "/fees",
};

export function completedSteps(facts: SetupFacts): Record<SetupStep, boolean> {
  return {
    rooms: facts.beds > 0,
    rates: facts.ratesSet,
    residents: facts.allocationsEver > 0,
    invoices: facts.invoiced,
    payments: facts.paymentRecorded,
  };
}

/**
 * A hostel is activated once it runs its rent through the app: beds, people
 * in them, and one month billed. Payments follow on their own.
 */
export function isActivated(facts: SetupFacts): boolean {
  return facts.beds > 0 && facts.allocationsEver > 0 && facts.invoiced;
}
