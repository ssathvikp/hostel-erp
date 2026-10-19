import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { getAdminOwners, OWNER_PAGE_SIZE, requirePlatformAdmin } from "@/features/admin/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Owners" };

const moment = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

type SearchParams = Record<string, string | string[] | undefined>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The customer directory (ClickUp E10-T4): every owner account, its state
 * and its hostels. Searched and paged in the database.
 */
export default async function AdminOwnersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const search = single(params.q)?.trim().slice(0, 100) || null;
  const pageNumber = Number(single(params.page));
  const page = Number.isInteger(pageNumber) && pageNumber > 1 ? pageNumber : 1;
  const { owners, total } = await getAdminOwners(await createClient(), { search, page });
  const lastPage = Math.max(1, Math.ceil(total / OWNER_PAGE_SIZE));
  const href = (nextPage: number) => {
    const query = new URLSearchParams();
    if (search) query.set("q", search);
    if (nextPage > 1) query.set("page", String(nextPage));
    return query.size ? `/admin/owners?${query}` : "/admin/owners";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Owners"
        description="Every owner account, with its sign-in state and hostels."
      />

      <form role="search" className="flex max-w-xl gap-2">
        <label htmlFor="owner-search" className="sr-only">
          Search owners
        </label>
        <input
          id="owner-search"
          name="q"
          type="search"
          defaultValue={search ?? ""}
          placeholder="Name, e-mail, phone, hostel or city"
          className="h-10 flex-1 rounded-md border border-slate-300 px-3 text-sm"
        />
        <button type="submit" className={buttonClass({ variant: "secondary" })}>
          Search
        </button>
      </form>

      {owners.length === 0 ? (
        <EmptyState
          title={search ? "No owners match" : "No owners yet"}
          description={search ? "Try part of a name, e-mail or hostel." : undefined}
        />
      ) : (
        <>
          <Table caption="Owners">
            <THead>
              <tr>
                <Th>Owner</Th>
                <Th>Account</Th>
                <Th className="text-right">Hostels</Th>
                <Th>Signed up</Th>
                <Th>Last sign-in</Th>
              </tr>
            </THead>
            <TBody>
              {owners.map((owner) => (
                <Tr key={owner.id}>
                  <Td>
                    <Link
                      href={`/admin/owners/${owner.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {owner.fullName}
                    </Link>
                    <span className="block text-xs text-slate-500">{owner.email}</span>
                  </Td>
                  <Td>
                    {owner.emailConfirmedAt ? (
                      <Badge tone="success">Confirmed</Badge>
                    ) : (
                      <Badge tone="warning">E-mail not confirmed</Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {owner.activeHostels}
                    {owner.draftHostels > 0 && (
                      <span className="block text-xs text-slate-500">
                        +{owner.draftHostels} being set up
                      </span>
                    )}
                  </Td>
                  <Td>{moment.format(new Date(owner.createdAt))}</Td>
                  <Td>
                    {owner.lastSignInAt ? moment.format(new Date(owner.lastSignInAt)) : "Never"}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between text-sm text-slate-600"
          >
            <span>
              {total} {total === 1 ? "owner" : "owners"}
            </span>
            <div className="flex items-center gap-3">
              {page > 1 && (
                <Link
                  href={href(page - 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Previous
                </Link>
              )}
              <span>
                Page {page} of {lastPage}
              </span>
              {page < lastPage && (
                <Link
                  href={href(page + 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Next
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
