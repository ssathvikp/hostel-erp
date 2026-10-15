import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, buttonClass, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { AllocateDialog } from "@/features/allocations/components/AllocateDialog";
import { AllocationHistory } from "@/features/allocations/components/AllocationHistory";
import { getAllocationEvents, getUnallocatedResidents } from "@/features/allocations/queries";
import { ComplaintTable } from "@/features/complaints/components/ComplaintTable";
import { getOpenComplaints } from "@/features/complaints/queries";
import {
  MakeRoomCode,
  RegenerateRoomCode,
} from "@/features/resident-complaints/components/StaffForms";
import { BedStatusControl } from "@/features/rooms/components/BedStatusControl";
import { RoomDangerZone } from "@/features/rooms/components/RoomDangerZone";
import {
  BED_STATUS_LABELS,
  BED_STATUS_TONES,
  floorLabel,
  SHARING_TYPE_LABELS,
} from "@/features/rooms/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { siteUrl } from "@/lib/payments/config";
import { qrSvg } from "@/lib/qr";
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

/**
 * A room and its beds: who sleeps in each, bed status controls, allocation
 * from a vacant bed and the room's allocation log (E4-T7, E4-T8, E6-T2, E6-T7).
 */
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
  const [
    { data: room, error },
    { data: beds, error: bedsError },
    { data: occupants, error: occupantsError },
    residents,
    events,
    complaints,
    { data: roomCode, error: roomCodeError },
  ] = await Promise.all([
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
    supabase
      .from("resident_directory")
      .select("id, full_name, bed_label")
      .eq("room_id", id)
      .eq("hostel_id", hostel.id),
    getUnallocatedResidents(supabase, hostel.id),
    getAllocationEvents(supabase, hostel.id, { roomId: id }),
    getOpenComplaints(supabase, hostel.id, { roomId: id }),
    supabase
      .from("room_report_tokens")
      .select("token")
      .eq("room_id", id)
      .is("revoked_at", null)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (roomCodeError) throw roomCodeError;
  if (bedsError) throw bedsError;
  if (occupantsError) throw occupantsError;
  if (!room) notFound();

  const isOwner = user.role === "owner";
  const archived = room.status === "archived";
  const rows = (beds ?? []) as BedRow[];
  const occupantByBed = new Map((occupants ?? []).map((o) => [o.bed_label, o]));
  const residentOptions = residents.map((r) => ({ value: r.id, label: r.label }));
  // Residents report problems from this code (E15-T3).
  const reportUrl = roomCode ? `${siteUrl()}/r/${roomCode.token}` : null;
  const reportQr = reportUrl
    ? await qrSvg(reportUrl, { label: `QR code to report a problem in room ${room.room_number}` })
    : null;

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
                <Th>Resident</Th>
                <Th>Reason</Th>
                <Th>Last changed</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((bed) => {
                const occupant = occupantByBed.get(bed.bed_label);
                return (
                  <Tr key={bed.id}>
                    <Td className="font-medium">{bed.bed_label}</Td>
                    <Td>
                      <Badge tone={BED_STATUS_TONES[bed.status as BedStatus]}>
                        {BED_STATUS_LABELS[bed.status as BedStatus]}
                      </Badge>
                    </Td>
                    <Td>
                      {occupant ? (
                        <Link
                          href={`/residents/${occupant.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {occupant.full_name}
                        </Link>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-normal text-slate-600">{bed.status_reason ?? "—"}</Td>
                    <Td className="text-slate-600">
                      {bed.status_changed_at
                        ? changedAt.format(new Date(bed.status_changed_at))
                        : "—"}
                    </Td>
                    <Td className="space-x-2 text-right">
                      {bed.status === "available" && (
                        <AllocateDialog
                          title={`Allocate bed ${bed.bed_label}`}
                          fixed={{ name: "bed_id", value: bed.id }}
                          choice={{
                            name: "resident_id",
                            label: "Resident",
                            placeholder: "Choose a resident without a bed",
                            options: residentOptions,
                            emptyMessage:
                              "Every active resident already has a bed. Register a resident first.",
                          }}
                          triggerLabel="Allocate"
                          triggerAriaLabel={`Allocate bed ${bed.bed_label}`}
                          size="sm"
                        />
                      )}
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
                );
              })}
            </TBody>
          </Table>
        </section>
      )}

      {!archived && (
        <section aria-labelledby="complaints-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="complaints-heading" className="text-base font-semibold text-slate-900">
              Open complaints
            </h2>
            <Link
              href={`/complaints/new?room=${room.id}`}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Raise complaint
            </Link>
          </div>
          {complaints.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing reported in this room is open.</p>
          ) : (
            <ComplaintTable
              rows={complaints}
              caption={`Open complaints in room ${room.room_number}`}
              compact
            />
          )}
        </section>
      )}

      {!archived && (
        <section aria-labelledby="qr-heading" className="space-y-3">
          <h2 id="qr-heading" className="text-base font-semibold text-slate-900">
            Residents report problems
          </h2>
          {reportUrl && reportQr ? (
            <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-start">
              <div
                className="size-36 shrink-0 [&_svg]:size-full"
                // Inline SVG made on the server by the qrcode library.
                dangerouslySetInnerHTML={{ __html: reportQr }}
              />
              <div className="space-y-2 text-sm text-slate-700">
                <p>
                  Residents of this room scan this code to report a problem. They confirm who they
                  are with a code sent to their mobile number.
                </p>
                <p className="font-mono text-xs break-all">{reportUrl}</p>
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={`/rooms/${room.id}/qr`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    Print code
                  </Link>
                  {isOwner && <RegenerateRoomCode roomId={room.id} />}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Make a QR code for this room so residents can report problems themselves.</p>
              <MakeRoomCode roomId={room.id} />
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-base font-semibold text-slate-900">
          Allocation history
        </h2>
        <AllocationHistory
          events={events}
          show="resident"
          caption={`Allocation history of room ${room.room_number}`}
        />
      </section>

      {isOwner && !archived && <RoomDangerZone room={{ id: room.id, number: room.room_number }} />}
    </div>
  );
}
