"use client";

import { useActionState, useState } from "react";

import { HostelField } from "@/components/shell/ActiveHostel";
import { Alert, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { initialFormState, type FormState } from "@/lib/validation/result";

import { saveCategory, saveComplaintSettings, saveSchedule, saveTargets } from "../actions";
import {
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  SCHEDULE_UNIT_OPTIONS,
  TRADE_OPTIONS,
} from "../options";
import type { Category, Target } from "../queries";

function Status({ state }: { state: FormState }) {
  if (state.formError) return <Alert tone="error">{state.formError}</Alert>;
  if (state.status === "success" && state.message) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return null;
}

/** Adds a category, or edits one (ClickUp EP-15 T1). */
export function CategoryForm({ category }: { category?: Category }) {
  const [state, action, pending] = useActionState(saveCategory, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const prefix = category ? `category-${category.id}` : "category-new";
  const fresh = !category && state.status === "success";
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      {category && <input type="hidden" name="category_id" value={category.id} />}
      <Status state={state} />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <Input
          id={`${prefix}-name`}
          name="name"
          label="Name"
          required
          defaultValue={fresh ? "" : (values.name ?? category?.name ?? "")}
          error={state.fieldErrors.name?.[0]}
        />
        <Select
          id={`${prefix}-trade`}
          name="trade"
          label="Goes to"
          options={TRADE_OPTIONS}
          defaultValue={values.trade ?? category?.trade ?? "general"}
          error={state.fieldErrors.trade?.[0]}
        />
      </div>
      <Checkbox
        id={`${prefix}-auto`}
        name="auto_route"
        label="Assign a worker automatically"
        defaultChecked={
          state.status === "error" ? values.auto_route === "on" : (category?.autoRoute ?? true)
        }
      />
      <Button
        type="submit"
        size="sm"
        variant={category ? "secondary" : "primary"}
        loading={pending}
      >
        {category ? "Save" : "Add category"}
      </Button>
    </form>
  );
}

/** Response and fix targets per priority, in hours (ClickUp EP-15 T10). */
export function TargetsForm({ targets }: { targets: readonly Target[] }) {
  const [state, action, pending] = useActionState(saveTargets, initialFormState);
  const values = state.values ?? {};
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <Status state={state} />
      <div className="space-y-3">
        {targets.map((target) => (
          <div
            key={target.priority}
            className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr] sm:items-end"
          >
            <p className="text-sm font-medium text-slate-800">{PRIORITY_LABELS[target.priority]}</p>
            <Input
              id={`respond-${target.priority}`}
              name={`respond_${target.priority}`}
              label="Respond within (hours)"
              inputMode="numeric"
              defaultValue={
                values[`respond_${target.priority}`] ??
                String(Math.round(target.respondMinutes / 60))
              }
              error={state.fieldErrors[`respond_${target.priority}`]?.[0]}
            />
            <Input
              id={`resolve-${target.priority}`}
              name={`resolve_${target.priority}`}
              label="Fix within (hours)"
              inputMode="numeric"
              defaultValue={
                values[`resolve_${target.priority}`] ??
                String(Math.round(target.resolveMinutes / 60))
              }
              error={state.fieldErrors[`resolve_${target.priority}`]?.[0]}
            />
          </div>
        ))}
      </div>
      <Button type="submit" loading={pending}>
        Save targets
      </Button>
    </form>
  );
}

export function ComplaintSettingsForm({ shareResidentPhone }: { shareResidentPhone: boolean }) {
  const [state, action, pending] = useActionState(saveComplaintSettings, initialFormState);
  return (
    <form key={state.id} action={action} className="space-y-3">
      <HostelField />
      <Status state={state} />
      <Checkbox
        id="share-resident-phone"
        name="share_resident_phone"
        label="Show the resident's mobile number on a worker's job link"
        hint="Off by default. Workers then call the hostel instead."
        defaultChecked={shareResidentPhone}
      />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>
        Save
      </Button>
    </form>
  );
}

/** A recurring maintenance task (ClickUp EP-15 T12). */
export function ScheduleForm({
  categories,
  rooms,
}: {
  categories: readonly Category[];
  rooms: readonly { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveSchedule, initialFormState);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const [location, setLocation] = useState(values.location ?? "area");
  return (
    <form key={state.id} action={action} noValidate className="space-y-3">
      <HostelField />
      <Status state={state} />
      <Input
        id="schedule-title"
        name="title"
        label="Task"
        placeholder="e.g. Clean the water tank"
        required
        defaultValue={values.title ?? ""}
        error={state.fieldErrors.title?.[0]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="schedule-category"
          name="category_id"
          label="Category"
          placeholder="Choose"
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
          defaultValue={values.category_id ?? ""}
          error={state.fieldErrors.category_id?.[0]}
        />
        <Select
          id="schedule-priority"
          name="priority"
          label="Priority"
          options={PRIORITY_OPTIONS}
          defaultValue={values.priority ?? "normal"}
        />
        <Select
          id="schedule-location"
          name="location"
          label="Where"
          options={[
            { value: "area", label: "A common area" },
            { value: "room", label: "A room" },
          ]}
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
        {location === "room" ? (
          <Select
            id="schedule-room"
            name="room_id"
            label="Room"
            placeholder="Choose"
            options={rooms.map((room) => ({ value: room.id, label: room.label }))}
            defaultValue={values.room_id ?? ""}
            error={state.fieldErrors.room_id?.[0]}
          />
        ) : (
          <Input
            id="schedule-area"
            name="area"
            label="Area"
            placeholder="e.g. Terrace"
            defaultValue={values.area ?? ""}
            error={state.fieldErrors.area?.[0]}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input
            id="schedule-every"
            name="every_n"
            label="Every"
            inputMode="numeric"
            defaultValue={values.every_n ?? "1"}
            error={state.fieldErrors.every_n?.[0]}
          />
          <Select
            id="schedule-unit"
            name="unit"
            label="Unit"
            options={SCHEDULE_UNIT_OPTIONS}
            defaultValue={values.unit ?? "month"}
          />
        </div>
        <Input
          id="schedule-next"
          name="next_due"
          type="date"
          label="First due"
          defaultValue={values.next_due ?? todayIst()}
          error={state.fieldErrors.next_due?.[0]}
        />
      </div>
      <Textarea
        id="schedule-description"
        name="description"
        label="Details (optional)"
        rows={2}
        defaultValue={values.description ?? ""}
      />
      <Button type="submit" loading={pending}>
        Add schedule
      </Button>
    </form>
  );
}
