import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Button, EmptyState, Input, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { Pager, pageFrom, queryFrom } from "@/features/admin/components/SearchBar";
import { AUDIT_ACTION_LABELS, type AuditRow, type Paged } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Audit log" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Kolkata",
});
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 50;

/** Every admin look and change, searchable by hostel, admin and date (E10-T3). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    admin?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const hostel =
    params.hostel && uuid("Hostel").safeParse(params.hostel).success ? params.hostel : null;
  const actor = queryFrom(params.admin);
  const from = params.from && ISO_DATE.test(params.from) ? params.from : null;
  const to = params.to && ISO_DATE.test(params.to) ? params.to : null;
  const page = pageFrom(params.page);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_audit_search", {
    p_hostel_id: hostel ?? undefined,
    p_actor: actor || undefined,
    p_from: from ?? undefined,
    p_to: to ?? undefined,
    p_page: page,
  });
  if (error) throw error;
  const { total, rows } = data as unknown as Paged<AuditRow>;
  const href = (next: number) => {
    const query = new URLSearchParams();
    if (hostel) query.set("hostel", hostel);
    if (actor) query.set("admin", actor);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (next > 1) query.set("page", String(next));
    return query.size ? `/admin/audit?${query}` : "/admin/audit";
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every admin view of customer data and every admin change. Entries cannot be edited or deleted."
      />
      <form
        action="/admin/audit"
        method="get"
        role="search"
        className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4 sm:items-end"
      >
        {hostel && <input type="hidden" name="hostel" value={hostel} />}
        <Input id="admin" name="admin" label="Admin email" defaultValue={actor} />
        <Input id="from" name="from" type="date" label="From" defaultValue={from ?? ""} />
        <Input id="to" name="to" type="date" label="To" defaultValue={to ?? ""} />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {hostel && (
        <p className="mb-3 text-sm text-slate-600">
          One hostel only.{" "}
          <Link href="/admin/audit" className="text-brand-700 hover:underline">
            Show every hostel
          </Link>
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No entries match" />
      ) : (
        <>
          <Table caption="Admin audit log">
            <THead>
              <tr>
                <Th>When</Th>
                <Th>Admin</Th>
                <Th>Action</Th>
                <Th>About</Th>
                <Th>Reason</Th>
                <Th>Request</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>{at.format(new Date(row.created_at))}</Td>
                  <Td>{row.actor_email}</Td>
                  <Td>{AUDIT_ACTION_LABELS[row.action] ?? row.action}</Td>
                  <Td className="whitespace-normal">
                    {row.hostel_id ? (
                      <Link
                        href={`/admin/audit?hostel=${row.hostel_id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {row.hostel_name ?? "Deleted hostel"}
                      </Link>
                    ) : (
                      (row.account_email ??
                      (typeof row.details.message === "string" ? row.details.message : "—"))
                    )}
                  </Td>
                  <Td className="whitespace-normal text-slate-600">{row.reason ?? "—"}</Td>
                  <Td className="font-mono text-xs text-slate-500">
                    {row.request_id?.slice(0, 8) ?? "—"}
                  </Td>
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
