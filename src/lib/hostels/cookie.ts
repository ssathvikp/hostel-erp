/** Remembers which hostel a multi-hostel owner is working in. */
export const ACTIVE_HOSTEL_COOKIE = "active_hostel";

/** httpOnly so page scripts cannot read or forge it; a year so it survives restarts. */
export const ACTIVE_HOSTEL_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;
