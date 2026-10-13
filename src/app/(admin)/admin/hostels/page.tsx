import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import {
  HostelStatusBadge,
  Pager,
  pageFrom,
  queryFrom,
  SearchBar,
} from "@/features/admin/components/SearchBar";
import { getHostels } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { HOSTEL_STATUSES, type HostelStatus } from "@/types";

export const metadata: Metadata = { title: "Hostels" };

const at = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const PAGE_SIZE = 25;

/**
 * Every hostel with how much it is used (E10-T4). Hostels still in setup
 * are listed too, to follow up stalled sign-ups.
 */
export default async function HostelsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const q = queryFrom(params.q);
  const status = (HOSTEL_STATUSES as readonly string[]).includes(params.status ?? "")
    ? (params.status as HostelStatus)
    : null;
  const page = pageFrom(params.page);
  const supabase = await createClient();
  const { total, rows } = await getHostels(supabase, q, status, page);
  const href = (next: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    if (next > 1) query.set("page", String(next));
    return query.size ? `/admin/hostels?${query}` : "/admin/hostels";
  };

  return (
    <>
      <PageHeader title="Hostels" description={`${total} ${total === 1 ? "hostel" : "hostels"}.`} />
      <SearchBar
        action="/admin/hostels"
        q={q}
        placeholder="Hostel, city, phone or owner email"
        status={{ value: status ?? "" }}
      />
      {rows.length === 0 ? (
        <EmptyState title="No hostels match" />
      ) : (
        <>
          <Table caption="Hostels">
            <THead>
              <tr>
                <Th>Hostel</Th>
                <Th>Status</Th>
                <Th>City</Th>
                <Th className="text-right">Beds</Th>
                <Th className="text-right">Residents</Th>
                <Th className="text-right">Invoices this month</Th>
                <Th>Last activity</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((hostel) => (
                <Tr key={hostel.id}>
                  <Td className="whitespace-normal">
                    <Link
                      href={`/admin/hostels/${hostel.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {hostel.name}
                    </Link>
                    <Link
                      href={`/admin/customers/${hostel.owner_id}`}
                      className="block text-xs text-slate-500 hover:underline"
                    >
                      {hostel.owner_email}
                    </Link>
                  </Td>
                  <Td>
                    <HostelStatusBadge status={hostel.status} />
                  </Td>
                  <Td>{hostel.city ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{hostel.beds}</Td>
                  <Td className="text-right tabular-nums">{hostel.active_residents}</Td>
                  <Td className="text-right tabular-nums">{hostel.invoices_this_month}</Td>
                  <Td>{hostel.last_activity ? at.format(new Date(hostel.last_activity)) : "—"}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pager page={page} total={total} size={PAGE_SIZE} href={href} />
        </>
      )}
    </>
  );
}
