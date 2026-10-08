import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { RoomForm } from "@/features/rooms/components/RoomForm";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Edit room" };

/** Edit floor, sharing type and capacity (E4-T7). Owners only. */
export default async function EditRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  if (!uuid("Room").safeParse(id).success) notFound();
  if (user.role !== "owner") redirect(`/rooms/${id}`);

  const supabase = await createClient();
  const { data: room, error } = await supabase
    .from("rooms")
    .select("id, room_number, floor, sharing_type, capacity, status")
    .eq("id", id)
    .eq("hostel_id", hostel.id)
    .maybeSingle();
  if (error) throw error;
  if (!room) notFound();
  // Archived rooms are read-only history.
  if (room.status === "archived") redirect(`/rooms/${id}`);

  return (
    <div className="max-w-2xl">
      <PageHeader title={`Edit room ${room.room_number}`} />
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs sm:p-8">
        <RoomForm room={room} />
      </div>
    </div>
  );
}
