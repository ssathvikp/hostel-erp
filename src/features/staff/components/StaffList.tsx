"use client";

import { useActionState, useState } from "react";

import { Alert, Badge, Button, Modal, Table, TBody, Td, Th, THead, Tr } from "@/components/ui";
import { initialFormState } from "@/lib/validation/result";

import { removeStaff, resendInvitation, revokeInvitation } from "../actions";
import type { StaffRow, StaffStatus } from "../queries";

const STATUS: Record<StaffStatus, { label: string; tone: "success" | "warning" | "neutral" }> = {
  active: { label: "Active", tone: "success" },
  invited: { label: "Invited", tone: "warning" },
  removed: { label: "Removed", tone: "neutral" },
};

const day = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

/**
 * Staff of the hostel with their state. Pending invitations can be sent
 * again or cancelled; active staff can be removed, which ends their access
 * at once but keeps their name on everything they recorded.
 */
export function StaffList({ staff }: { staff: StaffRow[] }) {
  const [removing, setRemoving] = useState<StaffRow | null>(null);
  const [resendState, resend, resending] = useActionState(resendInvitation, initialFormState);
  const [revokeState, revoke, revoking] = useActionState(revokeInvitation, initialFormState);
  const [removeState, remove, removingNow] = useActionState(removeStaff, initialFormState);

  // Only the outcome of the last action taken is shown.
  const [last, setLast] = useState<"resend" | "revoke" | "remove" | null>(null);
  const state = { resend: resendState, revoke: revokeState, remove: removeState }[last ?? "resend"];
  const error = last ? state.formError : undefined;
  const message = last && state.status === "success" ? state.message : undefined;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {message && <Alert tone="success">{message}</Alert>}
      <Table caption="Staff">
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Status</Th>
            <Th>Since</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {staff.map((row) => (
            <Tr key={row.invitationId ?? row.profileId}>
              <Td className="font-medium">{row.fullName}</Td>
              <Td>{row.email ?? "—"}</Td>
              <Td>
                <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
              </Td>
              <Td>{day.format(new Date(row.since))}</Td>
              <Td>
                <div className="flex justify-end gap-2">
                  {row.status === "invited" && row.invitationId && (
                    <>
                      <form action={resend} onSubmit={() => setLast("resend")}>
                        <input type="hidden" name="invitation_id" value={row.invitationId} />
                        <Button type="submit" size="sm" variant="secondary" loading={resending}>
                          Resend<span className="sr-only"> invitation to {row.fullName}</span>
                        </Button>
                      </form>
                      <form action={revoke} onSubmit={() => setLast("revoke")}>
                        <input type="hidden" name="invitation_id" value={row.invitationId} />
                        <Button type="submit" size="sm" variant="ghost" loading={revoking}>
                          Cancel<span className="sr-only"> invitation to {row.fullName}</span>
                        </Button>
                      </form>
                    </>
                  )}
                  {row.status === "active" && row.profileId && (
                    <Button size="sm" variant="secondary" onClick={() => setRemoving(row)}>
                      Remove<span className="sr-only"> {row.fullName}</span>
                    </Button>
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.fullName ?? "staff member"}?`}
        description="They are signed out and can no longer open this hostel. Payments and other records they made keep their name. You can invite them again later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <form
              action={remove}
              onSubmit={() => {
                setLast("remove");
                setRemoving(null);
              }}
            >
              <input type="hidden" name="profile_id" value={removing?.profileId ?? ""} />
              <Button type="submit" variant="danger" loading={removingNow} className="w-full">
                Remove access
              </Button>
            </form>
          </>
        }
      />
    </div>
  );
}
