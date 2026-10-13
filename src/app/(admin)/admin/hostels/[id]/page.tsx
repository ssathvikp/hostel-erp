import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { OpenSupportViewForm, SuspendButton } from "@/features/admin/components/AdminForms";
import { HostelStatusBadge } from "@/features/admin/components/SearchBar";
import type { SupportView } from "@/features/admin/queries";
import { supportCookie } from "@/features/admin/support-cookie";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { formatMonth, formatPaise } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Hostel" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold text-slate-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A hostel as its owner sees it, read-only (E10-T5), and suspension
 * (E10-T6). Nothing here can change the hostel's records. The data is shown
 * only after the admin gives a reason; every load is logged with it and the
 * owner sees the visit in their settings.
 */
export default async function AdminHostelPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Hostel").safeParse(id).success) notFound();

  const reason = (await cookies()).get(supportCookie(id))?.value;
  const supabase = await createClient();

  if (!reason) {
    // Nothing about the hostel is read until a reason is given.
    return (
      <div className="space-y-6">
        <Link href="/admin/hostels" className="text-sm font-medium text-brand-700 hover:underline">
          ← All hostels
        </Link>
        <PageHeader
          title="Open a hostel for support"
          description="You will see its rooms, residents, occupancy and fees exactly as the owner does, without being able to change anything."
        />
        <OpenSupportViewForm hostelId={id} />
      </div>
    );
  }

  const { data, error } = await supabase.rpc("admin_view_hostel", {
    p_hostel_id: id,
    p_reason: reason,
  });
  if (error?.hint === "hostel_not_found") notFound();
  if (error) throw error;
  const view = data as unknown as SupportView;
  const { hostel } = view;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/hostels" className="text-sm font-medium text-brand-700 hover:underline">
          ← All hostels
        </Link>
        <div className="mt-2">
          <PageHeader
            title={hostel.name}
            description={
              <>
                {hostel.address} ·{" "}
                <Link
                  href={`/admin/customers/${hostel.owner_id}`}
                  className="text-brand-700 hover:underline"
                >
                  {hostel.owner_email}
                </Link>
              </>
            }
            actions={<SuspendButton hostelId={hostel.id} status={hostel.status} />}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <HostelStatusBadge status={hostel.status} />
          {hostel.phone && <span className="text-sm text-slate-600">{hostel.phone}</span>}
        </div>
        <Alert tone="info" className="mt-4" title="Read-only support view">
          Reason recorded: {reason}. The owner can see this visit. ID proof files are never shown
          here.
        </Alert>
      </div>

      <Section title="Occupancy">
        <p className="text-sm text-slate-700">
          {view.occupancy.occupied} of {view.occupancy.beds} beds occupied,{" "}
          {view.occupancy.available} available, {view.occupancy.out_of_service} out of service.
        </p>
      </Section>

      <Section title="Rooms">
        {view.rooms.length === 0 ? (
          <p className="text-sm text-slate-600">No rooms yet.</p>
        ) : (
          <Table caption="Rooms">
            <THead>
              <tr>
                <Th>Room</Th>
                <Th>Floor</Th>
                <Th>Sharing</Th>
                <Th className="text-right">Beds</Th>
                <Th className="text-right">Occupied</Th>
                <Th className="text-right">Available</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {view.rooms.map((room) => (
                <Tr key={room.room_number}>
                  <Td className="font-medium">{room.room_number}</Td>
                  <Td>{room.floor}</Td>
                  <Td>{room.sharing_type.replace("_", " ")}</Td>
                  <Td className="text-right tabular-nums">{room.total_beds}</Td>
                  <Td className="text-right tabular-nums">{room.occupied_beds}</Td>
                  <Td className="text-right tabular-nums">{room.available_beds}</Td>
                  <Td>{room.status}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Residents">
        {view.residents.length === 0 ? (
          <p className="text-sm text-slate-600">No residents yet.</p>
        ) : (
          <Table caption="Residents">
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Bed</Th>
                <Th>Status</Th>
                <Th>ID proof</Th>
              </tr>
            </THead>
            <TBody>
              {view.residents.map((resident) => (
                <Tr key={`${resident.full_name}-${resident.phone}`}>
                  <Td>{resident.full_name}</Td>
                  <Td>{resident.phone}</Td>
                  <Td>{resident.bed_label ?? "—"}</Td>
                  <Td>{resident.status}</Td>
                  <Td className="text-slate-600">{resident.id_proof}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      <Section title="Fees">
        <p className="text-sm text-slate-700">
          {formatMonth(view.fees.month)}: {formatPaise(view.fees.invoiced)} invoiced,{" "}
          {formatPaise(view.fees.collected)} collected.
        </p>
        {view.fees.invoices.length > 0 && (
          <Table caption="Latest invoices">
            <THead>
              <tr>
                <Th>Resident</Th>
                <Th>Month</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {view.fees.invoices.map((invoice, i) => (
                <Tr key={i}>
                  <Td>{invoice.resident_name}</Td>
                  <Td>{formatMonth(invoice.period_month, { short: true })}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(invoice.amount)}</Td>
                  <Td className="text-right tabular-nums">{formatPaise(invoice.balance)}</Td>
                  <Td>{invoice.status}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
