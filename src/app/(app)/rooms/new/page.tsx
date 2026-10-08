import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { RoomForm } from "@/features/rooms/components/RoomForm";
import { requireActiveHostel } from "@/lib/hostels/active";

export const metadata: Metadata = { title: "Add room" };

/** Single room creation (E4-T2). Owners only. */
export default async function NewRoomPage() {
  const { user, hostel } = await requireActiveHostel();
  if (user.role !== "owner") redirect("/rooms");

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Add room"
        description={`One bed is created for each place in the room at ${hostel.name}.`}
      />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <RoomForm />
      </div>
    </div>
  );
}
