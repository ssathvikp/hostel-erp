import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert } from "@/components/ui";
import { commitRoomImport, previewRoomImport } from "@/features/import/actions";
import { ImportForm } from "@/features/import/components/ImportForm";
import { ImportHelp } from "@/features/import/components/ImportHelp";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Import rooms" };

/** Rooms from an existing spreadsheet (data import). Owners only. */
export default async function ImportRoomsPage() {
  const { user } = await requireActiveHostel();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/rooms" className="text-sm font-medium text-brand-700 hover:underline">
          ← Rooms
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Import rooms"
            description="Bring in rooms from a spreadsheet. Beds are created for each room, as when adding rooms by hand."
          />
        </div>
      </div>
      {user.role !== "owner" ? (
        <Alert tone="info">Only the hostel owner can add rooms.</Alert>
      ) : (
        <>
          <ImportHelp
            kind="rooms"
            notes={[
              "Sharing: single, double, triple or 4+ (also 1, 2, 3).",
              "Beds can be left blank for single, double and triple rooms.",
              "Room numbers already in this hostel, or repeated in the file, are refused.",
            ]}
          />
          <ImportForm
            preview={previewRoomImport}
            commit={commitRoomImport}
            noun="rooms"
            columns={[
              { key: "room_number", label: "Room" },
              { key: "floor", label: "Floor" },
              { key: "sharing_type", label: "Sharing" },
              { key: "capacity", label: "Beds" },
            ]}
          />
        </>
      )}
    </div>
  );
}
