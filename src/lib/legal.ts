/**
 * The terms an owner accepts at sign-up (ClickUp EP-14 T11). Bump the version
 * whenever the terms or privacy policy change; the version accepted is kept on
 * the owner's profile.
 *
 * These texts are DRAFTS written without a lawyer. They must be reviewed
 * before the app takes payments or real customers; the pages say so.
 */
export const TERMS_VERSION = "2026-10-draft";

export const LEGAL_PAGES = {
  terms: "Terms of service",
  privacy: "Privacy policy",
  refunds: "Refund and cancellation policy",
  contact: "Contact us",
} as const;

export type LegalPage = keyof typeof LEGAL_PAGES;

export function isLegalPage(value: string): value is LegalPage {
  return value in LEGAL_PAGES;
}
