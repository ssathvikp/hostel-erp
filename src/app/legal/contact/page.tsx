import type { Metadata } from "next";

import { business } from "@/lib/legal";

export const metadata: Metadata = { title: "Contact us" };

export default function ContactPage() {
  return (
    <>
      <h1>Contact us</h1>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_1fr]">
        <dt className="font-medium text-slate-900">Business</dt>
        <dd>{business.legalName}</dd>
        <dt className="font-medium text-slate-900">Registered address</dt>
        <dd className="whitespace-pre-line">{business.address}</dd>
        <dt className="font-medium text-slate-900">Support email</dt>
        <dd>{business.supportEmail}</dd>
        <dt className="font-medium text-slate-900">Support phone</dt>
        <dd>{business.supportPhone}</dd>
        <dt className="font-medium text-slate-900">Grievance officer</dt>
        <dd>
          {business.grievanceOfficer}, {business.grievanceEmail}
        </dd>
      </dl>
      <p>We answer support emails on working days, usually within one working day.</p>
    </>
  );
}
