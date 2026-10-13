import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shell/PageHeader";
import { Alert, Badge, EmptyState, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { PriorityBadge } from "@/features/complaints/components/ComplaintTable";
import {
  RunDueButton,
  ScheduleActiveToggle,
  ScheduleDialog,
} from "@/features/complaints/components/ScheduleForms";
import { everyLabel } from "@/features/complaints/options";
import { getCategories } from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAllPages } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/validation";
import type { ComplaintPriority, MaintenanceUnit } from "@/types";

export const metadata: Metadata = { title: "Preventive maintenance" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

/**
 * Recurring preventive maintenance (E15-T12): water tanks, pest control, fire
 * extinguishers. Each task becomes a scheduled job when it falls due.
 */
export default async function MaintenancePage() {
  const { user, hostel } = await requireActiveHostel();
  const supabase = await createClient();
  const [categories, rooms, { data: schedules, error }] = await Promise.all([
    getCategories(supabase, hostel.id),
    fetchAllPages((first, last) =>
      supabase
        .from("room_inventory")
        .select("id, room_number")
        .eq("hostel_id", hostel.id)
        .eq("status", "active")
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(first, last),
    ),
    supabase
      .from("maintenance_schedules")
      .select(
        "id, title, description, category_id, room_id, area, every, unit, next_due, priority, active, complaint_categories(name), rooms(room_number)",
      )
      .eq("hostel_id", hostel.id)
      .order("active", { ascending: false })
      .order("next_due"),
  ]);
  if (error) throw error;

  const isOwner = user.role === "owner";
  const today = todayIst();
  const rows = schedules ?? [];
  const categoryOptions = categories
    .filter((category) => category.active)
    .map((category) => ({ value: category.id, label: category.name }));
  const roomOptions = rooms.map((room) => ({
    value: room.id ?? "",
    label: `Room ${room.room_number}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/complaints" className="text-sm font-medium text-brand-700 hover:underline">
          ← All complaints
        </Link>
        <div className="mt-2">
          <PageHeader
            title="Preventive maintenance"
            description="Work that comes round on a schedule. Each task becomes a job on its due date and goes to the right worker."
            actions={isOwner && <ScheduleDialog categories={categoryOptions} rooms={roomOptions} />}
          />
        </div>
      </div>

      {!isOwner && <Alert tone="info">Only the owner can change the schedule.</Alert>}

      {rows.length === 0 ? (
        <EmptyState
          title="No recurring tasks"
          description="Add tank cleaning, pest control, fire extinguisher checks and AC servicing so they happen before anyone has to complain."
        />
      ) : (
        <>
          <Table caption="Recurring maintenance tasks">
            <THead>
              <tr>
                <Th>Task</Th>
                <Th>Where</Th>
                <Th>How often</Th>
                <Th>Next due</Th>
                <Th>Priority</Th>
                {isOwner && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </THead>
            <TBody>
              {rows.map((row) => (
                <Tr key={row.id} className={row.active ? undefined : "text-slate-400"}>
                  <Td className="whitespace-normal">
                    <span className="font-medium">{row.title}</span>
                    <span className="block text-xs text-slate-500">
                      {row.complaint_categories?.name}
                    </span>
                    {!row.active && <Badge>Paused</Badge>}
                  </Td>
                  <Td>{row.rooms ? `Room ${row.rooms.room_number}` : row.area}</Td>
                  <Td>{everyLabel(row.every, row.unit as MaintenanceUnit)}</Td>
                  <Td>
                    {day.format(new Date(row.next_due))}
                    {row.active && row.next_due <= today && (
                      <span className="ml-2">
                        <Badge tone="warning">Due</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <PriorityBadge priority={row.priority as ComplaintPriority} />
                  </Td>
                  {isOwner && (
                    <Td className="space-x-1 text-right">
                      <ScheduleDialog
                        schedule={{
                          id: row.id,
                          title: row.title,
                          description: row.description,
                          categoryId: row.category_id,
                          roomId: row.room_id,
                          area: row.area,
                          every: row.every,
                          unit: row.unit,
                          nextDue: row.next_due,
                          priority: row.priority,
                        }}
                        categories={categoryOptions}
                        rooms={roomOptions}
                      />
                      <ScheduleActiveToggle id={row.id} title={row.title} active={row.active} />
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
          {isOwner && (
            <div className="space-y-1">
              <RunDueButton />
              <p className="text-xs text-slate-500">
                Due tasks are also created automatically every morning.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
