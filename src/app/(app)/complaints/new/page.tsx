import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { ComplaintForm, type RoomChoice } from "@/features/complaints/components/ComplaintForm";
import { getCategories } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAll } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { todayIst, uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Raise a complaint" };

/** Raise a complaint (ClickUp EP-15 T2). `?room=` or `?resident=` pre-fills it. */
export default async function NewComplaintPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; resident?: string }>;
}) {
  const { hostel } = await requireActiveHostel();
  const params = await searchParams;
  const supabase = await createClient();
  const today = todayIst();

  const [categories, rooms, beds, residents, stays] = await Promise.all([
    getCategories(supabase, hostel.id),
    fetchAll((from, to) =>
      supabase
        .from("room_inventory")
        .select("id, room_number, floor")
        .eq("hostel_id", hostel.id)
        .eq("status", "active")
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("beds")
        .select("id, room_id, bed_label")
        .eq("hostel_id", hostel.id)
        .is("archived_at", null)
        .order("bed_label")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("residents")
        .select("id, full_name")
        .eq("hostel_id", hostel.id)
        .eq("status", "active")
        .order("full_name")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("allocations")
        .select("bed_id, resident_id")
        .eq("hostel_id", hostel.id)
        .lte("start_date", today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order("id")
        .range(from, to),
    ),
  ]);

  const occupant = new Map(stays.map((stay) => [stay.bed_id, stay.resident_id]));
  const roomChoices: RoomChoice[] = rooms.map((room) => ({
    id: room.id!,
    label: `Room ${room.room_number} (floor ${room.floor})`,
    beds: beds
      .filter((bed) => bed.room_id === room.id)
      .map((bed) => ({
        id: bed.id,
        label: bed.bed_label,
        residentId: occupant.get(bed.id) ?? null,
      })),
  }));
  const id = (value: string | undefined) =>
    uuid("Id").safeParse(value).success ? value : undefined;

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
        ← All complaints
      </Link>
      <PageHeader title="Raise a complaint" />
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
        <ComplaintForm
          rooms={roomChoices}
          residents={residents.map((resident) => ({ id: resident.id, label: resident.full_name }))}
          categories={categories.filter((category) => category.active)}
          initial={{ roomId: id(params.room), residentId: id(params.resident) }}
        />
      </div>
    </div>
  );
}
