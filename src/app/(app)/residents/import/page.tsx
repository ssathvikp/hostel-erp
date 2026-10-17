import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { commitResidentImport, previewResidentImport } from "@/features/import/actions";
import { ImportForm } from "@/features/import/components/ImportForm";
import { ImportHelp } from "@/features/import/components/ImportHelp";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Import residents" };

/** Residents from an existing register (data import). Owners and staff. */
export default async function ImportResidentsPage() {
  await requireActiveHostel();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/residents" className="text-sm font-medium text-brand-700 hover:underline">
          ← Residents
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Import residents"
            description="Bring in residents from a spreadsheet. Each row is checked exactly like the registration form. Allocate beds afterwards."
          />
        </div>
      </div>
      <ImportHelp
        kind="residents"
        notes={[
          "Dates as 14-05-2002 or 2002-05-14. Gender: male, female or other.",
          "ID proof type: aadhaar, pan, passport, driving licence or voter id. Only the last 4 characters and a secure fingerprint of the number are kept.",
          "Mobile numbers or ID proofs already registered, or repeated in the file, are refused.",
        ]}
      />
      <ImportForm
        preview={previewResidentImport}
        commit={commitResidentImport}
        noun="residents"
        consentLabel="Every resident in this file agreed to their details being kept for running the hostel (DPDP Act, 2023)"
        columns={[
          { key: "full_name", label: "Name" },
          { key: "phone", label: "Mobile" },
          { key: "joining_date", label: "Joined" },
        ]}
      />
    </div>
  );
}
