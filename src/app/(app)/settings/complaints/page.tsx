import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Alert, Badge } from "@/components/ui";
import { setCategoryActive, setScheduleActive } from "@/features/complaints/actions";
import { InlineAction } from "@/features/complaints/components/ComplaintActions";
import {
  CategoryForm,
  ComplaintSettingsForm,
  ScheduleForm,
  TargetsForm,
} from "@/features/complaints/components/SetupForms";
import { PRIORITY_LABELS, TRADE_LABELS } from "@/features/complaints/options";
import {
  getCategories,
  getComplaintSettings,
  getSchedules,
  getTargets,
} from "@/features/complaints/queries";
import { requireActiveHostel } from "@/lib/hostels/active";
import { fetchAll } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Complaint settings" };

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });
const UNIT = { day: "day", week: "week", month: "month" } as const;

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="min-w-0 space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs sm:p-6"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** How complaints work in this hostel (ClickUp EP-15 T1, T8, T10, T12). Owners only. */
export default async function ComplaintSettingsPage() {
  const { user, hostel } = await requireActiveHostel();
  if (user.role !== "owner") {
    return <Alert tone="info">Only the hostel owner can change complaint settings.</Alert>;
  }
  const supabase = await createClient();
  const [categories, targets, settings, schedules, rooms] = await Promise.all([
    getCategories(supabase, hostel.id),
    getTargets(supabase, hostel.id),
    getComplaintSettings(supabase, hostel.id),
    getSchedules(supabase, hostel.id),
    fetchAll((from, to) =>
      supabase
        .from("room_inventory")
        .select("id, room_number")
        .eq("hostel_id", hostel.id)
        .eq("status", "active")
        .order("floor")
        .order("room_sort")
        .order("id")
        .range(from, to),
    ),
  ]);
  const active = categories.filter((category) => category.active);

  return (
    <div className="max-w-4xl space-y-6">
      <Section
        id="categories"
        title="Categories"
        description="What complaints are about, and which trade each goes to."
      >
        <ul className="divide-y divide-slate-200">
          {categories.map((category) => (
            <li key={category.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-900">
                  <span className="font-medium">{category.name}</span> →{" "}
                  {TRADE_LABELS[category.trade]}
                  {!category.autoRoute && (
                    <span className="text-slate-500"> · assigned by hand</span>
                  )}{" "}
                  {!category.active && <Badge>Hidden</Badge>}
                </p>
                <InlineAction
                  action={setCategoryActive}
                  fields={{ category_id: category.id, active: String(!category.active) }}
                  label={category.active ? "Hide" : "Show"}
                  ariaLabel={`${category.active ? "Hide" : "Show"} ${category.name}`}
                />
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-brand-700">Edit</summary>
                <div className="mt-3">
                  <CategoryForm category={category} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-200 pt-4">
          <CategoryForm />
        </div>
      </Section>

      <Section
        id="targets"
        title="Response and fix targets"
        description="How fast complaints should be answered and fixed. Late ones are flagged in the list and on the dashboard. Time on hold does not count."
      >
        <TargetsForm targets={targets} />
      </Section>

      <Section
        id="job-links"
        title="Job links"
        description="What outside workers see when they open a job link."
      >
        <ComplaintSettingsForm shareResidentPhone={settings.shareResidentPhone} />
      </Section>

      <Section
        id="maintenance"
        title="Preventive maintenance"
        description="Recurring jobs, like cleaning the water tank. Each becomes a complaint when it is due and is assigned like any other."
      >
        {schedules.length > 0 && (
          <ul className="divide-y divide-slate-200">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <p>
                  <span className="font-medium text-slate-900">{schedule.title}</span>
                  <span className="block text-slate-600">
                    {schedule.where} · {schedule.categoryName} ·{" "}
                    {PRIORITY_LABELS[schedule.priority]} · every{" "}
                    {schedule.everyN === 1
                      ? UNIT[schedule.unit]
                      : `${schedule.everyN} ${UNIT[schedule.unit]}s`}{" "}
                    · next {day.format(new Date(schedule.nextDue))}
                  </span>
                  {!schedule.active && <Badge>Paused</Badge>}
                </p>
                <InlineAction
                  action={setScheduleActive}
                  fields={{ schedule_id: schedule.id, active: String(!schedule.active) }}
                  label={schedule.active ? "Pause" : "Resume"}
                  ariaLabel={`${schedule.active ? "Pause" : "Resume"} ${schedule.title}`}
                />
              </li>
            ))}
          </ul>
        )}
        <ScheduleForm
          categories={active}
          rooms={rooms.map((room) => ({ id: room.id!, label: `Room ${room.room_number}` }))}
        />
      </Section>
    </div>
  );
}
