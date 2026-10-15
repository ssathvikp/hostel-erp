/** Shapes of the resident-side tokens (E15-T3, T4); anything else is not worth a query. */

export const RESIDENT_COOKIE = "hostel_erp_resident";

export const isRoomToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

export const isResidentToken = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{48}$/.test(value);

export const isStatusToken = isResidentToken;
