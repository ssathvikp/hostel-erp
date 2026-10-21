/**
 * Where a complaint stands against its response and resolution targets
 * (ClickUp EP-15 T10). "Near" means less than a fifth of the target time is
 * left. Time on hold is already added to `resolveBy` by the database.
 */
export type TargetState = "met" | "ok" | "near" | "missed";

function state(start: string, due: string | null, doneAt: string | null, now: number): TargetState {
  if (!due) return "ok";
  const dueAt = Date.parse(due);
  if (doneAt) return Date.parse(doneAt) <= dueAt ? "met" : "missed";
  if (now > dueAt) return "missed";
  const total = dueAt - Date.parse(start);
  return total > 0 && dueAt - now < total / 5 ? "near" : "ok";
}

export function targetStates(
  complaint: {
    createdAt: string;
    respondBy: string | null;
    resolveBy: string | null;
    firstResponseAt: string | null;
    resolvedAt: string | null;
  },
  now: number = Date.now(),
): { response: TargetState; resolution: TargetState } {
  return {
    response: state(complaint.createdAt, complaint.respondBy, complaint.firstResponseAt, now),
    resolution: state(complaint.createdAt, complaint.resolveBy, complaint.resolvedAt, now),
  };
}

/** The worst of the two, for one badge in a list. */
export function worstTarget(states: { response: TargetState; resolution: TargetState }) {
  const order: TargetState[] = ["missed", "near", "ok", "met"];
  return order.find((value) => states.response === value || states.resolution === value) ?? "ok";
}
