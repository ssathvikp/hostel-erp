"use client";

import { useActionState, useState } from "react";

import { Alert, Button, Modal } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { archiveRoom, deleteRoom } from "../actions";

type Pending = "archive" | "delete" | null;

/**
 * Archive and delete (E4-T7). Archiving keeps the room and its history but
 * removes it from active lists. Deleting is for setup mistakes only: the
 * database refuses it once any resident history exists.
 */
export function RoomDangerZone({ room }: { room: { id: string; number: string } }) {
  const [confirming, setConfirming] = useState<Pending>(null);
  const [archiveState, archive, archiving] = useActionState(archiveRoom, initialFormState);
  const [deleteState, remove, deleting] = useActionState(deleteRoom, initialFormState);
  const error = archiveState.formError ?? deleteState.formError;

  return (
    <section aria-labelledby="danger-heading" className="space-y-4">
      <h2 id="danger-heading" className="text-base font-semibold text-slate-900">
        Archive or delete
      </h2>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-600">
          Archive a room that is no longer let out. It keeps its history and number. Delete only a
          room added by mistake.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setConfirming("archive")}>
            Archive room
          </Button>
          <Button variant="danger" onClick={() => setConfirming("delete")}>
            Delete room
          </Button>
        </div>
      </div>

      <Modal
        open={confirming === "archive"}
        onClose={() => setConfirming(null)}
        title={`Archive room ${room.number}?`}
        description="The room and its beds leave the active lists and can no longer be allocated. Its history stays. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <form action={archive} onSubmit={() => setConfirming(null)}>
              <input type="hidden" name="room_id" value={room.id} />
              <Button type="submit" loading={archiving} className="w-full">
                Archive room
              </Button>
            </form>
          </>
        }
      />

      <Modal
        open={confirming === "delete"}
        onClose={() => setConfirming(null)}
        title={`Delete room ${room.number}?`}
        description="The room and its beds are removed permanently. Rooms with resident history cannot be deleted; archive them instead."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <form action={remove} onSubmit={() => setConfirming(null)}>
              <input type="hidden" name="room_id" value={room.id} />
              <Button type="submit" variant="danger" loading={deleting} className="w-full">
                Delete room
              </Button>
            </form>
          </>
        }
      />
    </section>
  );
}
