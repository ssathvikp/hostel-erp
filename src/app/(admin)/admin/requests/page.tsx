import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { CompleteClosureButton } from "@/features/admin/components/AdminForms";
import { Pager, pageFrom } from "@/features/admin/components/SearchBar";
import type { Paged } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";

export const metadata: Metadata = { title: "Data requests" };

const at = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const PAGE_SIZE = 50;

interface RequestRow {
  id: string;
  kind: "export" | "erasure" | "account_closure";
  status: "done" | "scheduled" | "cancelled";
  reason: string | null;
  created_at: string;
  scheduled_for: string | null;
  completed_at: string | null;
  owner_id: string;
  owner_email: string;
  hostel_name: string | null;
}

const KIND_LABELS: Record<RequestRow["kind"], string> = {
  export: "Data export",
  erasure: "Resident erased",
  account_closure: "Account closure",
};

/**
 * Data protection requests (E10-T10): exports and erasures owners did
 * themselves, and account closures waiting for their date. Closures are
 * carried out by an operator following docs/data-protection.md.
 */
export default async function DataRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePlatformAdmin();
  const page = pageFrom((await searchParams).page);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_data_requests", { p_page: page });
  if (error) throw error;
  const { total, rows } = data as unknown as Paged<RequestRow>;
  const today = todayIst();

  return (
    <>
      <PageHeader
        title="Data requests"
        description="Exports, erasures and account closures under the DPDP Act 2023."
      />
      {rows.length === 0 ? (
        <EmptyState title="No requests yet" />
      ) : (
        <>
          <Table caption="Data protection requests">
            <THead>
              <tr>
                <Th>Requested</Th>
                <Th>Request</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>{at.format(new Date(row.created_at))}</Td>
                  <Td>
                    {KIND_LABELS[row.kind]}
                    {row.hostel_name && (
                      <span className="block text-xs text-slate-500">{row.hostel_name}</span>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/customers/${row.owner_id}`}
                      className="text-brand-700 hover:underline"
                    >
                      {row.owner_email}
                    </Link>
                  </Td>
                  <Td>
                    {row.status === "scheduled" ? (
                      <Badge tone={row.scheduled_for! <= today ? "danger" : "warning"}>
                        {row.scheduled_for! <= today ? "Due " : "Scheduled "}
                        {day.format(new Date(row.scheduled_for!))}
                      </Badge>
                    ) : row.status === "done" ? (
                      <Badge tone="success">Done</Badge>
                    ) : (
                      <Badge>Cancelled</Badge>
                    )}
                  </Td>
                  <Td className="whitespace-normal text-slate-600">{row.reason ?? "—"}</Td>
                  <Td className="text-right">
                    {row.kind === "account_closure" && row.status === "scheduled" && (
                      <CompleteClosureButton requestId={row.id} />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pager
            page={page}
            total={total}
            size={PAGE_SIZE}
            href={(next) => (next > 1 ? `/admin/requests?page=${next}` : "/admin/requests")}
          />
        </>
      )}
    </>
  );
}
