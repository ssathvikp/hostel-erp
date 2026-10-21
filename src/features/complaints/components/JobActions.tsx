"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Input, Textarea } from "@/components/ui";

import { updateJob, type JobUpdateState } from "../job-actions";

const initial: JobUpdateState = { status: "idle" };

/** The buttons on a worker's job page, by where the job stands (ClickUp EP-15 T8). */
export function JobActions({ token, state: jobState }: { token: string; state: string }) {
  const [state, action, pending] = useActionState(updateJob, initial);
  const [finishing, setFinishing] = useState(false);

  if (state.final) return <Alert tone="success">{state.message}</Alert>;

  return (
    <div className="space-y-4">
      {state.status === "error" && <Alert tone="error">{state.message}</Alert>}
      {state.status === "success" && <Alert tone="success">{state.message}</Alert>}
      <form action={action} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        {finishing ? (
          <>
            <Textarea id="job-note" name="note" label="What did you do? (optional)" rows={3} />
            <Input
              id="job-charge"
              name="charge"
              label="Your charge (₹, optional)"
              inputMode="decimal"
              placeholder="e.g. 450"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="action" value="done" loading={pending}>
                Mark as done
              </Button>
              <Button variant="secondary" onClick={() => setFinishing(false)}>
                Back
              </Button>
            </div>
          </>
        ) : jobState === "sent" ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="action" value="accept" loading={pending}>
              Accept the job
            </Button>
            <Button
              type="submit"
              name="action"
              value="decline"
              variant="secondary"
              disabled={pending}
            >
              I can&apos;t take it
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {jobState === "accepted" && (
              <Button
                type="submit"
                name="action"
                value="on_the_way"
                variant="secondary"
                loading={pending}
              >
                On the way
              </Button>
            )}
            {(jobState === "accepted" || jobState === "on_the_way") && (
              <Button
                type="submit"
                name="action"
                value="started"
                variant="secondary"
                loading={pending}
              >
                Started work
              </Button>
            )}
            <Button onClick={() => setFinishing(true)}>Finished</Button>
          </div>
        )}
      </form>
    </div>
  );
}
