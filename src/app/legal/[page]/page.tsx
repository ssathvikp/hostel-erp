import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui";
import { isLegalPage, LEGAL_PAGES, TERMS_VERSION, type LegalPage } from "@/lib/legal";

export function generateStaticParams() {
  return Object.keys(LEGAL_PAGES).map((page) => ({ page }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  return { title: isLegalPage(page) ? LEGAL_PAGES[page] : "Not found" };
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 text-lg font-semibold text-slate-900">{children}</h2>;
}

/** Placeholder texts: each needs a lawyer's review before launch (ClickUp EP-14 T11). */
const CONTENT: Record<LegalPage, ReactNode> = {
  terms: (
    <>
      <p>
        Hostel ERP is software for running hostels and PGs: rooms, residents, rent and repairs.
        These terms apply to everyone who creates an account.
      </p>
      <H>Your account</H>
      <p>
        You are responsible for the people you give access to (your staff) and for what they do in
        the app. Keep your password private.
      </p>
      <H>Your data</H>
      <p>
        The data you enter about your hostel and residents is yours. You can download it at any time
        from Settings. We process residents&apos; personal data on your behalf, as described in the
        privacy policy.
      </p>
      <H>Plans and payment</H>
      <p>
        New accounts start with a free trial. When it ends, the account becomes read-only until a
        plan is chosen; nothing is deleted. Plan prices are shown on the billing page.
      </p>
      <H>Acceptable use</H>
      <p>Do not use the app for anything unlawful, or to store data you have no right to hold.</p>
      <H>Liability</H>
      <p>
        The service is provided as is. Our liability is limited to the fees you paid us in the last
        three months.
      </p>
    </>
  ),
  privacy: (
    <>
      <p>
        This policy explains what personal data Hostel ERP holds, why, and the rights people have
        under India&apos;s Digital Personal Data Protection Act, 2023.
      </p>
      <H>What we hold</H>
      <p>
        For hostel owners and staff: name, email and phone. For residents, entered by the hostel:
        name, phone, guardian details, address, the last four digits of an ID document and, if the
        hostel uploads one, a copy of it; stays, rent and payments.
      </p>
      <H>Why</H>
      <p>
        To run the hostel&apos;s records and billing. Residents&apos; data is used only by their
        hostel. We do not sell data or use it for advertising.
      </p>
      <H>Your rights</H>
      <p>
        A resident can ask their hostel for a copy of their data or for it to be erased once nothing
        is owed. The hostel does this from the resident&apos;s page.
      </p>
      <H>Where it is stored</H>
      <p>
        On managed servers, encrypted in transit. ID documents are in private storage, opened only
        through short-lived links.
      </p>
    </>
  ),
  refunds: (
    <>
      <p>
        Subscriptions are billed in advance. You can cancel at any time; the cancellation takes
        effect at the end of the period already paid for.
      </p>
      <H>Refunds</H>
      <p>
        If you are charged in error, or charged after cancelling, tell us within 30 days and we will
        refund the amount in full to the original payment method.
      </p>
      <H>Rent paid by residents</H>
      <p>
        Rent and deposits are paid to the hostel, not to Hostel ERP. Ask the hostel about those
        refunds.
      </p>
    </>
  ),
  contact: (
    <>
      <p>For help with your account, billing or these policies, write to us.</p>
      <H>Email</H>
      <p>support@example.com (placeholder: set the real address before launch)</p>
      <H>Grievance officer</H>
      <p>Name and address to be added before launch, as the DPDP Act requires.</p>
    </>
  ),
};

/** Public legal pages, linked from sign-up and the footer (ClickUp EP-14 T11). */
export default async function LegalPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!isLegalPage(page)) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-sm leading-6 text-slate-800">
      <Link href="/login" className="text-sm font-medium text-brand-700 hover:underline">
        ← Hostel ERP
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">{LEGAL_PAGES[page]}</h1>
      <Alert tone="warning" className="mt-4">
        Draft for review: this text has not yet been reviewed by a lawyer. Version {TERMS_VERSION}.
      </Alert>
      <div className="mt-6 space-y-3">{CONTENT[page]}</div>
      <nav aria-label="Legal" className="mt-10 flex flex-wrap gap-4 border-t border-slate-200 pt-4">
        {Object.entries(LEGAL_PAGES).map(([slug, title]) => (
          <Link key={slug} href={`/legal/${slug}`} className="text-brand-700 hover:underline">
            {title}
          </Link>
        ))}
      </nav>
    </main>
  );
}
