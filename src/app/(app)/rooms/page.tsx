import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shell/PageHeader";
import {
  Alert,
  Badge,
  buttonClass,
  EmptyState,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from "@/components/ui";
import { RoomFilters } from "@/features/rooms/components/RoomFilters";
import { floorLabel, SHARING_TYPE_LABELS } from "@/features/rooms/options";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAllPages, isPastLastPage } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { SHARING_TYPES, type SharingType, type ViewRow } from "@/types";
import type { Database } from "@/types/database";

export const metadata: Metadata = { title: "Rooms & beds" };

const PAGE_SIZE = 25;

type InventoryRow = ViewRow<Database["public"]["Views"]["room_inventory"]["Row"]>;

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the filters from the URL, ignoring anything malformed. */
function parseFilters(params: SearchParams) {
  const floor = Number(single(params.floor));
  const sharing = single(params.sharing);
  const availability = single(params.availability);
  const page = Number(single(params.page));
  return {
    q: (single(params.q) ?? "").trim().toUpperCase().slice(0, 20),
    floor: Number.isInteger(floor) && floor >= 0 && single(params.floor) !== "" ? floor : null,
    sharing: (SHARING_TYPES as readonly string[]).includes(sharing ?? "")
      ? (sharing as SharingType)
      : null,
    availability: availability === "vacant" || availability === "full" ? availability : null,
    archived: single(params.status) === "archived",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Room inventory with filters and server-side pagination (E4-T6). */
export default async function RoomsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { user, hostel } = await requireActiveHostel();
  const params = await searchParams;
  const filters = parseFilters(params);
  const canEdit = user.role === "owner";

  const supabase = await createClient();
  let query = supabase
    .from("room_inventory")
    .select(
      "id, room_number, floor, sharing_type, total_beds, occupied_beds, available_beds, out_of_service_beds, capacity",
      {
        count: "exact",
      },
    )
    .eq("hostel_id", hostel.id)
    .eq("status", filters.archived ? "archived" : "active");
  if (filters.q) query = query.ilike("room_number", `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
  if (filters.floor !== null) query = query.eq("floor", filters.floor);
  if (filters.sharing) query = query.eq("sharing_type", filters.sharing);
  if (filters.availability === "vacant") query = query.gt("available_beds", 0);
  if (filters.availability === "full") query = query.eq("available_beds", 0);

  const from = (filters.page - 1) * PAGE_SIZE;
  const [{ data: rooms, count, error }, floorRows] = await Promise.all([
    query
      .order("floor")
      .order("room_sort")
      .range(from, from + PAGE_SIZE - 1),
    fetchAllPages((first, last) =>
      supabase
        .from("rooms")
        .select("floor")
        .eq("hostel_id", hostel.id)
        .order("id")
        .range(first, last),
    ),
  ]);
  if (error && !isPastLastPage(error)) throw error;

  const rows = (rooms ?? []) as InventoryRow[];
  const total = count ?? 0;
  const floors = [...new Set(floorRows.map((row) => row.floor))].sort((a, b) => a - b);
  const hasAnyRoom = floors.length > 0;
  const filtered =
    Boolean(filters.q) ||
    filters.floor !== null ||
    Boolean(filters.sharing) ||
    Boolean(filters.availability) ||
    filters.archived;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const text = single(value);
      if (text && !["page", "created", "archived", "deleted"].includes(key)) next.set(key, text);
    }
    if (page > 1) next.set("page", String(page));
    return next.size ? `/rooms?${next}` : "/rooms";
  };

  if (isPastLastPage(error)) redirect(pageHref(1));

  const created = single(params.created);
  const archived = single(params.archived);
  const deleted = single(params.deleted);

  return (
    <>
      <PageHeader
        title="Rooms & beds"
        description={`Room inventory for ${hostel.name}.`}
        actions={
          canEdit && (
            <>
              <Link href="/rooms/bulk" className={buttonClass({ variant: "secondary" })}>
                Add rooms in bulk
              </Link>
              <Link href="/rooms/new" className={buttonClass()}>
                Add room
              </Link>
            </>
          )
        }
      />

      {created && (
        <Alert tone="success" className="mb-4">
          Room {created} was created with its beds.
        </Alert>
      )}
      {archived && (
        <Alert tone="success" className="mb-4">
          Room {archived} was archived. Its history is kept.
        </Alert>
      )}
      {deleted && (
        <Alert tone="success" className="mb-4">
          Room {deleted} was deleted.
        </Alert>
      )}

      {!hasAnyRoom ? (
        <EmptyState
          title="No rooms yet"
          description={
            canEdit
              ? "Add your rooms one at a time, or create a whole floor at once with bulk generation."
              : "The hostel owner has not added any rooms yet."
          }
          action={
            canEdit && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href="/rooms/bulk" className={buttonClass()}>
                  Add rooms in bulk
                </Link>
                <Link href="/rooms/new" className={buttonClass({ variant: "secondary" })}>
                  Add one room
                </Link>
              </div>
            )
          }
        />
      ) : (
        <>
          <RoomFilters floors={floors} />

          {rows.length === 0 ? (
            <EmptyState
              title={filtered ? "No rooms match these filters" : "No rooms to show"}
              description={
                filters.archived ? "No rooms have been archived." : "Try a different filter."
              }
              action={
                filtered && (
                  <Link href="/rooms" className={buttonClass({ variant: "secondary" })}>
                    Clear filters
                  </Link>
                )
              }
            />
          ) : (
            <>
              <Table caption="Rooms">
                <THead>
                  <tr>
                    <Th>Room</Th>
                    <Th>Floor</Th>
                    <Th>Sharing</Th>
                    <Th className="text-right">Beds</Th>
                    {!filters.archived && (
                      <>
                        <Th className="text-right">Occupied</Th>
                        <Th className="text-right">Vacant</Th>
                      </>
                    )}
                  </tr>
                </THead>
                <TBody>
                  {rows.map((room) => (
                    <Tr key={room.id}>
                      <Td>
                        <Link
                          href={`/rooms/${room.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {room.room_number}
                        </Link>
                      </Td>
                      <Td>{floorLabel(room.floor)}</Td>
                      <Td>{SHARING_TYPE_LABELS[room.sharing_type as SharingType]}</Td>
                      <Td className="text-right">
                        {filters.archived ? room.capacity : room.total_beds}
                        {room.out_of_service_beds > 0 && (
                          <Badge tone="warning" className="ml-2">
                            {room.out_of_service_beds} out of service
                          </Badge>
                        )}
                      </Td>
                      {!filters.archived && (
                        <>
                          <Td className="text-right">{room.occupied_beds}</Td>
                          <Td className="text-right">{room.available_beds}</Td>
                        </>
                      )}
                    </Tr>
                  ))}
                </TBody>
              </Table>

              <nav
                aria-label="Pagination"
                className="mt-4 flex flex-col items-center justify-between gap-3 text-sm text-slate-600 sm:flex-row"
              >
                <p>
                  Showing {from + 1}–{from + rows.length} of {total}{" "}
                  {total === 1 ? "room" : "rooms"}
                </p>
                {lastPage > 1 && (
                  <div className="flex items-center gap-2">
                    {filters.page > 1 ? (
                      <Link
                        href={pageHref(filters.page - 1)}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Previous
                      </Link>
                    ) : null}
                    <span>
                      Page {filters.page} of {lastPage}
                    </span>
                    {filters.page < lastPage ? (
                      <Link
                        href={pageHref(filters.page + 1)}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Next
                      </Link>
                    ) : null}
                  </div>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </>
  );
}
