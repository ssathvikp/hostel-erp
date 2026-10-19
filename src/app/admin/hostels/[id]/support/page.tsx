import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { OpenSupportViewForm } from "@/features/admin/components/SupportForms";
import {
  getAdminHostels,
  getSupportSnapshot,
  requirePlatformAdmin,
} from "@/features/admin/queries";
import { SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { SharingType } from "@/types";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Support view" };

const time = new Intl.DateTimeFormat("en-IN", { timeStyle: "short", timeZone: "Asia/Kolkata" });

/**
 * A read-only look inside a hostel to help its owner (ClickUp E10-T5).
 * Opened with a reason the owner sees; lasts an hour; identity and phone
 * numbers show their last four digits; ID proof files cannot be opened.
 */
export default async function SupportViewPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Hostel").safeParse(id).success) notFound();
  const supabase = await createClient();
  const [hostels, snapshot] = await Promise.all([
    getAdminHostels(supabase),
    getSupportSnapshot(supabase, id),
  ]);
  const hostel = hostels.find((row) => row.id === id);
  if (!hostel) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/hostels/${id}`}
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← {hostel.name}
        </Link>
        <div className="mt-2">
          <PageHeader
            title={`Support view: ${hostel.name}`}
            description="Read-only. Nothing can be changed from here."
          />
        </div>
      </div>

      {!snapshot ? (
        <section className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
          <OpenSupportViewForm hostelId={id} />
        </section>
      ) : (
        <>
          <Alert tone="info">
            Opened for: {snapshot.reason}. Closes at {time.format(new Date(snapshot.expires_at))}.
            The owner can see that you looked and why.
          </Alert>

          <section aria-labelledby="support-fees">
            <h2 id="support-fees" className="mb-3 text-base font-semibold text-slate-900">
              Fees
            </h2>
            <p className="mb-3 text-sm text-slate-700">
              Outstanding {formatPaise(Number(snapshot.fees.outstanding))}, of which overdue{" "}
              {formatPaise(Number(snapshot.fees.overdue))}.
            </p>
            {snapshot.fees.recent.length > 0 && (
              <Table caption="Latest invoices">
                <THead>
                  <tr>
                    <Th>Month</Th>
                    <Th>Resident</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Paid</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {snapshot.fees.recent.map((invoice, index) => (
                    <Tr key={index}>
                      <Td>
                        {formatMonth(invoice.period_month, { short: true })}
                        {invoice.kind === "late_fee" && " late fee"}
                      </Td>
                      <Td>{invoice.resident_name}</Td>
                      <Td className="text-right tabular-nums">{formatPaise(invoice.amount)}</Td>
                      <Td className="text-right tabular-nums">{formatPaise(invoice.paid)}</Td>
                      <Td>{invoice.due_status ?? "—"}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="support-rooms">
            <h2 id="support-rooms" className="mb-3 text-base font-semibold text-slate-900">
              Rooms and beds
            </h2>
            {snapshot.rooms.length === 0 ? (
              <p className="text-sm text-slate-600">No rooms yet.</p>
            ) : (
              <Table caption="Rooms and beds">
                <THead>
                  <tr>
                    <Th>Room</Th>
                    <Th>Type</Th>
                    <Th>Beds</Th>
                  </tr>
                </THead>
                <TBody>
                  {snapshot.rooms.map((room) => (
                    <Tr key={room.room_number}>
                      <Td>
                        {room.room_number}
                        <span className="block text-xs text-slate-500">
                          Floor {room.floor}
                          {room.status !== "active" && ` · ${room.status}`}
                        </span>
                      </Td>
                      <Td>
                        {SHARING_TYPE_LABELS[room.sharing_type as SharingType] ?? room.sharing_type}
                      </Td>
                      <Td className="whitespace-normal">
                        {room.beds
                          .map((bed) => `${bed.label}: ${bed.occupant ?? bed.status}`)
                          .join(", ")}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          <section aria-labelledby="support-residents">
            <h2 id="support-residents" className="mb-3 text-base font-semibold text-slate-900">
              Residents
            </h2>
            {snapshot.residents.length === 0 ? (
              <p className="text-sm text-slate-600">No residents yet.</p>
            ) : (
              <>
                <Table caption="Residents">
                  <THead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Mobile</Th>
                      <Th>ID</Th>
                      <Th>Status</Th>
                      <Th>Joined</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {snapshot.residents.map((resident, index) => (
                      <Tr key={index}>
                        <Td>{resident.erased ? "Erased resident" : resident.full_name}</Td>
                        <Td>{resident.phone ?? "—"}</Td>
                        <Td>
                          {resident.id_proof_type} {resident.id_proof ?? ""}
                        </Td>
                        <Td>
                          <Badge tone="neutral">{resident.status}</Badge>
                        </Td>
                        <Td>{resident.joining_date}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {snapshot.residents_total > snapshot.residents.length && (
                  <p className="mt-2 text-xs text-slate-500">
                    Showing the first {snapshot.residents.length} of {snapshot.residents_total}.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
