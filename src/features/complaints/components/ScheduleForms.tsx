"use client";

import { useActionState, useEffect, useState } from "react";

import { Alert, Button, Input, Modal, Select, Textarea } from "@/components/ui";
import { todayIst } from "@/lib/validation";
import { initialFormState, type FormState } from "@/lib/validation/result";

import { runDueMaintenance, saveSchedule, setScheduleActive } from "../actions";
import { PRIORITY_OPTIONS, UNIT_OPTIONS } from "../options";

export interface ScheduleInput {
  id: string;
  title: string;
  description: string | null;
  categoryId: string;
  roomId: string | null;
  area: string | null;
  every: number;
  unit: string;
  nextDue: string;
  priority: string;
}

/** Adds or edits a recurring maintenance task (E15-T12). */
export function ScheduleDialog({
  schedule,
  categories,
  rooms,
}: {
  schedule?: ScheduleInput;
  categories: readonly { value: string; label: string }[];
  rooms: readonly { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveSchedule, initialFormState);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state.status === "success") setOpen(false);
  }, [state]);
  const values = state.values;
  const [place, setPlace] = useState<"room" | "area">(
    (values?.place as "room" | "area") || (schedule?.roomId ? "room" : "area"),
  );
  const formId = `schedule-${schedule?.id ?? "new"}`;
  const today = todayIst();

  return (
    <>
      <Button
        size={schedule ? "sm" : "md"}
        variant={schedule ? "ghost" : "primary"}
        onClick={() => setOpen(true)}
        aria-label={schedule ? `Edit ${schedule.title}` : undefined}
      >
        {schedule ? "Edit" : "Add task"}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={schedule ? `Edit ${schedule.title}` : "Add a recurring task"}
        description="When it falls due it becomes a job and goes to the right worker, like any complaint."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form key={state.id} id={formId} action={action} noValidate className="space-y-4">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          {schedule && <input type="hidden" name="schedule_id" value={schedule.id} />}
          <Input
            id={`${formId}-title`}
            name="title"
            label="Task"
            placeholder="e.g. Clean the water tank"
            defaultValue={values?.title ?? schedule?.title ?? ""}
            required
            maxLength={120}
            error={state.fieldErrors.title?.[0]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id={`${formId}-category`}
              name="category_id"
              label="Category"
              placeholder="Choose a category"
              options={categories}
              defaultValue={values?.category_id ?? schedule?.categoryId ?? ""}
              required
              error={state.fieldErrors.category_id?.[0]}
            />
            <Select
              id={`${formId}-priority`}
              name="priority"
              label="Priority"
              options={PRIORITY_OPTIONS}
              defaultValue={values?.priority || schedule?.priority || "normal"}
              error={state.fieldErrors.priority?.[0]}
            />
            <Input
              id={`${formId}-every`}
              name="every"
              label="Every"
              inputMode="numeric"
              defaultValue={values?.every ?? String(schedule?.every ?? 1)}
              required
              error={state.fieldErrors.every?.[0]}
            />
            <Select
              id={`${formId}-unit`}
              name="unit"
              label="Unit"
              options={UNIT_OPTIONS}
              defaultValue={values?.unit || schedule?.unit || "month"}
              error={state.fieldErrors.unit?.[0]}
            />
            <Input
              id={`${formId}-next`}
              name="next_due"
              type="date"
              label="Next due"
              min={schedule ? undefined : today}
              defaultValue={values?.next_due || schedule?.nextDue || today}
              required
              error={state.fieldErrors.next_due?.[0]}
            />
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-slate-800">Where</legend>
            <div className="flex gap-6 text-sm">
              {(["area", "room"] as const).map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="place"
                    value={option}
                    checked={place === option}
                    onChange={() => setPlace(option)}
                    disabled={option === "room" && rooms.length === 0}
                    className="size-4 accent-brand-600"
                  />
                  {option === "room" ? "A room" : "A common area"}
                </label>
              ))}
            </div>
            {place === "room" ? (
              <Select
                id={`${formId}-room`}
                name="room_id"
                label="Room"
                placeholder="Choose a room"
                options={rooms}
                defaultValue={values?.room_id ?? schedule?.roomId ?? ""}
                required
                error={state.fieldErrors.room_id?.[0]}
              />
            ) : (
              <Input
                id={`${formId}-area`}
                name="area"
                label="Common area"
                placeholder="e.g. Terrace water tank"
                defaultValue={values?.area ?? schedule?.area ?? ""}
                required
                maxLength={100}
                error={state.fieldErrors.area?.[0] ?? state.fieldErrors.room_id?.[0]}
              />
            )}
          </fieldset>
          <Textarea
            id={`${formId}-description`}
            name="description"
            label="Details"
            rows={2}
            defaultValue={values?.description ?? schedule?.description ?? ""}
            maxLength={2000}
            hint="Optional. What the worker should check or bring."
            error={state.fieldErrors.description?.[0]}
          />
        </form>
      </Modal>
    </>
  );
}

function Announce({ state }: { state: FormState }) {
  if (state.status === "success" && state.message) {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  if (state.status === "error" && state.formError) {
    return <Alert tone="error">{state.formError}</Alert>;
  }
  return null;
}

export function ScheduleActiveToggle({
  id,
  title,
  active,
}: {
  id: string;
  title: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(setScheduleActive, initialFormState);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={String(!active)} />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        loading={pending}
        aria-label={`${active ? "Pause" : "Resume"} ${title}`}
      >
        {active ? "Pause" : "Resume"}
      </Button>
      {state.status === "success" && (
        <span role="status" className="sr-only">
          {state.message}
        </span>
      )}
    </form>
  );
}

/** Creates today's due jobs now rather than waiting for the nightly run. */
export function RunDueButton() {
  const [state, action, pending] = useActionState(runDueMaintenance, initialFormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="secondary" loading={pending}>
        Create due jobs now
      </Button>
      <Announce state={state} />
    </form>
  );
}
