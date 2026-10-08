import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { BedStatusControl } from "@/features/rooms/components/BedStatusControl";
import { RoomDangerZone } from "@/features/rooms/components/RoomDangerZone";
import {
  BED_STATUS_LABELS,
  BED_STATUS_TONES,
  floorLabel,
  SHARING_TYPE_LABELS,
} from "@/features/rooms/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";
import type { BedStatus, ManualBedStatus, SharingType, ViewRow } from "@/types";
import type { Database } from "@/types/database";

export const metadata: Metadata = { title: "Room" };

type BedStateRow = Database["public"]["Views"]["bed_states"]["Row"];
/** Every bed_states column is set except the status audit fields. */
type BedRow = ViewRow<
  Omit<BedStateRow, "status_reason" | "status_changed_at" | "status_changed_by">
> &
  Pick<BedStateRow, "status_reason" | "status_changed_at">;

const changedAt = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/** A room and its beds, with bed status controls (E4-T7, E4-T8). */
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const { user, hostel } = await requireActiveHostel();
  const { id } = await params;
  const { updated } = await searchParams;
  if (!uuid("Room").safeParse(id).success) notFound();

  const supabase = await createClient();
  const [{ data: room, error }, { data: beds, error: bedsError }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, room_number, floor, sharing_type, capacity, status")
      .eq("id", id)
      .eq("hostel_id", hostel.id)
      .maybeSingle(),
    supabase
      .from("bed_states")
      .select("id, bed_label, status, manual_status, status_reason, status_changed_at")
      .eq("room_id", id)
      .eq("hostel_id", hostel.id)
      .order("bed_label"),
  ]);
  if (error) throw error;
  if (bedsError) throw bedsError;
  if (!room) notFound();

  const isOwner = user.role === "owner";
  const archived = room.status === "archived";
  const rows = (beds ?? []) as BedRow[];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link href="/rooms" className="text-sm font-medium text-brand-700 hover:underline">
          ← All rooms
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`Room ${room.room_number}`}
            description={
              <>
                {floorLabel(room.floor)} · {SHARING_TYPE_LABELS[room.sharing_type as SharingType]} ·{" "}
                {room.capacity} {room.capacity === 1 ? "bed" : "beds"}
              </>
            }
            actions={
              isOwner &&
              !archived && (
                <Link
                  href={`/rooms/${room.id}/edit`}
                  className={buttonClass({ variant: "secondary" })}
                >
                  Edit room
                </Link>
              )
            }
          />
        </div>
        {updated && <Alert tone="success">Room details saved.</Alert>}
        {archived && (
          <Alert tone="info">
            This room is archived. It is kept for history and can no longer be changed or allocated.
          </Alert>
        )}
      </div>

      {!archived && (
        <section aria-labelledby="beds-heading" className="space-y-3">
          <h2 id="beds-heading" className="text-base font-semibold text-slate-900">
            Beds
          </h2>
          <Table caption={`Beds in room ${room.room_number}`}>
            <THead>
              <tr>
                <Th>Bed</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th>Last changed</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((bed) => (
                <Tr key={bed.id}>
                  <Td className="font-medium">{bed.bed_label}</Td>
                  <Td>
                    <Badge tone={BED_STATUS_TONES[bed.status as BedStatus]}>
                      {BED_STATUS_LABELS[bed.status as BedStatus]}
                    </Badge>
                  </Td>
                  <Td className="whitespace-normal text-slate-600">{bed.status_reason ?? "—"}</Td>
                  <Td className="text-slate-600">
                    {bed.status_changed_at
                      ? changedAt.format(new Date(bed.status_changed_at))
                      : "—"}
                  </Td>
                  <Td className="text-right">
                    {bed.status !== "occupied" && (
                      <BedStatusControl
                        bed={{
                          id: bed.id,
                          label: bed.bed_label,
                          status: bed.manual_status as ManualBedStatus,
                          reason: bed.status_reason ?? null,
                        }}
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {isOwner && !archived && <RoomDangerZone room={{ id: room.id, number: room.room_number }} />}
    </div>
  );
}
