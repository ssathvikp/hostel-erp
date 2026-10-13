import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { ComplaintForm } from "@/features/complaints/components/ComplaintForm";
import { getCategories } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAllPages } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Raise complaint" };

function id(value: string | undefined): string | undefined {
  return value && uuid("Id").safeParse(value).success ? value : undefined;
}

/** Owners and staff log a complaint (E15-T2). `?room=` or `?resident=` preselect. */
export default async function NewComplaintPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; resident?: string }>;
}) {
  const { hostel } = await requireActiveHostel();
  const { room, resident } = await searchParams;
  const supabase = await createClient();

  const [categories, rooms, beds, residents] = await Promise.all([
    getCategories(supabase, hostel.id),
    fetchAllPages((first, last) =>
      supabase
        .from("room_inventory")
        .select("id, room_number")
        .eq("hostel_id", hostel.id)
        .eq("status", "active")
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(first, last),
    ),
    fetchAllPages((first, last) =>
      supabase
        .from("bed_states")
        .select("id, room_id, bed_label")
        .eq("hostel_id", hostel.id)
        .order("bed_label")
        .order("id")
        .range(first, last),
    ),
    fetchAllPages((first, last) =>
      supabase
        .from("resident_directory")
        .select("id, full_name, room_id")
        .eq("hostel_id", hostel.id)
        .in("status", ["active", "notice"])
        .order("full_name")
        .order("id")
        .range(first, last),
    ),
  ]);

  const bedsByRoom = new Map<string, { id: string; label: string }[]>();
  for (const bed of beds) {
    const list = bedsByRoom.get(bed.room_id!) ?? [];
    list.push({ id: bed.id!, label: bed.bed_label! });
    bedsByRoom.set(bed.room_id!, list);
  }

  return (
    <div className="max-w-2xl">
      <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
        ← All complaints
      </Link>
      <div className="mt-2">
        <PageHeader
          title="Raise a complaint"
          description="It is sent to the right worker straight away when one is available."
        />
      </div>
      <ComplaintForm
        categories={categories
          .filter((category) => category.active)
          .map((category) => ({ value: category.id, label: category.name }))}
        rooms={rooms.map((r) => ({
          id: r.id!,
          label: `Room ${r.room_number}`,
          beds: bedsByRoom.get(r.id!) ?? [],
        }))}
        residents={residents.map((r) => ({ id: r.id!, name: r.full_name!, roomId: r.room_id }))}
        initial={{ roomId: id(room), residentId: id(resident) }}
      />
    </div>
  );
}
