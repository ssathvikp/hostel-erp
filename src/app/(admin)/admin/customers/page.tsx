import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { getAccountsBilling } from "@/features/admin/billing-queries";
import { Pager, pageFrom, queryFrom, SearchBar } from "@/features/admin/components/SearchBar";
import { STATUS_LABELS, STATUS_TONES } from "@/features/billing/options";
import { getOwners } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Owners" };

const at = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const PAGE_SIZE = 25;

/** Every owner account (E10-T4) with its plan and subscription (E10-T7). */
export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const q = queryFrom(params.q);
  const page = pageFrom(params.page);
  const supabase = await createClient();
  const { total, rows } = await getOwners(supabase, q, page);
  const billing = await getAccountsBilling(
    supabase,
    rows.map((row) => row.id),
  );
  const href = (next: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (next > 1) query.set("page", String(next));
    return query.size ? `/admin/customers?${query}` : "/admin/customers";
  };

  return (
    <>
      <PageHeader
        title="Owners"
        description={`${total} owner ${total === 1 ? "account" : "accounts"}.`}
      />
      <SearchBar action="/admin/customers" q={q} placeholder="Email, name, hostel, city or phone" />
      {rows.length === 0 ? (
        <EmptyState title="No owners match" />
      ) : (
        <>
          <Table caption="Owner accounts">
            <THead>
              <tr>
                <Th>Owner</Th>
                <Th>Signed up</Th>
                <Th>Email</Th>
                <Th>Last sign-in</Th>
                <Th>Plan</Th>
                <Th>Trial ends / next billing</Th>
                <Th className="text-right">Hostels</Th>
              </tr>
            </THead>
            <TBody>
              {rows.map((owner) => (
                <Tr key={owner.id}>
                  <Td>
                    <Link
                      href={`/admin/customers/${owner.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {owner.full_name}
                    </Link>
                    <span className="block text-xs text-slate-500">{owner.email}</span>
                  </Td>
                  <Td>{at.format(new Date(owner.created_at))}</Td>
                  <Td>
                    {owner.email_confirmed_at ? (
                      <Badge tone="success">Confirmed</Badge>
                    ) : (
                      <Badge tone="warning">Not confirmed</Badge>
                    )}
                  </Td>
                  <Td>
                    {owner.last_sign_in_at ? at.format(new Date(owner.last_sign_in_at)) : "Never"}
                  </Td>
                  <Td>
                    {billing[owner.id] ? (
                      <>
                        {billing[owner.id].plan_name}{" "}
                        <Badge tone={STATUS_TONES[billing[owner.id].status]}>
                          {STATUS_LABELS[billing[owner.id].status]}
                        </Badge>
                      </>
                    ) : (
                      <span className="text-slate-500">No hostel yet</span>
                    )}
                  </Td>
                  <Td>
                    {(() => {
                      const b = billing[owner.id];
                      const date = b?.status === "trialing" ? b.trial_ends_at : b?.next_billing_at;
                      return date ? at.format(new Date(date)) : "—";
                    })()}
                  </Td>
                  <Td className="text-right tabular-nums">{owner.hostels}</Td>
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
