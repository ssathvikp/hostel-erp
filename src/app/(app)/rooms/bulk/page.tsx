import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { BulkRoomGenerator } from "@/features/rooms/components/BulkRoomGenerator";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Add rooms in bulk" };

/** Bulk room generation for a number range (E4-T5). Owners only. */
export default async function BulkRoomsPage() {
  const { user, hostel } = await requireActiveHostel();
  if (user.role !== "owner") redirect("/rooms");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add rooms in bulk"
        description={`Create a run of numbered rooms on one floor of ${hostel.name}, with their beds.`}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <BulkRoomGenerator />
      </div>
    </div>
  );
}
