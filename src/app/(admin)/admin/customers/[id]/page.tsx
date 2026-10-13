import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { SupportActionButton } from "@/features/admin/components/AdminForms";
import { HostelStatusBadge } from "@/features/admin/components/SearchBar";
import { AUDIT_ACTION_LABELS, getAccount } from "@/features/admin/queries";
import { requirePlatformAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Owner" };

const at = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

/**
 * One owner account (E10-T4, E10-T9): who they are, their hostels, support
 * actions that never touch a password, and what admins have done for them.
 * Opening this page is itself recorded.
 */
export default async function OwnerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  if (!uuid("Account").safeParse(id).success) notFound();
  const supabase = await createClient();
  const account = await getAccount(supabase, id);
  if (!account) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          ← All owners
        </Link>
        <div className="mt-2">
          <PageHeader title={account.full_name} description={account.email} />
        </div>
      </div>

      <dl className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Signed up</dt>
          <dd>{at.format(new Date(account.created_at))}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Email</dt>
          <dd>
            {account.email_confirmed_at ? (
              <Badge tone="success">Confirmed</Badge>
            ) : (
              <Badge tone="warning">Not confirmed</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Last sign-in</dt>
          <dd>
            {account.last_sign_in_at ? at.format(new Date(account.last_sign_in_at)) : "Never"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Signed-in devices</dt>
          <dd className="tabular-nums">{account.sessions}</dd>
        </div>
      </dl>

      <section aria-labelledby="support-heading" className="space-y-3">
        <h2 id="support-heading" className="text-base font-semibold text-slate-900">
          Support
        </h2>
        <div className="flex flex-wrap items-start gap-3">
          {!account.email_confirmed_at && (
            <SupportActionButton accountId={account.id} action="resend_confirmation" />
          )}
          <SupportActionButton accountId={account.id} action="password_reset" />
          <SupportActionButton accountId={account.id} action="sign_out_everywhere" />
        </div>
        <p className="text-xs text-slate-500">
          To change an owner&apos;s email address, they change it themselves; Supabase confirms both
          the old and the new address.
        </p>
      </section>

      <section aria-labelledby="hostels-heading" className="space-y-3">
        <h2 id="hostels-heading" className="text-base font-semibold text-slate-900">
          Hostels
        </h2>
        {account.hostels.length === 0 ? (
          <p className="text-sm text-slate-600">
            No hostel yet: the sign-up stalled before onboarding.
          </p>
        ) : (
          <Table caption="The owner's hostels">
            <THead>
              <tr>
                <Th>Hostel</Th>
                <Th>Status</Th>
                <Th>City</Th>
                <Th>Created</Th>
              </tr>
            </THead>
            <TBody>
              {account.hostels.map((hostel) => (
                <Tr key={hostel.id}>
                  <Td>
                    <Link
                      href={`/admin/hostels/${hostel.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {hostel.name}
                    </Link>
                  </Td>
                  <Td>
                    <HostelStatusBadge status={hostel.status} />
                  </Td>
                  <Td>{hostel.city ?? "—"}</Td>
                  <Td>{at.format(new Date(hostel.created_at))}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <h2 id="activity-heading" className="text-base font-semibold text-slate-900">
          Admin activity
        </h2>
        {account.activity.length === 0 ? (
          <p className="text-sm text-slate-600">No admin has acted on this account.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {account.activity.map((row, i) => (
              <li key={i} className="px-4 py-2">
                <span className="font-medium">{AUDIT_ACTION_LABELS[row.action] ?? row.action}</span>
                {row.hostel_name && ` · ${row.hostel_name}`}
                {row.reason && <span className="text-slate-600"> · {row.reason}</span>}
                <span className="block text-xs text-slate-500">
                  {row.actor_email}, {at.format(new Date(row.created_at))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
