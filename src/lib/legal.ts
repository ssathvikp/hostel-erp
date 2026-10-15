/**
 * The business behind Hostel ERP, as the legal pages and invoices name it
 * (E14-T11). Values come from the environment so they can be filled in
 * without a code change; until then the pages show clearly marked
 * placeholders. See .env.example and docs/billing.md.
 *
 * The page texts are drafts: a lawyer must review them before live
 * payments are switched on. The app only hosts them.
 */

/**
 * The terms version sign-up records. Change it together with the terms text
 * and billing_settings.terms_version (admins: /admin/billing), so the
 * database keeps recording acceptances.
 */
export const TERMS_VERSION = "2026-10-16";

const placeholder = (what: string) => `[${what} — to be added]`;

export const business = {
  legalName: process.env.LEGAL_BUSINESS_NAME || placeholder("Registered business name"),
  address: process.env.LEGAL_BUSINESS_ADDRESS || placeholder("Registered office address"),
  supportEmail: process.env.LEGAL_SUPPORT_EMAIL || placeholder("Support email"),
  supportPhone: process.env.LEGAL_SUPPORT_PHONE || placeholder("Support phone"),
  grievanceOfficer: process.env.LEGAL_GRIEVANCE_OFFICER || placeholder("Grievance officer name"),
  grievanceEmail: process.env.LEGAL_GRIEVANCE_EMAIL || placeholder("Grievance officer email"),
  jurisdiction: process.env.LEGAL_JURISDICTION_CITY || placeholder("City for jurisdiction"),
} as const;

export const LEGAL_PAGES = [
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/privacy", label: "Privacy policy" },
  { href: "/legal/refunds", label: "Refunds and cancellation" },
  { href: "/legal/contact", label: "Contact us" },
] as const;
