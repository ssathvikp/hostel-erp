import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, buttonClass, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { ResidentFilters } from "@/features/residents/components/ResidentFilters";
import { RESIDENT_STATUS_LABELS, RESIDENT_STATUS_TONES } from "@/features/residents/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";
import { RESIDENT_STATUSES, type ResidentStatus } from "@/types";

export const metadata: Metadata = { title: "Residents" };

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Search text for PostgREST's or() filter. Characters with meaning in that
 * syntax (commas, parentheses, quotes, backslashes) and LIKE wildcards are
 * dropped, so a search can never change the shape of the query.
 */
function searchText(raw: string | undefined): string {
  return (raw ?? "")
    .replace(/[,()"\\%_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function parseFilters(params: SearchParams) {
  const status = single(params.status);
  const room = single(params.room);
  const page = Number(single(params.page));
  return {
    q: searchText(single(params.q)),
    status:
      status === "all" || (RESIDENT_STATUSES as readonly string[]).includes(status ?? "")
        ? (status as ResidentStatus | "all")
        : ("current" as const),
    room: room && uuid("Room").safeParse(room).success ? room : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

const joined = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/** Resident search and filters with server-side pagination (E5-T4). */
export default async function ResidentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { hostel } = await requireActiveHostel();
  const params = await searchParams;
  const filters = parseFilters(params);
  const supabase = await createClient();

  let query = supabase
    .from("resident_directory")
    .select("id, full_name, phone, status, joining_date, room_number, bed_label", {
      count: "exact",
    })
    .eq("hostel_id", hostel.id);
  if (filters.status === "current") query = query.in("status", ["active", "notice"]);
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.room) query = query.eq("room_id", filters.room);
  if (filters.q) {
    const digits = filters.q.replace(/\D/g, "");
    const clauses = [
      `full_name.ilike."%${filters.q}%"`,
      `room_number.ilike."%${filters.q.toUpperCase()}%"`,
    ];
    if (digits.length >= 3) clauses.push(`phone.like."%${digits}%"`);
    query = query.or(clauses.join(","));
  }

  const from = (filters.page - 1) * PAGE_SIZE;
  const [
    { data: residents, count, error },
    { data: rooms, error: roomsError },
    { count: anyCount },
  ] = await Promise.all([
    query
      .order("full_name")
      .order("id")
      .range(from, from + PAGE_SIZE - 1),
    supabase
      .from("room_inventory")
      .select("id, room_number")
      .eq("hostel_id", hostel.id)
      .eq("status", "active")
      .order("floor")
      .order("room_sort"),
    supabase
      .from("residents")
      .select("id", { count: "exact", head: true })
      .eq("hostel_id", hostel.id),
  ]);
  if (error) throw error;
  if (roomsError) throw roomsError;

  const rows = residents ?? [];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const roomOptions = (rooms ?? []).map((room) => ({
    value: room.id ?? "",
    label: `Room ${room.room_number}`,
  }));

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = single(value);
      if (text && key !== "page") next.set(key, text);
    }
    if (page > 1) next.set("page", String(page));
    return next.size ? `/residents?${next}` : "/residents";
  };

  return (
    <>
      <PageHeader
        title="Residents"
        description={`People staying at ${hostel.name}.`}
        actions={
          <Link href="/residents/new" className={buttonClass()}>
            Register resident
          </Link>
        }
      />

      {(anyCount ?? 0) === 0 ? (
        <EmptyState
          title="No residents yet"
          description="Register residents as they join. Each one gets a profile with their contact details, ID proof and stay history."
          action={
            <Link href="/residents/new" className={buttonClass()}>
              Register the first resident
            </Link>
          }
        />
      ) : (
        <>
          <ResidentFilters rooms={roomOptions} />
          <p className="mb-3 text-sm text-slate-600" role="status">
            {total === 0
              ? "No residents match."
              : `${total} ${total === 1 ? "resident" : "residents"} found`}
          </p>

          {rows.length === 0 ? (
            <EmptyState
              title="No residents match"
              description="Try another name, phone number or room, or show all statuses."
              action={
                <Link href="/residents" className={buttonClass({ variant: "secondary" })}>
                  Clear search
                </Link>
              }
            />
          ) : (
            <>
              <Table caption="Residents">
                <THead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Phone</Th>
                    <Th>Room and bed</Th>
                    <Th>Status</Th>
                    <Th>Joined</Th>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((resident) => (
                    <Tr key={resident.id}>
                      <Td>
                        <Link
                          href={`/residents/${resident.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {resident.full_name}
                        </Link>
                      </Td>
                      <Td>{resident.phone}</Td>
                      <Td className={resident.bed_label ? undefined : "text-slate-500"}>
                        {resident.bed_label ?? "Not allocated"}
                      </Td>
                      <Td>
                        <Badge tone={RESIDENT_STATUS_TONES[resident.status as ResidentStatus]}>
                          {RESIDENT_STATUS_LABELS[resident.status as ResidentStatus]}
                        </Badge>
                      </Td>
                      <Td className="text-slate-600">
                        {resident.joining_date
                          ? joined.format(new Date(resident.joining_date))
                          : "—"}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              {lastPage > 1 && (
                <nav
                  aria-label="Pagination"
                  className="mt-4 flex items-center justify-end gap-2 text-sm text-slate-600"
                >
                  {filters.page > 1 && (
                    <Link
                      href={pageHref(filters.page - 1)}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Previous
                    </Link>
                  )}
                  <span>
                    Page {filters.page} of {lastPage}
                  </span>
                  {filters.page < lastPage && (
                    <Link
                      href={pageHref(filters.page + 1)}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      Next
                    </Link>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
